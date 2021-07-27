/**
 * Email object that represents a mail message in the mailbox.
 */
class Email {
    constructor() {
        this.id = '';
        this.labels = [];
        this.snippet = '';
        this.subject = '';
        this.from = '';
        this.body = '';
    }
}

/**
 * Base class for email client implementation.
 */
class EmailClient {
    /**
    * Gets the unread emails from the mailbox.
    * 
    * @returns {Email[]} A list of unread emails.
    */
    async getUnreadEmails() {
        return [];
    }

    /**
    * Deletes the emails.
    * 
    * @param {Email[]} emails A list of emails to delete.
    */
    async deleteEmails(emails) {
    }
}

/**
 * Factory for EmailClient objects.
 */
class EmailClientFactory {
    /**
     * Creates an instance of EmailClient.
     * 
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @returns {EmailClient} The email client. 
     */
    async getInstance(reconfig) {
    }
}

module.exports = { Email, EmailClient, EmailClientFactory }