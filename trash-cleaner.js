const diacriticLess = require('diacriticless');
const fs = require('fs');
const path = require('path');

const { Email, EmailClient } = require('./email-client');
const { GmailClientFactory } = require('./gmail-client');

// The file keywords.json stores the keywords and labels to use when finding
// trash email.
const PATH_KEYWORDS = path.join(__dirname, 'keywords.json');

/**
 * An object that can clean trash emails from the mailbox.
 */
class TrashCleaner {
    /**
     * Creates an instance of TrashCleaner.
     * 
     * @param {EmailClient} client 
     * @param {Object[]} keywords 
     */
    constructor(client, keywords) {
        this._client = client;
        this._keywords = this._prepareKeywords(keywords);
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
     * Read the list of keywords and their labels for trash search.
     * 
     * @returns {[Object]} List of keywords and their labels for trash search.
     */
    _prepareKeywords(keywords) {
        return keywords.map(k => ({
            regex: new RegExp(k.val, 'gi'),
            labels: k.labels.map(l => l.toLowerCase())
        }));
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
        for (let keyword of this._keywords) {
            if (this._isTrashKeywordMatch(email, keyword)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Checks if an email is trash according to given keyword.
     * 
     * @param {Email} email The email to check.
     * @param {string} keyword The keyword to look for in the email.
     * @returns {boolean} True if the email is trash, False otherwise.
     */
    _isTrashKeywordMatch(email, keyword) {
        let found = keyword.regex.test(email.snippet) ||
            keyword.regex.test(email.subject) ||
            keyword.regex.test(email.from) ||
            keyword.regex.test(email.body);
        if (!found) {
            return false;
        }

        for (let label of keyword.labels) {
            if (label == "*" || email.labels.includes(label)) {
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
     * Creates an instance of TrashCleaner.
     * 
     * @returns {TrashCleaner} The TrashCleaner instance. 
     */
     async getInstance() {
        let client = await new GmailClientFactory().getInstance();
        let keywords = JSON.parse(fs.readFileSync(PATH_KEYWORDS));
        let cleaner = new TrashCleaner(client, keywords);
        return cleaner;
     }
}

module.exports = { TrashCleaner, TrashCleanerFactory }