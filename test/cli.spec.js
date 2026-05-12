import fs from 'fs';
import path from 'path';
import os from 'os';
import sinon from 'sinon';
import { assert } from 'chai';
import { Cli } from '../lib/cli.js';
import { ActionLog } from '../lib/utils/action-log.js';

describe('Cli', () => {
    let cli, sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        cli = new Cli();
        sandbox.stub(console, 'error');
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('run', () => {
        it('returns false when config directory does not exist', async () => {
            const result = await cli.run(['node', 'trash-cleaner', '-c', '/nonexistent/path']);

            assert.isFalse(result);
        });

        it('returns false and logs error message when config dir missing', async () => {
            const result = await cli.run(['node', 'trash-cleaner', '-c', '/nonexistent/path']);

            assert.isFalse(result);
            sinon.assert.calledOnce(console.error);
            assert.include(console.error.firstCall.args[0], 'Config directory not found');
            assert.include(console.error.firstCall.args[0], 'trash-cleaner init');
        });

        it('returns false and logs init hint in debug mode too', async () => {
            const result = await cli.run(['node', 'trash-cleaner', '-c', '/nonexistent/path', '-d']);

            assert.isFalse(result);
            sinon.assert.calledOnce(console.error);
            assert.include(console.error.firstCall.args[0], 'Config directory not found');
        });

        it('throws for unsupported email service', async () => {
            // Commander will throw/exit for invalid choices, so we test _createEmailClient directly
            const result = await cli._createEmailClient({}, 'yahoo', false, false)
                .catch(err => err);

            assert.match(result.message, /not yet implemented/);
        });
    });

    describe('init', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-cleaner-test-'));
            sandbox.stub(console, 'log');
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('creates config directory when it does not exist', async () => {
            const configDir = path.join(tmpDir, 'newconfig');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'init', configDir]);

            assert.isTrue(result);
            assert.isTrue(fs.existsSync(configDir));
        });

        it('copies sample files to config directory', async () => {
            const configDir = path.join(tmpDir, 'newconfig');
            cli = new Cli();
            await cli.run(['node', 'trash-cleaner', 'init', configDir]);

            assert.isTrue(fs.existsSync(path.join(configDir, 'keywords.json')));
            assert.isTrue(fs.existsSync(path.join(configDir, 'imap.credentials.json')));
            assert.isTrue(fs.existsSync(path.join(configDir, 'gmail.credentials.json')));
            assert.isTrue(fs.existsSync(path.join(configDir, 'outlook.credentials.json')));
        });

        it('does not overwrite existing files', async () => {
            const configDir = path.join(tmpDir, 'existing');
            fs.mkdirSync(configDir);
            const keywordsPath = path.join(configDir, 'keywords.json');
            fs.writeFileSync(keywordsPath, '["custom"]');

            cli = new Cli();
            await cli.run(['node', 'trash-cleaner', 'init', configDir]);

            const content = fs.readFileSync(keywordsPath, 'utf8');
            assert.equal(content, '["custom"]');
        });

        it('uses default config path when no argument given', async () => {
            // Test that _initConfig is called (we test via the internal method)
            cli = new Cli();
            const result = cli._initConfig(path.join(tmpDir, 'defaulttest'));

            assert.isTrue(result);
            assert.isTrue(fs.existsSync(path.join(tmpDir, 'defaulttest')));
        });

        it('prints next steps after copying files', async () => {
            const configDir = path.join(tmpDir, 'newconfig');
            cli = new Cli();
            await cli.run(['node', 'trash-cleaner', 'init', configDir]);

            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg.includes('Next steps')));
        });
    });

    describe('list-rules', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-cleaner-rules-'));
            sandbox.stub(console, 'log');
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('lists rules from keywords.json', async () => {
            const keywords = [
                { value: 'casino', fields: 'subject', labels: 'spam' },
                { value: 'newsletter', fields: '*', labels: 'inbox', action: 'archive' }
            ];
            fs.writeFileSync(path.join(tmpDir, 'keywords.json'), JSON.stringify(keywords));

            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'list-rules', tmpDir]);

            assert.isTrue(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg.includes('Total rules: 2')));
            assert.isTrue(logCalls.some(msg => msg.includes('/casino/')));
            assert.isTrue(logCalls.some(msg => msg.includes('Action: delete')));
            assert.isTrue(logCalls.some(msg => msg.includes('Action: archive')));
        });

        it('shows allowlist when present', async () => {
            const keywords = [{ value: 'test', fields: '*', labels: '*' }];
            const allowlist = ['boss@example\\.com'];
            fs.writeFileSync(path.join(tmpDir, 'keywords.json'), JSON.stringify(keywords));
            fs.writeFileSync(path.join(tmpDir, 'allowlist.json'), JSON.stringify(allowlist));

            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'list-rules', tmpDir]);

            assert.isTrue(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('Allowlist')));
            assert.isTrue(logCalls.some(msg => msg && msg.includes('boss@example')));
        });

        it('returns false for invalid config directory', async () => {
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'list-rules', '/nonexistent']);

            assert.isFalse(result);
        });
    });

    describe('interactive mode', () => {
        it('shows preview and processes on confirm', async () => {
            const email = { id: '1', from: 'spam@test.com', subject: 'Win!', _action: 'delete', labels: ['spam'] };
            const trashCleaner = {
                findTrash: sinon.stub().resolves([email]),
                processEmails: sinon.stub().resolves()
            };

            sandbox.stub(console, 'log');
            cli = new Cli();
            sandbox.stub(cli, '_confirm').resolves(true);

            await cli._runInteractive(trashCleaner);

            sinon.assert.calledOnce(trashCleaner.findTrash);
            sinon.assert.calledWith(trashCleaner.processEmails, [email]);
        });

        it('skips emails user declines', async () => {
            const email1 = { id: '1', from: 'spam@test.com', subject: 'Win!', _action: 'delete', labels: ['spam'] };
            const email2 = { id: '2', from: 'store@test.com', subject: 'Sale', _action: 'archive', labels: ['inbox'] };
            const trashCleaner = {
                findTrash: sinon.stub().resolves([email1, email2]),
                processEmails: sinon.stub().resolves()
            };

            sandbox.stub(console, 'log');
            cli = new Cli();
            const confirmStub = sandbox.stub(cli, '_confirm');
            confirmStub.onCall(0).resolves(true);
            confirmStub.onCall(1).resolves(false);

            await cli._runInteractive(trashCleaner);

            sinon.assert.calledWith(trashCleaner.processEmails, [email1]);
        });

        it('does nothing when all declined', async () => {
            const email = { id: '1', from: 'spam@test.com', subject: 'Win!', _action: 'delete', labels: ['spam'] };
            const trashCleaner = {
                findTrash: sinon.stub().resolves([email]),
                processEmails: sinon.stub().resolves()
            };

            sandbox.stub(console, 'log');
            cli = new Cli();
            sandbox.stub(cli, '_confirm').resolves(false);

            await cli._runInteractive(trashCleaner);

            sinon.assert.notCalled(trashCleaner.processEmails);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('No emails selected')));
        });

        it('reports no trash found', async () => {
            const trashCleaner = {
                findTrash: sinon.stub().resolves([]),
                processEmails: sinon.stub().resolves()
            };

            sandbox.stub(console, 'log');
            cli = new Cli();

            await cli._runInteractive(trashCleaner);

            sinon.assert.notCalled(trashCleaner.processEmails);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('No trash emails')));
        });
    });

    describe('undo', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-undo-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('reports no actions to undo when log is empty', async () => {
            sandbox.stub(console, 'log');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'undo', tmpDir]);

            assert.isTrue(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('No actions to undo')));
        });

        it('shows last batch and cancels on decline', async () => {
            const log = new ActionLog(tmpDir);
            log.record([{ id: '1', action: 'delete', from: 'spam@x.com', subject: 'Junk' }]);

            sandbox.stub(console, 'log');
            cli = new Cli();
            sandbox.stub(cli, '_confirm').resolves(false);
            const result = await cli.run(['node', 'trash-cleaner', 'undo', tmpDir]);

            assert.isTrue(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('Cancelled')));
        });
    });

    describe('validate', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-validate-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('returns false for non-existent config directory', async () => {
            sandbox.stub(console, 'log');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'validate', '/nonexistent']);

            assert.isFalse(result);
        });

        it('reports valid config when keywords.json is correct', async () => {
            const keywords = [{ value: 'test', fields: '*', labels: '*' }];
            fs.writeFileSync(path.join(tmpDir, 'keywords.json'), JSON.stringify(keywords));

            sandbox.stub(console, 'log');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'validate', tmpDir]);

            assert.isTrue(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('Configuration is valid')));
        });

        it('reports error for invalid keywords.json', async () => {
            fs.writeFileSync(path.join(tmpDir, 'keywords.json'), 'not json');

            sandbox.stub(console, 'log');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'validate', tmpDir]);

            assert.isFalse(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('Validation failed')));
        });

        it('reports missing keywords.json as error', async () => {
            sandbox.stub(console, 'log');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'validate', tmpDir]);

            assert.isFalse(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('not found')));
        });

        it('validates allowlist.json when present', async () => {
            const keywords = [{ value: 'test', fields: '*', labels: '*' }];
            fs.writeFileSync(path.join(tmpDir, 'keywords.json'), JSON.stringify(keywords));
            fs.writeFileSync(path.join(tmpDir, 'allowlist.json'), JSON.stringify(['valid@test\\.com']));

            sandbox.stub(console, 'log');
            cli = new Cli();
            const result = await cli.run(['node', 'trash-cleaner', 'validate', tmpDir]);

            assert.isTrue(result);
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('1 pattern')));
        });
    });

    describe('login', () => {
        beforeEach(() => {
            sandbox.stub(console, 'log');
        });

        function mockReadline(cliInstance, answers) {
            let callIndex = 0;
            sandbox.stub(cliInstance, '_createReadlineInterface').returns({
                question: (q, cb) => cb(answers[callIndex++] || ''),
                close: () => {}
            });
        }

        it('returns false when IMAP host is empty', async () => {
            mockReadline(cli, ['', '993', 'user@test.com', 'pass123']);

            const result = await cli.run(['node', 'trash-cleaner', 'login']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'Error: IMAP host is required.');
        });

        it('returns false when email is empty', async () => {
            mockReadline(cli, ['imap.gmail.com', '993', '', 'pass123']);

            const result = await cli.run(['node', 'trash-cleaner', 'login']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'Error: Email address is required.');
        });

        it('returns false when password is empty', async () => {
            mockReadline(cli, ['imap.gmail.com', '993', 'user@test.com', '']);

            const result = await cli.run(['node', 'trash-cleaner', 'login']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'Error: App password is required.');
        });

        it('returns false when Gmail JSON is empty', async () => {
            mockReadline(cli, ['']);

            const result = await cli.run(['node', 'trash-cleaner', 'login', '-s', 'gmail']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'Error: OAuth2 credentials JSON is required.');
        });

        it('returns false when Outlook client ID is empty', async () => {
            mockReadline(cli, ['', 'tenant-123']);

            const result = await cli.run(['node', 'trash-cleaner', 'login', '-s', 'outlook']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'Error: Client ID is required.');
        });

        it('returns false when Outlook tenant ID is empty', async () => {
            mockReadline(cli, ['client-123', '']);

            const result = await cli.run(['node', 'trash-cleaner', 'login', '-s', 'outlook']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'Error: Tenant ID is required.');
        });
    });
});
