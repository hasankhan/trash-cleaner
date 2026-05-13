import sinon from 'sinon';
import { assert } from 'chai';
import { ConsoleProgressReporter } from '../../lib/reporter/console-progress-reporter.js';
import { Email } from '../../lib/client/email-client.js';

describe('ConsoleProgressReporter', () => {
    let reporter: any;

    beforeEach(() => {
        reporter = new ConsoleProgressReporter(true /*cliMode*/);
        sinon.stub(reporter, '_log');
    });

    describe('onStart', () => {
        it('starts the spinner', () => {
            const mock = sinon.mock(reporter._spinner);
            mock.expects('start').withArgs('Starting cleaning...');

            reporter.onStart(true /*dryRun*/);

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
            (email as any)._action = 'delete';
            reporter.onTrashEmailsIdentified([email]);
            reporter.onUnreadEmailsRetrieved(new Array(3));

            sinon.stub(reporter._spinner, 'stop');

            reporter.onStop();

            const logCalls = reporter._log.args.map((a: any[]) => a[0]);
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('delete')));
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('sender')));
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('inbox')));
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('the subject')));
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('the snippet')));
            assert.isTrue(logCalls.includes('Total unread emails: 3'));
            assert.isTrue(logCalls.includes('Total trash emails:  1'));
            assert.isTrue(logCalls.includes('Dry-run mode: no actions were performed.'));
        });

        it('shows action breakdown with multiple actions', () => {
            sinon.stub(reporter._spinner, 'start');
            reporter.onStart(false /*dryRun*/);
            sinon.stub(reporter, '_update');

            const email1 = new Email();
            (email1 as any)._action = 'delete';
            email1.labels = ['spam'];
            const email2 = new Email();
            (email2 as any)._action = 'archive';
            email2.labels = ['inbox'];
            const email3 = new Email();
            (email3 as any)._action = 'archive';
            email3.labels = ['inbox'];

            reporter.onTrashEmailsIdentified([email1, email2, email3]);
            reporter.onUnreadEmailsRetrieved(new Array(5));

            sinon.stub(reporter._spinner, 'stop');

            reporter.onStop();

            // _log is already stubbed, check its calls
            const logCalls = reporter._log.args.map((a: any[]) => a[0]);
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('delete') && msg.includes('1')));
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('archive') && msg.includes('2')));
            assert.isTrue(logCalls.some((msg: string) => msg && msg.includes('Breakdown by action')));
            assert.isFalse(logCalls.some((msg: string) => msg && msg.includes('Dry-run')));
        });
    });

    describe('quiet mode', () => {
        let quietReporter: any;

        beforeEach(() => {
            quietReporter = new ConsoleProgressReporter(false, true /*quiet*/);
            sinon.stub(quietReporter, '_log');
        });

        it('does not create spinner in quiet mode', () => {
            assert.isUndefined(quietReporter._spinner);
        });

        it('suppresses per-email output in quiet mode', () => {
            quietReporter.onStart(false);

            const email = new Email();
            (email as any)._action = 'delete';
            email.labels = ['spam'];
            email.from = 'sender@test.com';
            email.subject = 'spam subject';
            email.snippet = 'spam snippet';

            quietReporter.onTrashEmailsIdentified([email]);
            quietReporter.onUnreadEmailsRetrieved(new Array(3));
            quietReporter.onStop();

            const logCalls = quietReporter._log.args.map((a: any[]) => a[0]);
            assert.isFalse(logCalls.some((msg: string) => msg && msg.includes('From:')));
            assert.isFalse(logCalls.some((msg: string) => msg && msg.includes('Subject:')));
        });

        it('outputs single-line summary in quiet mode', () => {
            quietReporter.onStart(false);

            const email = new Email();
            (email as any)._action = 'delete';
            email.labels = ['spam'];
            quietReporter.onTrashEmailsIdentified([email]);
            quietReporter.onUnreadEmailsRetrieved(new Array(5));
            quietReporter.onStop();

            const logCalls = quietReporter._log.args.map((a: any[]) => a[0]);
            assert.isTrue(logCalls.includes('Processed 1 trash emails out of 5 unread'));
        });

        it('shows dry-run in quiet summary', () => {
            quietReporter.onStart(true /*dryRun*/);

            const email = new Email();
            (email as any)._action = 'archive';
            email.labels = ['inbox'];
            quietReporter.onTrashEmailsIdentified([email]);
            quietReporter.onUnreadEmailsRetrieved(new Array(10));
            quietReporter.onStop();

            const logCalls = quietReporter._log.args.map((a: any[]) => a[0]);
            assert.isTrue(logCalls.includes('Processed 1 trash emails out of 10 unread (dry-run)'));
        });

        it('outputs nothing when no trash found in quiet mode', () => {
            quietReporter.onStart(false);
            quietReporter.onTrashEmailsIdentified([]);
            quietReporter.onUnreadEmailsRetrieved(new Array(5));
            quietReporter.onStop();

            const logCalls = quietReporter._log.args.map((a: any[]) => a[0]);
            assert.isEmpty(logCalls);
        });
    });
});
