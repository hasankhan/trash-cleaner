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
     * @param {boolean} quiet Suppress verbose output (only show final summary line).
     */
    constructor(cliMode, quiet = false) {
        super();
        this._quiet = quiet;

        if (cliMode) {
            this._spinner = ora();
            this._spinner.interval = 250;
        }
    }

    /**
     * An event that fires when cleaning has started.
     * 
     * @param {boolean} dryRun Do a dry-run cleanup without deleting emails.
     */
    onStart(dryRun) {
        if (this._spinner) {
            this._spinner.start('Starting cleaning...');
        }
        this._dryRun = dryRun;
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
        this._update(`Trash emails${this._dryRun ? ' not' : ''} deleted.`);
    }

    /**
     * An event that fires when processing an action on emails.
     *
     * @param {string} action The action being performed.
     * @param {number} count The number of emails being processed.
     */
    onProcessingAction(action, count) {
        const verb = action === 'delete' ? 'Deleting' :
            action === 'archive' ? 'Archiving' : 'Marking as read';
        this._update(`${verb} ${count} email(s)...`);
    }

    /**
     * An event that fires when an action is complete.
     *
     * @param {string} action The action that was performed.
     * @param {number} count The number of emails processed.
     */
    onActionComplete(action, count) {
        const verb = action === 'delete' ? 'Deleted' :
            action === 'archive' ? 'Archived' : 'Marked as read';
        const status = this._dryRun ? ` (dry-run, not ${action === 'mark-as-read' ? 'marked' : action + 'd'})` : '';
        this._update(`${verb} ${count} email(s)${status}.`);
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
        if (this._quiet) {
            // Single-line summary for scripts/cron
            if (this._trashEmails.length > 0) {
                this._log(`Processed ${this._trashEmails.length} trash emails out of ${this._unreadEmailCount} unread${this._dryRun ? ' (dry-run)' : ''}`);
            }
            return;
        }

        this._log('');
        this._log(`Total unread emails: ${this._unreadEmailCount}`);
        this._log(`Total trash emails:  ${this._trashEmails.length}`);

        if (this._trashEmails.length > 0) {
            const actionCounts = {};
            for (const email of this._trashEmails) {
                const action = email._action || 'delete';
                actionCounts[action] = (actionCounts[action] || 0) + 1;
            }

            this._log('');
            this._log('Breakdown by action:');
            for (const [action, count] of Object.entries(actionCounts)) {
                const verb = this._dryRun ? 'would be ' : '';
                const label = action === 'delete' ? `${verb}deleted` :
                    action === 'archive' ? `${verb}archived` :
                        `${verb}marked as read`;
                this._log(`  ${label}: ${count}`);
            }
        }

        if (this._dryRun) {
            this._log('');
            this._log('Dry-run mode: no actions were performed.');
        }
    }

    /**
     * Logs the trash emails to console.
     */
    _logTrashEmails() {
        if (this._quiet || this._trashEmails.length === 0) {
            return;
        }
        this._trashEmails.forEach(this._logEmail.bind(this));
    }

    /**
     * Shows an update message.
     *
     * @param {string} message The update message.
     */
    _update(message) {
        if (this._spinner) {
            this._spinner.text = message;
        }
    }

    /**
     * Logs the key properties of an email to the console.
     *
     * @param {Email} email The email to log.
     */
    _logEmail(email) {
        const action = email._action || 'delete';
        this._log(`Action: ${action}`);
        this._log(`From: ${email.from}`);
        this._log(`Labels: ${email.labels}`);
        this._log(`Subject: ${email.subject}`);
        this._log(`Snippet: ${email.snippet}`);
        this._log('-'.repeat(60));
    }

    /**
     * Logs the message to console.
     * 
     * @param {string} message The message to log.
     */
    _log(message) {
        console.log(message);
    }
}

module.exports = { ConsoleProgressReporter };
