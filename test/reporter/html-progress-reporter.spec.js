import fs from 'fs';
import path from 'path';
import os from 'os';
import sinon from 'sinon';
import { assert } from 'chai';
import { HtmlProgressReporter } from '../../lib/reporter/html-progress-reporter.js';
import { Email } from '../../lib/client/email-client.js';

describe('HtmlProgressReporter', () => {
    let reporter, tmpDir, outputPath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-cleaner-html-'));
        outputPath = path.join(tmpDir, 'report.html');
        reporter = new HtmlProgressReporter(outputPath);
        sinon.stub(console, 'log');
    });

    afterEach(() => {
        console.log.restore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes HTML file on stop', () => {
        reporter.onStart(false);
        reporter.onUnreadEmailsRetrieved(new Array(5));
        reporter.onTrashEmailsIdentified([]);
        reporter.onStop();

        assert.isTrue(fs.existsSync(outputPath));
    });

    it('includes email count in report', () => {
        reporter.onStart(false);
        reporter.onUnreadEmailsRetrieved(new Array(10));
        reporter.onTrashEmailsIdentified([]);
        reporter.onStop();

        const html = fs.readFileSync(outputPath, 'utf8');
        assert.include(html, '10');
        assert.include(html, 'Unread emails');
    });

    it('includes trash email details in table', () => {
        const email = new Email();
        email.id = '1';
        email.from = 'spammer@test.com';
        email.subject = 'Win big!';
        email.labels = ['spam'];
        email._action = 'delete';

        reporter.onStart(false);
        reporter.onUnreadEmailsRetrieved(new Array(5));
        reporter.onTrashEmailsIdentified([email]);
        reporter.onStop();

        const html = fs.readFileSync(outputPath, 'utf8');
        assert.include(html, 'spammer@test.com');
        assert.include(html, 'Win big!');
        assert.include(html, 'delete');
    });

    it('shows dry-run badge when in dry-run mode', () => {
        reporter.onStart(true /* dryRun */);
        reporter.onUnreadEmailsRetrieved([]);
        reporter.onTrashEmailsIdentified([]);
        reporter.onStop();

        const html = fs.readFileSync(outputPath, 'utf8');
        assert.include(html, 'Dry-run mode');
    });

    it('escapes HTML in email fields', () => {
        const email = new Email();
        email.id = '1';
        email.from = '<script>alert("xss")</script>';
        email.subject = 'Test & "subject"';
        email.labels = ['inbox'];
        email._action = 'delete';

        reporter.onStart(false);
        reporter.onUnreadEmailsRetrieved([email]);
        reporter.onTrashEmailsIdentified([email]);
        reporter.onStop();

        const html = fs.readFileSync(outputPath, 'utf8');
        assert.include(html, '&lt;script&gt;');
        assert.include(html, '&amp;');
        assert.include(html, '&quot;subject&quot;');
        assert.notInclude(html, '<script>alert');
    });

    it('shows action breakdown stats', () => {
        const email1 = new Email();
        email1._action = 'delete';
        email1.from = 'a@test.com';
        email1.subject = 'spam';
        email1.labels = ['spam'];

        const email2 = new Email();
        email2._action = 'archive';
        email2.from = 'b@test.com';
        email2.subject = 'news';
        email2.labels = ['inbox'];

        reporter.onStart(false);
        reporter.onUnreadEmailsRetrieved(new Array(10));
        reporter.onTrashEmailsIdentified([email1, email2]);
        reporter.onStop();

        const html = fs.readFileSync(outputPath, 'utf8');
        assert.include(html, 'Deleted');
        assert.include(html, 'Archived');
    });

    it('logs output path to console', () => {
        reporter.onStart(false);
        reporter.onUnreadEmailsRetrieved([]);
        reporter.onTrashEmailsIdentified([]);
        reporter.onStop();

        sinon.assert.calledOnce(console.log);
        assert.include(console.log.firstCall.args[0], 'HTML report written to');
    });
});
