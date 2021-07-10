const ora = require('ora');
const { ProgressReporter } = require('./progress-reporter');

/**
 * A progress reporter that prints the progress on console.
 */
class ConsoleProgressReporter extends ProgressReporter {

    /**
     * Creates an instance of ConsoleProgressReporter.
     *
     * @param {boolean} cliMode Indicates if an interactive CLI mode is on.
     */
    constructor(cliMode) {
        super();

        this._cliMode = cliMode;
    }

    /**
     * An event that fires when cleaning has started.
     */
    onStart() {
        if (this._cliMode) {
            this._spinner = ora('Starting cleaning...');
            this._spinner.interval = 250;
            this._spinner.start();
        }
        this._trashEmails = [];
        this._unreadEmailCount = 0;
    }

    /**
     * An event that fires when unread emails are being retrieved.
     */
    onRetrievingUnreadEmails() {
        this._update('Retrieving emails...');
    }

    /**
     * An event that fires when unread emails are retrieved.
     *
     * @param {Email[]} emails The list of unread emails.
     */
    onUnreadEmailsRetrieved(emails) {
        this._unreadEmailCount = emails.length;
        this._update(`Retrieved ${emails.length} emails.`);
    }

    /**
     * An event that fires when trash emails are identified.
     *
     * @param {Email[]} emails The list of trash emails.
     */
    onTrashEmailsIdentified(emails) {
        this._trashEmails = emails;
        this._update(`Found ${emails.length} trash emails.`);
    }

    /**
     * An event that fires when trash emails are being deleted.
     */
    onDeletingTrash() {
        this._update('Deleting trash emails...');
    }

    /**
     * An event that fires when trash emails are deleted.
     */
    onTrashDeleted() {
        this._update('Trash emails deleted.');
    }

    /**
     * An event that fires when cleaning has stopped.
     */
    onStop() {
        if (this._spinner) {
            this._spinner.stop();
        }
        this._logTrashEmails();
        this._printSummary();
    }

    /**
     * Prints the summary of the cleanup operation.
     */
    _printSummary() {
        console.log(`Total no. of unread emails: ${this._unreadEmailCount}`);
        console.log(`Total no. of trash emails: ${this._trashEmails.length}`);
    }

    /**
     * Logs the trash emails to console.
     */
    _logTrashEmails() {
        if (this._trashEmails.length > 0) {
            this._trashEmails.forEach(this._logEmail.bind(this));
        }
    }

    /**
     * Shows an update message.
     *
     * @param {string} message The update message.
     */
    _update(message) {
        if (this._cliMode) {
            this._spinner.text = message;
        }
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
}

module.exports = { ConsoleProgressReporter };
