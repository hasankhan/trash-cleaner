/**
 * Base class for reporting progress of cleanup.
 */
class ProgressReporter {

    /**
     * An event that fires when cleaning has started.
     */
    onStart() { }

    /**
     * An event that fires when unread emails are being retrieved.
     */
    onRetrievingUnreadEmails() { };

    /**
     * An event that fires when unread emails are retrieved.
     *
     * @param {Email[]} emails The list of unread emails.
     */
    onUnreadEmailsRetrieved(emails) { };

    /**
     * An event that fires when trash emails are identified.
     *
     * @param {Email[]} emails The list of trash emails.
     */
    onTrashEmailsIdentified(emails) { };

    /**
     * An event that fires when trash emails are being deleted.
     */
    onDeletingTrash() { }

    /**
     * An event that fires when trash emails are deleted.
     */
    onTrashDeleted() { }

    /**
     * An event that fires when cleaning has stopped.
     */
    onStop() { }
}

module.exports = { ProgressReporter }