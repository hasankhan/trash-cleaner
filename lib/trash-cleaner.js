const diacriticLess = require('diacriticless');
const fs = require('fs');
const path = require('path');

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
     * @param {string[]} labels The list of labels to search in. 
     */
    constructor(value, labels) {
        if (!value || !labels || !labels.length) {
            throw new Error("Invalid keyword");
        }
        this.value = value;
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
        if (!keyword || !keyword.value || !keyword.labels ||
            !keyword.labels.length) {
            throw new Error("Invalid keyword");
        }

        this.regex = new RegExp(keyword.value, 'gi'),
            this.labels = keyword.labels.map(l => l.toLowerCase())
    }

    /**
     * Applies the rule to the email attributes and returns result.
     * 
     * @param {Email} email The email to match the rule with.
     * @returns {boolean} True if the rule matches, False otherwise.
     */
    isMatch(email) {
        let found = this.regex.test(email.snippet) ||
            this.regex.test(email.subject) ||
            this.regex.test(email.from) ||
            this.regex.test(email.body);
        if (!found) {
            return false;
        }

        for (let label of this.labels) {
            if (label == "*" || email.labels.includes(label)) {
                return true;
            }
        }

        return false;
    }
}

/**
 * An object that can clean trash emails from the mailbox.
 */
class TrashCleaner {
    /**
     * Creates an instance of TrashCleaner.
     * 
     * @param {EmailClient} client 
     * @param {TrashKeyword[]} keywords 
     */
    constructor(client, keywords) {
        this._client = client;
        this._rules = this._createRules(keywords);
    }

    /**
     * Cleans trash email from the mailbox.
     */
    async cleanTrash() {
        let emails = await this._findTrashEmails();
        if (emails.length == 0) {
            console.log("No trash messages found!");
            return;
        }

        for (let email of emails) {
            this._logEmail(email);
        }

        await this._client.deleteEmails(emails);
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
        let emails;

        try {
            emails = await this._client.getUnreadEmails();
        } catch (err) {
            throw new Error(`Failed to get trash emails: ${err}`);
        }

        let trashEmails = emails.map(this._normalizeEmail.bind(this))
            .filter(this._isTrashEmail.bind(this));

        return trashEmails;
    }

    /**
     * Logs the key properties of an email to the console.
     * 
     * @param {Email} email The email to log. 
     */
    _logEmail(email) {
        console.log(`From: ${email.from}`);
        console.log(`Labels: ${email.labels}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Snippet: ${email.snippet}`);
        console.log(`Body: ${email.body}`);
        console.log('-'.repeat(60));
    }

    /**
     * Checks if a message is trash according to keywords list.
     * 
     * @param {Email} email The email to check.
     * @returns {boolean} True if the message is trash, False otherwise.
     */
    _isTrashEmail(email) {
        for (let rule of this._rules) {
            if (rule.isMatch(email)) {
                return true;
            }
        }

        return false;
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
     * @param {string} configDirPath The path to config directory.
     */
    constructor(configDirPath) {
        this.keywordsPath = path.join(configDirPath, FILE_KEYWORDS);
        this.gmailClientFactory = new GmailClientFactory(configDirPath);
    }

    /**
     * Creates an instance of TrashCleaner.
     * 
     * @returns {TrashCleaner} The TrashCleaner instance. 
     */
    async getInstance() {
        let client = await this.gmailClientFactory.getInstance();
        let keywords = this.readKeywords();
        let cleaner = new TrashCleaner(client, keywords);
        return cleaner;
    }

    /**
     * Reads the trash keywords from the config file.
     * 
     * @returns {TrashKeyword[]} A list of trash keywords.
     */
    readKeywords() {
        return JSON.parse(fs.readFileSync(this.keywordsPath))
            .map(keyword => new TrashKeyword(keyword.value, keyword.labels));
    }
}

module.exports = { TrashKeyword, TrashCleaner, TrashCleanerFactory }