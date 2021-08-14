const sinon = require('sinon');
const { assert } = require('chai');
const { ConsoleProgressReporter } = require('../../lib/reporter/console-progress-reporter');
const { Email } = require('../../lib/client/email-client');

describe('ConsoleProgressReporter', () => {
    var reporter;

    beforeEach(() => {
        reporter = new ConsoleProgressReporter(true /*cliMode*/)
    });

    describe('onStart', () => {
        it('starts the spinner', () => {
            let mock = sinon.mock(reporter._spinner);
            mock.expects('start').withArgs('Starting cleaning...');

            reporter.onStart(true /*dryRun*/);

            assert.equal(250, reporter._spinner.interval);
            mock.verify();
        });
    });

    describe('onRetrievingUnreadEmails', () => {
        it('prings a message', () => {
            let mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Retrieving emails...');

            reporter.onRetrievingUnreadEmails();

            mock.verify();
        });
    });

    describe('onUnreadEmailsRetrieved', () => {
        it('prings a message', () => {
            let mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Retrieved 10 emails.');

            reporter.onUnreadEmailsRetrieved(new Array(10));

            mock.verify();
        });
    });

    describe('onTrashEmailsIdentified', () => {
        it('prings a message', () => {
            let mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Found 10 trash emails.');

            reporter.onTrashEmailsIdentified(new Array(10));

            mock.verify();
        });
    });

    describe('onDeletingTrash', () => {
        it('prings a message', () => {
            let mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Deleting trash emails...');

            reporter.onDeletingTrash();

            mock.verify();
        });
    });

    describe('onTrashDeleted', () => {
        [
            { dryRun: true, message: 'Trash emails not deleted.' },
            { dryRun: false, message: 'Trash emails deleted.' }
        ].forEach(data =>
            it(`prints dryrun status: dryRun = ${data.dryRun}`, () => {
                let mock = sinon.mock(reporter);

                sinon.stub(reporter._spinner, 'start');
                mock.expects('_update').withArgs(data.message);

                reporter.onStart(data.dryRun);
                reporter.onTrashDeleted();

                mock.verify();
            }));
    });

    describe('onStop', () => {
        before(() => {
            sinon.stub(reporter, '_log');
        });

        it('stops the spinner', () => {
            let mock = sinon.mock(reporter._spinner);
            mock.expects('stop').once();
            mock.expects('start');

            reporter.onStart(true /*true*/);
            reporter.onStop();

            mock.verify();
        });

        it('logs trash emails', () => {
            sinon.stub(reporter._spinner, 'start');
            reporter.onStart(true /*dryRun*/);

            sinon.stub(reporter, '_update');

            let email = new Email();
            email.id = 'myid';
            email.labels = ['inbox'];
            email.snippet = 'the snippet';
            email.subject = 'the subject';
            email.from = 'sender';
            email.body = 'the body';
            reporter.onTrashEmailsIdentified([email]);
            reporter.onUnreadEmailsRetrieved(new Array(3));

            let mock = sinon.mock(reporter);

            mock.expects('_log').withArgs('From: sender');
            mock.expects('_log').withArgs('Labels: inbox');
            mock.expects('_log').withArgs('Subject: the subject');
            mock.expects('_log').withArgs('Snippet: the snippet');
            mock.expects('_log').withArgs('Body: the body');
            mock.expects('_log').withArgs('-'.repeat(60));

            mock.expects('_log').withArgs('Total no. of unread emails: 3');
            mock.expects('_log').withArgs('Total no. of trash emails: 1');
            mock.expects('_log').withArgs('');
            mock.expects('_log').withArgs('Emails not deleted in dry-run mode.');

            sinon.stub(reporter._spinner, 'stop');
            reporter.onStop();

            mock.verify();
        });
    });
});
