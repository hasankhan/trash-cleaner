const diacriticLess = require('diacriticless');

const { ConfigStore } = require('./store/config-store');
const { ConsoleProgressReporter } = require("./reporter/console-progress-reporter");
const { Email, EmailClient } = require('./email-client');
const { GmailClientFactory } = require('./gmail-client');

// The file keywords.json stores the keywords and labels to use when finding
// trash email.
const FILE_KEYWORDS = 'keywords.json';

/**
 * An object to represent single trash keyword configuration. 
 */
class TrashKeyword {
    /**
     * 
     * @param {string} value The keyword pattern.
     * @param {string[]} fields The list of email fields to search in.   
     * @param {string[]} labels The list of labels to search in. 
     */
    constructor(value, fields, labels) {
        if (typeof value != 'string' || !Array.isArray(fields) ||
            !Array.isArray(labels)) {
            throw new Error('Invalid keyword');
        }
        this.value = value;
        this.fields = fields;
        this.labels = labels;
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
    isMatch(email) {
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
            this.fields[field == '*' ? 'all' : field.toLowerCase()] = true;
        });
        this.labels = keyword.labels.map(l => l.toLowerCase());
    }

    /**
     * Applies the rule to the email attributes and returns result.
     * 
     * @param {Email} email The email to match the rule with.
     * @returns {boolean} True if the rule matches, False otherwise.
     */
    isMatch(email) {
        let keywordFound = Object.getOwnPropertyNames(email).some(field =>
            (this.fields.all || this.fields[field]) &&
            this.regex.test(email[field]));

        return keywordFound && this.labels.some(label => label == '*' ||
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
     */
    constructor(client, keywords, reporter) {
        this._client = client;
        this._rules = this._createRules(keywords);
        this._reporter = reporter;
    }

    /**
     * Cleans trash email from the mailbox.
     */
    async cleanTrash() {
        this._reporter.onStart();

        try {
            let emails = await this._findTrashEmails();

            await this.deleteTrashEmails(emails);
        }
        finally {
            this._reporter.onStop();
        }
    }

    /**
     * Deletes the trash emails.
     * 
     * @param {Email[]} emails The trash emails to delete. 
     */
    async deleteTrashEmails(emails) {
        if (emails.length == 0) {
            return;
        }

        this._reporter.onDeletingTrash();
        await this._client.deleteEmails(emails);
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
        let emails = await this._getUnreadEmails();

        return this.filterTrashEmails(emails);
    }

    /**
     * Filters out trash email from the list of emails.
     * 
     * @param {Email[]} emails The list of emails to filter. 
     * @returns {Email[]} The list of trash emails.
     */
    filterTrashEmails(emails) {
        let trashEmails = emails.map(this._normalizeEmail.bind(this))
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
            let emails = await this._client.getUnreadEmails();
            this._reporter.onUnreadEmailsRetrieved(emails);
            return emails;
        } catch (err) {
            throw new Error(`Failed to get trash emails: ${err}`);
        }
    }

    /**
     * Checks if a message is trash according to keywords list.
     * 
     * @param {Email} email The email to check.
     * @returns {boolean} True if the message is trash, False otherwise.
     */
    _isTrashEmail(email) {
        return this._rules.some(rule => rule.isMatch(email));
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
     * @param {boolean} cliMode Indicates if an interactive CLI mode is on.
     */
    constructor(configStore, cliMode) {
        this._configStore = configStore;
        this._cliMode = cliMode;
        this._gmailClientFactory = new GmailClientFactory(configStore);
    }

    /**
     * Creates an instance of TrashCleaner.
     * 
     * @returns {TrashCleaner} The TrashCleaner instance. 
     */
    async getInstance() {
        let client = await this._gmailClientFactory.getInstance();
        let keywords = await this.readKeywords();
        let reporter = new ConsoleProgressReporter(this._cliMode);
        let cleaner = new TrashCleaner(client, keywords, reporter);
        return cleaner;
    }

    /**
     * Reads the trash keywords from the config file.
     * 
     * @returns {TrashKeyword[]} A list of trash keywords.
     */
    async readKeywords() {
        let keywords = await this._configStore.get(FILE_KEYWORDS);
        return keywords.map(keyword => {
            let fields = this.splitAndTrim(keyword.fields, ',', '*');
            let labels = this.splitAndTrim(keyword.labels, ',', '*');
            return new TrashKeyword(keyword.value, fields, labels);
        });
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
    TrashKeyword,
    TrashCleaner,
    TrashCleanerFactory,
}