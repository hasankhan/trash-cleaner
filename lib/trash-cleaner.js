import diacriticLess from 'diacriticless';

import { ConsoleProgressReporter } from './reporter/console-progress-reporter.js';
import { classify, getPipeline, DEFAULT_THRESHOLD } from './classifier/llm-classifier.js';

/** @typedef {import('./client/email-client.js').Email} Email */
/** @typedef {import('./client/email-client.js').EmailClient} EmailClient */
/** @typedef {import('./reporter/progress-reporter.js').ProgressReporter} ProgressReporter */
/** @typedef {import('./store/config-store.js').ConfigStore} ConfigStore */
/** @typedef {import('./utils/action-log.js').ActionLog} ActionLog */

// The file keywords.json stores the keywords and labels to use when finding
// trash email.
const FILE_KEYWORDS = 'keywords.json';

// The file allowlist.json stores senders that are protected from actions.
const FILE_ALLOWLIST = 'allowlist.json';

const EmailAction = {
    DELETE: 'delete',
    ARCHIVE: 'archive',
    MARK_AS_READ: 'mark-as-read'
};

const VALID_ACTIONS = Object.values(EmailAction);

const RuleType = {
    KEYWORD: 'keyword',
    LLM: 'llm'
};

/**
 * An object to represent single trash keyword configuration. 
 */
class TrashKeyword {
    /**
     * 
     * @param {string} value The keyword pattern or LLM classification label.
     * @param {string[]} fields The list of email fields to search in.   
     * @param {string[]} labels The list of labels to search in. 
     * @param {string} action The action to take on matched emails.
     * @param {string} type The rule type ('keyword' or 'llm').
     * @param {string} [title] Optional human-readable title for the rule.
     */
    constructor(value, fields, labels, action = EmailAction.DELETE, type = RuleType.KEYWORD, title = undefined) {
        if (typeof value != 'string' || !Array.isArray(fields) ||
            !Array.isArray(labels)) {
            throw new Error('Invalid keyword');
        }
        if (!VALID_ACTIONS.includes(action)) {
            throw new Error(`Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(', ')}`);
        }
        this.value = value;
        this.fields = fields;
        this.labels = labels;
        this.action = action;
        this.type = type;
        this.title = title;
    }
}

/**
 * Base class for trash rules.
 */
class TrashRule {
    /**
     * Applies the rule to the email attributes and returns result.
     * 
     * @param {Email} _email The email to match the rule with.
     * @returns {boolean} True if the rule matches, False otherwise.
     */
    isMatch(_email) {
        return false;
    }
}

/**
 * A trash identification rule based on TrashKeyword.
 */
class KeywordTrashRule extends TrashRule {
    /**
     * Creates an instance of KeywordTrashRule for the given keyword.
     * 
     * @param {TrashKeyword} keyword The keyword to create rule for.
     */
    constructor(keyword) {
        super();
        if (!keyword || typeof keyword.value != 'string' ||
            !Array.isArray(keyword.fields) || !Array.isArray(keyword.labels)) {
            throw new Error('Invalid keyword');
        }

        this.regex = new RegExp(keyword.value, 'giu');
        this.fields = {};
        keyword.fields.forEach(field => {
            this.fields[field === '*' ? 'all' : field.toLowerCase()] = true;
        });
        this.labels = keyword.labels.map(l => l.toLowerCase());
        this.action = keyword.action || EmailAction.DELETE;
        this.title = keyword.title || keyword.value;
    }

    /**
     * Applies the rule to the email attributes and returns result.
     * 
     * @param {Email} email The email to match the rule with.
     * @returns {boolean} True if the rule matches, False otherwise.
     */
    isMatch(email) {
        const keywordFound = Object.getOwnPropertyNames(email).some(field =>
            (this.fields.all || this.fields[field]) &&
            this.regex.test(email[field]));

        return keywordFound && this.labels.some(label => label === '*' ||
            email.labels.includes(label));
    }
}

/**
 * A trash identification rule that uses an LLM zero-shot classifier.
 * The `value` field is a natural-language label (e.g. "marketing email").
 */
class LlmTrashRule extends TrashRule {
    /**
     * Creates an instance of LlmTrashRule.
     *
     * @param {TrashKeyword} keyword The keyword (value = classification label).
     * @param {number} [threshold] Minimum confidence score to consider a match.
     */
    constructor(keyword, threshold = DEFAULT_THRESHOLD) {
        super();
        this.label = keyword.value;
        this.labels = keyword.labels.map(l => l.toLowerCase());
        this.action = keyword.action || EmailAction.DELETE;
        this.title = keyword.title || keyword.value;
        this.threshold = threshold;
    }

