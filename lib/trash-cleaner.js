const diacriticLess = require('diacriticless');

const { ConsoleProgressReporter } = require('./reporter/console-progress-reporter');

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

/**
 * An object to represent single trash keyword configuration. 
 */
class TrashKeyword {
    /**
     * 
     * @param {string} value The keyword pattern.
     * @param {string[]} fields The list of email fields to search in.   
     * @param {string[]} labels The list of labels to search in. 
     * @param {string} action The action to take on matched emails.
     */
    constructor(value, fields, labels, action = EmailAction.DELETE) {
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
    }
}

/**
 * Base class for trash rules.
 */
class TrashRule {
    /**
     * Applies the rule to the email attributes and returns result.
     * 
     * @param {Email} email The email to match the rule with.
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

        this.regex = new RegExp(keyword.value, 'gi');
        this.fields = {};
        keyword.fields.forEach(field => {
            this.fields[field === '*' ? 'all' : field.toLowerCase()] = true;
        });
        this.labels = keyword.labels.map(l => l.toLowerCase());
        this.action = keyword.action || EmailAction.DELETE;
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
    constructor(client, keywords, reporter, allowlist = [], actionLog = null) {
        this._client = client;
        this._rules = this._createRules(keywords);
        this._reporter = reporter;
        this._allowlist = allowlist.map(pattern => new RegExp(pattern, 'i'));
        this._actionLog = actionLog;
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
     * 
     * @returns {Email[]} The list of identified trash emails.
     */
    async findTrash() {
        this._reporter.onStart(true);
        try {
            return await this._findTrashEmails();
        } finally {
            this._reporter.onStop();
        }
    }

    /**
     * Processes pre-identified trash emails (executes actions).
     * 
     * @param {Email[]} emails The trash emails to process.
     */
    async processEmails(emails) {
        this._reporter.onStart(false);
        try {
            await this._processTrashEmails(emails, false);
        } finally {
            this._reporter.onStop();
        }
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
     * @returns {KeywordTrashRule[]]} The trash rules based on keywords.
     */
    _createRules(keywords) {
        return keywords.map(keyword => new KeywordTrashRule(keyword));
    }

    /**
     * Finds trash emails in the mailbox.
     *
     * @returns {Email[]} The list of trash emails.
     */
    async _findTrashEmails() {
        const emails = await this._getUnreadEmails();

        return this.filterTrashEmails(emails);
    }

    /**
     * Filters out trash email from the list of emails.
     * 
     * @param {Email[]} emails The list of emails to filter. 
     * @returns {Email[]} The list of trash emails.
     */
    filterTrashEmails(emails) {
        const trashEmails = emails.map(this._normalizeEmail.bind(this))
            .filter(this._isTrashEmail.bind(this));

        this._reporter.onTrashEmailsIdentified(trashEmails);
        return trashEmails;
    }

    /**
     * Gets unread emails from the mailbox.
     *  
     * @returns {Email[]} The unread emails. 
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
     * @returns {boolean} True if the message is trash, False otherwise.
     */
    _isTrashEmail(email) {
        if (this._isAllowlisted(email)) {
            return false;
        }
        const matchingRule = this._rules.find(rule => rule.isMatch(email));
        if (matchingRule) {
            email._action = matchingRule.action;
            return true;
        }
        return false;
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
     */
    constructor(configStore, client, cliMode, quiet = false, format = 'text', actionLog = null) {
        this._configStore = configStore;
        this._client = client;
        this._cliMode = cliMode;
        this._quiet = quiet;
        this._format = format;
        this._actionLog = actionLog;
    }

    /**
     * Creates an instance of TrashCleaner.
     * 
     * @returns {TrashCleaner} The TrashCleaner instance. 
     */
    async getInstance() {
        const keywords = await this.readKeywords();
        const allowlist = await this.readAllowlist();
        let reporter;
        if (this._format === 'html') {
            const { HtmlProgressReporter } = require('./reporter/html-progress-reporter');
            reporter = new HtmlProgressReporter();
        } else {
            reporter = new ConsoleProgressReporter(this._cliMode, this._quiet);
        }
        const cleaner = new TrashCleaner(this._client, keywords, reporter, allowlist, this._actionLog);
        return cleaner;
    }

    /**
     * Reads the allowlist from the config file.
     * Returns an empty array if the file doesn't exist.
     * 
     * @returns {string[]} A list of sender patterns to protect.
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
     * @returns {TrashKeyword[]} A list of trash keywords.
     */
    async readKeywords() {
        const keywords = await this._configStore.getJson(FILE_KEYWORDS);
        this._validateKeywordsConfig(keywords);
        return keywords.map((keyword, index) => {
            try {
                const fields = this.splitAndTrim(keyword.fields, ',', '*');
                const labels = this.splitAndTrim(keyword.labels, ',', '*');
                return new TrashKeyword(keyword.value, fields, labels, keyword.action);
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
            throw new Error('keywords.json must contain at least one keyword entry.');
        }
        for (let i = 0; i < keywords.length; i++) {
            const entry = keywords[i];
            if (!entry || typeof entry !== 'object') {
                throw new Error(
                    `keywords.json entry at index ${i} must be an object. ` +
                    'Expected format: { "value": "pattern", "fields": "...", "labels": "..." }'
                );
            }
            if (typeof entry.value !== 'string' || entry.value.trim() === '') {
                throw new Error(
                    `keywords.json entry at index ${i} is missing a valid "value" field. ` +
                    'The "value" field must be a non-empty string (regex pattern).'
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

module.exports = {
    EmailAction,
    TrashKeyword,
    TrashCleaner,
    TrashCleanerFactory,
}