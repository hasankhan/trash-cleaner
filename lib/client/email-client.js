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
        /** @type {Date|null} */
        this.date = null;
        /** @type {string|undefined} */
        this._action = undefined;
        /** @type {string} */
        this._folder = 'INBOX';
    }
}

/**
 * Base class for email client implementation.
 */
class EmailClient {
    /**
    * Gets the unread emails from the mailbox.
    * 
    * @returns {Promise<Email[]>} A list of unread emails.
    */
    async getUnreadEmails() {
        return [];
    }

    /**
    * Deletes the emails.
    * 
    * @param {Email[]} _emails A list of emails to delete.
    */
    async deleteEmails(_emails) {
    }

    /**
    * Archives the emails (removes from inbox).
    * 
    * @param {Email[]} _emails A list of emails to archive.
    */
    async archiveEmails(_emails) {
    }

    /**
    * Marks the emails as read.
    * 
    * @param {Email[]} _emails A list of emails to mark as read.
    */
    async markAsReadEmails(_emails) {
    }

    /**
     * Restores previously processed emails (moves from trash/archive back to inbox).
     * 
     * @param {string[]} _emailIds A list of email IDs to restore.
     */
    async restoreEmails(_emailIds) {
    }
}

/**
 * Factory for EmailClient objects.
 */
class EmailClientFactory {
    /**
     * Creates an instance of EmailClient.
     * 
     * @param {boolean} _reconfig Reconfigure auth secrets.
     * @param {boolean} _launch Launch the auth url in the browser. 
     * @returns {Promise<EmailClient>} The email client. 
     */
    async getInstance(_reconfig, _launch) {
        return new EmailClient();
    }
}

export { Email, EmailClient, EmailClientFactory }