    /**
     * Checks if the email matches this LLM rule.
     *
     * @param {Email} email The email to classify.
     * @returns {Promise<boolean>} True if similarity score exceeds threshold.
     */
    async isMatch(email) {
        const text = [email.subject, email.snippet, email.from]
            .filter(Boolean).join(' — ');
        if (!text.trim()) {
            return false;
        }

        // Check label/folder scope
        const labelMatch = this.labels.some(label =>
            label === '*' || email.labels.includes(label));
        if (!labelMatch) {
            return false;
        }

        const score = await classify(text, this.label);
        return score >= this.threshold;
    }
}

/**
 * An object that can clean trash emails from the mailbox.
 */
class TrashCleaner {
    /**
     * Creates an instance of TrashCleaner.
     * 
     * @param {EmailClient} client The client.
     * @param {TrashKeyword[]} keywords The keywords.
     * @param {ProgressReporter} reporter The reporter.
     * @param {string[]} allowlist Sender patterns to protect from actions.
     * @param {ActionLog} actionLog Optional action log for undo support.
     */
    constructor(client, keywords, reporter, allowlist = [], actionLog = null, minAgeDays = null) {
        this._client = client;
        this._rules = this._createRules(keywords);
        this._reporter = reporter;
        this._allowlist = allowlist.map(pattern => new RegExp(pattern, 'i'));
        this._actionLog = actionLog;
        this._minAgeDays = minAgeDays;
    }

    /**
     * Cleans trash email from the mailbox.
     * 
     * @param {boolean} dryRun Do a dry-run cleanup without deleting emails.
     */
    async cleanTrash(dryRun) {
        this._reporter.onStart(dryRun);

        try {
            const emails = await this._findTrashEmails();

            await this._processTrashEmails(emails, dryRun);
        }
        finally {
            this._reporter.onStop();
        }
    }

    /**
     * Finds trash emails without acting on them.
     * Starts the reporter spinner but suppresses the summary output,
     * leaving display to the caller (e.g. interactive mode).
     * 
     * @returns {Promise<Email[]>} The list of identified trash emails.
     */
    async findTrash() {
        this._reporter.onStart(true);
        try {
            return await this._findTrashEmails();
        } finally {
            this._reporter.onStopSpinner();
        }
    }

    /**
     * Processes pre-identified trash emails (executes actions).
     * 
     * @param {Email[]} emails The trash emails to process.
     */
    async processEmails(emails) {
        await this._processTrashEmails(emails, false);
    }

    /**
     * Processes the trash emails by grouping them by action and executing.
     * 
     * @param {Email[]} emails The trash emails to process. 
     * @param {boolean} dryRun Do a dry-run cleanup without deleting emails.
     */
    async _processTrashEmails(emails, dryRun) {
        if (emails.length === 0) {
            return;
        }

        const grouped = {};
        for (const email of emails) {
            const action = email._action || EmailAction.DELETE;
            if (!grouped[action]) {
                grouped[action] = [];
            }
            grouped[action].push(email);
        }

        const logEntries = [];

        for (const [action, actionEmails] of Object.entries(grouped)) {
            this._reporter.onProcessingAction(action, actionEmails.length);
            if (!dryRun) {
                switch (action) {
                    case EmailAction.ARCHIVE:
                        await this._client.archiveEmails(actionEmails);
                        break;
                    case EmailAction.MARK_AS_READ:
                        await this._client.markAsReadEmails(actionEmails);
                        break;
                    case EmailAction.DELETE:
                    default:
                        await this._client.deleteEmails(actionEmails);
                        break;
                }
                for (const email of actionEmails) {
                    logEntries.push({
                        id: email.id,
                        action,
                        from: email.from,
                        subject: email.subject
                    });
                }
            }
            this._reporter.onActionComplete(action, actionEmails.length);
        }

        if (!dryRun && this._actionLog && logEntries.length > 0) {
            this._actionLog.record(logEntries);
        }
    }

    /**
     * Deletes the trash emails.
     * 
     * @param {Email[]} emails The trash emails to delete. 
     * @param {boolean} dryRun Do a dry-run cleanup without deleting emails.
     */
    async deleteTrashEmails(emails, dryRun) {
        if (emails.length === 0) {
            return;
        }

        this._reporter.onDeletingTrash();
        if (!dryRun) {
            await this._client.deleteEmails(emails);
        }
        this._reporter.onTrashDeleted();
    }

    /**
     * Converts the list of keywords into trash rules.
     *
     * @param {TrashKeyword[]} keywords List of keywords and their labels for trash search.
     * @returns {TrashRule[]} The trash rules based on keywords.
     */
    _createRules(keywords) {
        return keywords.map(keyword => {
            if (keyword.type === RuleType.LLM) {
                return new LlmTrashRule(keyword);
            }
            return new KeywordTrashRule(keyword);
        });
    }

