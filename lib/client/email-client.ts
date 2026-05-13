/**
 * Email object that represents a mail message in the mailbox.
 */
class Email {
    id: string;
    labels: string[];
    snippet: string;
    subject: string;
    from: string;
    body: string;
    date: Date | null;
    _action: string | undefined;
    _rule: string | undefined;
    _folder: string;

    constructor() {
        this.id = '';
        this.labels = [];
        this.snippet = '';
        this.subject = '';
        this.from = '';
        this.body = '';
        this.date = null;
        this._action = undefined;
        this._rule = undefined;
        this._folder = 'INBOX';
    }
}

/**
 * Base class for email client implementation.
 */
class EmailClient {
    /**
     * Gets the unread emails from the mailbox.
     */
    async getUnreadEmails(_since?: Date): Promise<Email[]> {
        return [];
    }

    /**
     * Deletes the emails.
     */
    async deleteEmails(_emails: Email[]): Promise<void> {
    }

    /**
     * Archives the emails (removes from inbox).
     */
    async archiveEmails(_emails: Email[]): Promise<void> {
    }

    /**
     * Marks the emails as read.
     */
    async markAsReadEmails(_emails: Email[]): Promise<void> {
    }

    /**
     * Restores previously processed emails (moves from trash/archive back to inbox).
     */
    async restoreEmails(_emailIds: string[]): Promise<void> {
    }
}

/**
 * Factory for EmailClient objects.
 */
class EmailClientFactory {
    /**
     * Creates an instance of EmailClient.
     */
    async getInstance(_reconfig: boolean, _launch: boolean): Promise<EmailClient> {
        return new EmailClient();
    }
}

export { Email, EmailClient, EmailClientFactory };
