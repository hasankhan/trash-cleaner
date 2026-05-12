/**
 * Base class for reporting progress of cleanup.
 */
class ProgressReporter {

    /**
     * An event that fires when cleaning has started.
     * 
     * @param {boolean} _dryRun Do a dry-run cleanup without deleting emails.
     */
    onStart(_dryRun) { }

    /**
     * An event that fires when unread emails are being retrieved.
     */
    onRetrievingUnreadEmails() { }

    /**
     * An event that fires when unread emails are retrieved.
     *
     * @param {import('../client/email-client.js').Email[]} _emails The list of unread emails.
     */
    onUnreadEmailsRetrieved(_emails) { }

    /**
     * An event that fires when trash emails are identified.
     *
     * @param {import('../client/email-client.js').Email[]} _emails The list of trash emails.
     */
    onTrashEmailsIdentified(_emails) { }

    /**
     * An event that fires when trash emails are being deleted.
     */
    onDeletingTrash() { }

    /**
     * An event that fires when trash emails are deleted.
     */
    onTrashDeleted() { }

    /**
     * An event that fires when processing an action on emails.
     *
     * @param {string} _action The action being performed.
     * @param {number} _count The number of emails being processed.
     */
    onProcessingAction(_action, _count) { }

    /**
     * An event that fires when an action is complete.
     *
     * @param {string} _action The action that was performed.
     * @param {number} _count The number of emails processed.
     */
    onActionComplete(_action, _count) { }

    /**
     * An event that fires when cleaning has stopped.
     */
    onStop() { }

    /**
     * Stops the spinner without printing summary output.
     */
    onStopSpinner() { }
}

export { ProgressReporter }