    /**
     * Finds trash emails in the mailbox.
     *
     * @returns {Promise<Email[]>} The list of trash emails.
     */
    async _findTrashEmails() {
        const emails = await this._getUnreadEmails();

        return await this.filterTrashEmails(emails);
    }

    /**
     * Filters out trash email from the list of emails.
     * 
     * @param {Email[]} emails The list of emails to filter. 
     * @returns {Promise<Email[]>} The list of trash emails.
     */
    async filterTrashEmails(emails) {
        const hasLlmRules = this._rules.some(r => r instanceof LlmTrashRule);
        if (hasLlmRules) {
            // Pre-load the classifier so download progress shows once
            await getPipeline();
        }

        const normalized = emails.map(this._normalizeEmail.bind(this));
        const trashEmails = [];
        for (const email of normalized) {
            if (await this._isTrashEmail(email)) {
                trashEmails.push(email);
            }
        }

        this._reporter.onTrashEmailsIdentified(trashEmails);
        return trashEmails;
    }

    /**
     * Gets unread emails from the mailbox.
     *  
     * @returns {Promise<Email[]>} The unread emails. 
     */
    async _getUnreadEmails() {
        this._reporter.onRetrievingUnreadEmails();
        try {
            const emails = await this._client.getUnreadEmails();
            this._reporter.onUnreadEmailsRetrieved(emails);
            return emails;
        } catch (err) {
            throw new Error(`Failed to get trash emails: ${err}`);
        }
    }

