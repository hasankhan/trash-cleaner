const sinon = require('sinon');
const { assert } = require('chai');
const { ConsoleProgressReporter } = require('../../lib/reporter/console-progress-reporter');
const { Email } = require('../../lib/client/email-client');

describe('ConsoleProgressReporter', () => {
    var reporter;

    beforeEach(() => {
        reporter = new ConsoleProgressReporter(true /*cliMode*/);
        sinon.stub(reporter, '_log');
    });

    describe('onStart', () => {
        it('starts the spinner', () => {
            const mock = sinon.mock(reporter._spinner);
            mock.expects('start').withArgs('Starting cleaning...');

            reporter.onStart(true /*dryRun*/);

            assert.equal(250, reporter._spinner.interval);
            mock.verify();
        });
    });

    describe('onRetrievingUnreadEmails', () => {
        it('prings a message', () => {
            const mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Retrieving emails...');

            reporter.onRetrievingUnreadEmails();

            mock.verify();
        });
    });

    describe('onUnreadEmailsRetrieved', () => {
        it('prings a message', () => {
            const mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Retrieved 10 emails.');

            reporter.onUnreadEmailsRetrieved(new Array(10));

            mock.verify();
        });
    });

    describe('onTrashEmailsIdentified', () => {
        it('prings a message', () => {
            const mock = sinon.mock(reporter);
            mock.expects('_update').withArgs('Found 10 trash emails.');

            reporter.onTrashEmailsIdentified(new Array(10));

            mock.verify();
        });
    });

    describe('onDeletingTrash', () => {
        it('prings a message', () => {
            const mock = sinon.mock(reporter);
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
                const mock = sinon.mock(reporter);

                sinon.stub(reporter._spinner, 'start');
                mock.expects('_update').withArgs(data.message);

                reporter.onStart(data.dryRun);
                reporter.onTrashDeleted();

                mock.verify();
            }));
    });

    describe('onStop', () => {
        it('stops the spinner', () => {
            const mock = sinon.mock(reporter._spinner);
            mock.expects('stop').once();
            mock.expects('start');

            reporter.onStart(true /*true*/);
            reporter.onStop();

            mock.verify();
        });

        it('logs trash emails with action', () => {
            sinon.stub(reporter._spinner, 'start');
            reporter.onStart(true /*dryRun*/);

            sinon.stub(reporter, '_update');

            const email = new Email();
            email.id = 'myid';
            email.labels = ['inbox'];
            email.snippet = 'the snippet';
            email.subject = 'the subject';
            email.from = 'sender';
            email.body = 'the body';
            email._action = 'delete';
            reporter.onTrashEmailsIdentified([email]);
            reporter.onUnreadEmailsRetrieved(new Array(3));

            sinon.stub(reporter._spinner, 'stop');
            reporter._log.restore(); // remove the stub

            const mock = sinon.mock(reporter);
            mock.expects('_log').withArgs('Action: delete');
            mock.expects('_log').withArgs('From: sender');
            mock.expects('_log').withArgs('Labels: inbox');
            mock.expects('_log').withArgs('Subject: the subject');
            mock.expects('_log').withArgs('Snippet: the snippet');
            mock.expects('_log').withArgs('-'.repeat(60));

            mock.expects('_log').withArgs(''); // before summary
            mock.expects('_log').withArgs('Total unread emails: 3');
            mock.expects('_log').withArgs('Total trash emails:  1');
            mock.expects('_log').withArgs('');
            mock.expects('_log').withArgs('Breakdown by action:');
            mock.expects('_log').withArgs('  would be deleted: 1');
            mock.expects('_log').withArgs('');
            mock.expects('_log').withArgs('Dry-run mode: no actions were performed.');

            reporter.onStop();

            mock.verify();
        });

        it('shows action breakdown with multiple actions', () => {
            sinon.stub(reporter._spinner, 'start');
            reporter.onStart(false /*dryRun*/);
            sinon.stub(reporter, '_update');

            const email1 = new Email();
            email1._action = 'delete';
            email1.labels = ['spam'];
            const email2 = new Email();
            email2._action = 'archive';
            email2.labels = ['inbox'];
            const email3 = new Email();
            email3._action = 'archive';
            email3.labels = ['inbox'];

            reporter.onTrashEmailsIdentified([email1, email2, email3]);
            reporter.onUnreadEmailsRetrieved(new Array(5));

            sinon.stub(reporter._spinner, 'stop');

            reporter.onStop();

            // _log is already stubbed, check its calls
            const logCalls = reporter._log.args.map(a => a[0]);
            assert.isTrue(logCalls.includes('  deleted: 1'));
            assert.isTrue(logCalls.includes('  archived: 2'));
            assert.isTrue(logCalls.includes('Breakdown by action:'));
            assert.isFalse(logCalls.some(msg => msg && msg.includes('Dry-run')));
        });
    });
});
