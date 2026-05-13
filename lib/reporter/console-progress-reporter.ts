import ora, { Ora } from 'ora';
import chalk from 'chalk';
import { ProgressReporter } from './progress-reporter.js';
import { Email } from '../client/email-client.js';

/**
 * A progress reporter that prints the progress on console.
 */
class ConsoleProgressReporter extends ProgressReporter {
    private _quiet: boolean;
    private _spinner: Ora | undefined;
    private _dryRun: boolean = false;
    private _trashEmails: Email[] = [];
    private _unreadEmailCount: number = 0;

    /**
     * Creates an instance of ConsoleProgressReporter.
     */
    constructor(cliMode: boolean, quiet: boolean = false) {
        super();
        this._quiet = quiet;

        if (cliMode) {
            this._spinner = ora({ interval: 250 });
        }
    }

    /**
     * An event that fires when cleaning has started.
     */
    onStart(dryRun: boolean): void {
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
    onRetrievingUnreadEmails(): void {
        this._update('Retrieving emails...');
    }

    /**
     * An event that fires when unread emails are retrieved.
     */
    onUnreadEmailsRetrieved(emails: Email[]): void {
        this._unreadEmailCount = emails.length;
        this._update(`Retrieved ${emails.length} emails.`);
    }

    /**
     * An event that fires when trash emails are identified.
     */
    onTrashEmailsIdentified(emails: Email[]): void {
        this._trashEmails = emails;
        this._update(`Found ${emails.length} trash emails.`);
    }

    /**
     * An event that fires when evaluating an email against rules.
     */
    onEvaluatingEmail(current: number, total: number): void {
        this._update(`Evaluating emails... (${current}/${total})`);
    }

    /**
     * An event that fires when trash emails are being deleted.
     */
    onDeletingTrash(): void {
        this._update('Deleting trash emails...');
    }

    /**
     * An event that fires when trash emails are deleted.
     */
    onTrashDeleted(): void {
        this._update(`Trash emails${this._dryRun ? ' not' : ''} deleted.`);
    }

    /**
     * An event that fires when processing an action on emails.
     */
    onProcessingAction(action: string, count: number): void {
        const verb = action === 'delete' ? 'Deleting' :
            action === 'archive' ? 'Archiving' : 'Marking as read';
        this._update(`${verb} ${count} email(s)...`);
    }

    /**
     * An event that fires when an action is complete.
     */
    onActionComplete(action: string, count: number): void {
        const verb = action === 'delete' ? 'Deleted' :
            action === 'archive' ? 'Archived' : 'Marked as read';
        const status = this._dryRun ? ` (dry-run, not ${action === 'mark-as-read' ? 'marked' : action + 'd'})` : '';
        this._update(`${verb} ${count} email(s)${status}.`);
    }

    /**
     * An event that fires when cleaning has stopped.
     */
    onStop(): void {
        if (this._spinner) {
            this._spinner.stop();
        }
        this._logTrashEmails();
        this._printSummary();
    }

    /**
     * Stops the spinner without printing summary output.
     */
    onStopSpinner(): void {
        if (this._spinner) {
            this._spinner.stop();
        }
    }

    /**
     * Prints the summary of the cleanup operation.
     */
    private _printSummary(): void {
        if (this._quiet) {
            if (this._trashEmails.length > 0) {
                this._log(`Processed ${this._trashEmails.length} trash emails out of ${this._unreadEmailCount} unread${this._dryRun ? ' (dry-run)' : ''}`);
            }
            return;
        }

        this._log('');
        this._log(`Total unread emails: ${this._unreadEmailCount}`);
        this._log(`Total trash emails:  ${this._trashEmails.length}`);

        if (this._trashEmails.length > 0) {
            const actionCounts: Record<string, number> = {};
            for (const email of this._trashEmails) {
                const action = email._action || 'delete';
                actionCounts[action] = (actionCounts[action] || 0) + 1;
            }

            this._log('');
            this._log(chalk.bold('Breakdown by action:'));
            for (const [action, count] of Object.entries(actionCounts)) {
                const verb = this._dryRun ? 'would be ' : '';
                const label = action === 'delete' ? `${verb}deleted` :
                    action === 'archive' ? `${verb}archived` :
                        `${verb}marked as read`;
                this._log(`  ${this._colorAction(action)}: ${count} ${label}`);
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
    private _logTrashEmails(): void {
        if (this._quiet || this._trashEmails.length === 0) {
            return;
        }
        this._trashEmails.forEach(this._logEmail.bind(this));
    }

    /**
     * Shows an update message.
     */
    private _update(message: string): void {
        if (this._spinner) {
            this._spinner.text = message;
        }
    }

    /**
     * Logs the key properties of an email to the console.
     */
    private _logEmail(email: Email): void {
        const action = email._action || 'delete';
        this._log(`${chalk.bold('Action:')} ${this._colorAction(action)}`);
        if (email._rule) {
            this._log(`${chalk.bold('Rule:')} ${email._rule}`);
        }
        this._log(`${chalk.bold('From:')} ${email.from}`);
        this._log(`${chalk.bold('Labels:')} ${email.labels}`);
        this._log(`${chalk.bold('Subject:')} ${email.subject}`);
        this._log(`${chalk.dim('Snippet:')} ${chalk.dim(email.snippet)}`);
        this._log(chalk.gray('-'.repeat(60)));
    }

    /**
     * Returns a color-coded action label.
     */
    private _colorAction(action: string): string {
        switch (action) {
            case 'delete': return chalk.red(action);
            case 'archive': return chalk.yellow(action);
            case 'mark-as-read': return chalk.blue(action);
            default: return action;
        }
    }

    /**
     * Logs the message to console.
     */
    private _log(message: string): void {
        console.log(message);
    }
}

export { ConsoleProgressReporter };