    /**
     * Checks if a message is trash according to keywords list.
     * Tags the email with the action from the first matching rule.
     * Allowlisted senders are always protected.
     * 
     * @param {Email} email The email to check.
     * @returns {Promise<boolean>} True if the message is trash, False otherwise.
     */
    async _isTrashEmail(email) {
        if (this._isAllowlisted(email)) {
            return false;
        }
        if (!this._meetsMinAge(email)) {
            return false;
        }
        for (const rule of this._rules) {
            if (await rule.isMatch(email)) {
                email._action = rule.action;
                email._rule = rule.title;
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if the email meets the minimum age requirement.
     *
     * @param {Email} email The email to check.
     * @returns {boolean} True if old enough or no min-age set.
     */
    _meetsMinAge(email) {
        if (this._minAgeDays == null || !email.date) {
            return true;
        }
        const ageMs = Date.now() - email.date.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        return ageDays >= this._minAgeDays;
    }

    /**
     * Checks if an email's sender matches the allowlist.
     *
     * @param {Email} email The email to check.
     * @returns {boolean} True if the sender is allowlisted.
     */
    _isAllowlisted(email) {
        if (this._allowlist.length === 0) {
            return false;
        }
        return this._allowlist.some(pattern => pattern.test(email.from));
    }

    /**
     * Normalizes email object fields for keyword matching.
     *
     * @param {Email} email The email object to normalize.
     * @returns {Email} The same email object after normalization.
     */
    _normalizeEmail(email) {
        email.labels = email.labels.map(l => l.toLowerCase());
        email.snippet = diacriticLess(email.snippet);
        email.subject = diacriticLess(email.subject);
        email.from = diacriticLess(email.from);
        email.body = diacriticLess(email.body);

        return email;
    }
}

/**
 * Factory for TrashCleaner objects.
 */
class TrashCleanerFactory {
    /**
     * Creates an instance of TrashCleaner object.
     * 
     * @param {ConfigStore} configStore The configuration store.
     * @param {EmailClient} client The email client to use.
     * @param {boolean} cliMode Indicates if an interactive CLI mode is on.
     * @param {boolean} quiet Suppress verbose output.
     * @param {string} format Output format ('text' or 'html').
     * @param {ActionLog} actionLog Optional action log for undo support.
     * @param {number} minAgeDays Optional minimum email age in days.
     */
    constructor(configStore, client, cliMode, quiet = false, format = 'text', actionLog = null, minAgeDays = null) {
        this._configStore = configStore;
        this._client = client;
        this._cliMode = cliMode;
        this._quiet = quiet;
        this._format = format;
        this._actionLog = actionLog;
        this._minAgeDays = minAgeDays;
    }

    /**
     * Creates an instance of TrashCleaner.
     * 
     * @returns {Promise<TrashCleaner>} The TrashCleaner instance. 
     */
    async getInstance() {
        const keywords = await this.readKeywords();
        if (keywords.length === 0) {
            console.warn('Warning: No keyword rules configured. Add rules to keywords.json to identify trash emails.');
        }
        const allowlist = await this.readAllowlist();
        let reporter;
        if (this._format === 'html') {
            const { HtmlProgressReporter } = await import('./reporter/html-progress-reporter.js');
            reporter = new HtmlProgressReporter();
        } else {
            reporter = new ConsoleProgressReporter(this._cliMode, this._quiet);
        }
        const cleaner = new TrashCleaner(this._client, keywords, reporter, allowlist, this._actionLog, this._minAgeDays);
        return cleaner;
    }

    /**
     * Reads the allowlist from the config file.
     * Returns an empty array if the file doesn't exist.
     * 
     * @returns {Promise<string[]>} A list of sender patterns to protect.
     */
    async readAllowlist() {
        let allowlist;
        try {
            allowlist = await this._configStore.getJson(FILE_ALLOWLIST);
        } catch (err) {
            // If file doesn't exist or is null, return empty allowlist
            // Re-throw parse errors
            if (err.message && err.message.includes('Unexpected token')) {
                throw err;
            }
            return [];
        }

        if (allowlist === null || allowlist === undefined) {
            return [];
        }
        if (!Array.isArray(allowlist)) {
            throw new Error('allowlist.json must contain a JSON array of sender patterns.');
        }
        return allowlist;
    }

    /**
     * Reads the trash keywords from the config file.
     * 
     * @returns {Promise<TrashKeyword[]>} A list of trash keywords.
     */
    async readKeywords() {
        let keywords;
        try {
            keywords = await this._configStore.getJson(FILE_KEYWORDS);
        } catch (err) {
            if (err.message && err.message.includes('Unexpected token')) {
                throw err;
            }
            return [];
        }
        this._validateKeywordsConfig(keywords);
        return keywords.map((keyword, index) => {
            try {
                const fields = this.splitAndTrim(keyword.fields, ',', '*');
                const labels = this.splitAndTrim(keyword.labels, ',', '*');
                const type = keyword.type || RuleType.KEYWORD;
                return new TrashKeyword(keyword.value, fields, labels, keyword.action, type, keyword.title);
            } catch (err) {
                throw new Error(`Invalid keyword at index ${index}: ${err.message}`);
            }
        });
    }

    /**
     * Validates the keywords.json configuration structure.
     * 
     * @param {*} keywords The parsed keywords config.
     */
    _validateKeywordsConfig(keywords) {
        if (!Array.isArray(keywords)) {
            throw new Error(
                'keywords.json must contain a JSON array. ' +
                'See config/keywords.json.sample for the expected format.'
            );
        }
        if (keywords.length === 0) {
            return;
        }
        for (let i = 0; i < keywords.length; i++) {
            const entry = keywords[i];
            if (!entry || typeof entry !== 'object') {
                throw new Error(
                    `keywords.json entry at index ${i} must be an object. ` +
                    'Expected format: { "value": "pattern", "fields": "...", "labels": "..." }'
                );
            }
            if (entry.type !== undefined && entry.type !== RuleType.KEYWORD && entry.type !== RuleType.LLM) {
                throw new Error(
                    `keywords.json entry at index ${i}: invalid type "${entry.type}". ` +
                    `Must be one of: ${RuleType.KEYWORD}, ${RuleType.LLM}`
                );
            }
            if (typeof entry.value !== 'string' || entry.value.trim() === '') {
                throw new Error(
                    `keywords.json entry at index ${i} is missing a valid "value" field. ` +
                    'The "value" field must be a non-empty string.'
                );
            }
            if (entry.fields !== undefined && typeof entry.fields !== 'string') {
                throw new Error(
                    `keywords.json entry at index ${i}: "fields" must be a comma-separated string ` +
                    '(e.g. "subject,body" or "*"). Got: ' + typeof entry.fields
                );
            }
            if (entry.labels !== undefined && typeof entry.labels !== 'string') {
                throw new Error(
                    `keywords.json entry at index ${i}: "labels" must be a comma-separated string ` +
                    '(e.g. "spam,inbox" or "*"). Got: ' + typeof entry.labels
                );
            }
            if (entry.action !== undefined && !VALID_ACTIONS.includes(entry.action)) {
                throw new Error(
                    `keywords.json entry at index ${i}: invalid action "${entry.action}". ` +
                    `Must be one of: ${VALID_ACTIONS.join(', ')}`
                );
            }
            if (entry.title !== undefined && (typeof entry.title !== 'string' || entry.title.trim() === '')) {
                throw new Error(
                    `keywords.json entry at index ${i}: "title" must be a non-empty string.`
                );
            }
        }
    }

    /**
     * Splits and trims a delimited string.
     * 
     * @param {string} string The string to split.
     * @param {string} separator The separator to use for split. 
     * @param {string} defaultValue The default value if string is empty. 
     * @returns {string[]} List of tokens extracted from string.
     */
    splitAndTrim(string, separator, defaultValue) {
        return (string ?? defaultValue).split(separator)
            .map(t => t.trim())
            .filter(t => t);
    }
}

export {
    EmailAction,
    RuleType,
    TrashKeyword,
    TrashCleaner,
    TrashCleanerFactory,
    LlmTrashRule,
    KeywordTrashRule,
}