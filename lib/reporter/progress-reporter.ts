import type { Email } from '../client/email-client.js';

/**
 * Base class for reporting progress of cleanup.
 */
class ProgressReporter {

    /**
     * An event that fires when cleaning has started.
     */
    onStart(_dryRun: boolean): void { }

    /**
     * An event that fires when unread emails are being retrieved.
     */
    onRetrievingUnreadEmails(): void { }

    /**
     * An event that fires when unread emails are retrieved.
     */
    onUnreadEmailsRetrieved(_emails: Email[]): void { }

    /**
     * An event that fires when trash emails are identified.
     */
    onTrashEmailsIdentified(_emails: Email[]): void { }

    /**
     * An event that fires when trash emails are being deleted.
     */
    onDeletingTrash(): void { }

    /**
     * An event that fires when trash emails are deleted.
     */
    onTrashDeleted(): void { }

    /**
     * An event that fires when processing an action on emails.
     */
    onProcessingAction(_action: string, _count: number): void { }

    /**
     * An event that fires when an action is complete.
     */
    onActionComplete(_action: string, _count: number): void { }

    /**
     * An event that fires when cleaning has stopped.
     */
    onStop(): void { }

    /**
     * Stops the spinner without printing summary output.
     */
    onStopSpinner(): void { }
}

export { ProgressReporter };
