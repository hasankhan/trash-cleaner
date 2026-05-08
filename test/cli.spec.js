const fs = require('fs');
const path = require('path');
const os = require('os');
const sinon = require('sinon');
const { assert } = require('chai');
const { Cli } = require('../lib/cli');

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

        it('returns false and logs error message by default', async () => {
            const result = await cli.run(['node', 'trash-cleaner', '-c', '/nonexistent/path']);

            assert.isFalse(result);
            sinon.assert.calledOnce(console.error);
            // In non-debug mode, only err.message is logged
            assert.isString(console.error.firstCall.args[0]);
        });

        it('returns false and logs full error in debug mode', async () => {
            const result = await cli.run(['node', 'trash-cleaner', '-c', '/nonexistent/path', '-d']);

            assert.isFalse(result);
            sinon.assert.calledWith(console.error, 'An error occurred:', sinon.match.instanceOf(Error));
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
            const logCalls = console.log.args.map(a => a[0]);
            assert.isTrue(logCalls.some(msg => msg && msg.includes('1 trash email')));
        });

        it('cancels when user declines', async () => {
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
            assert.isTrue(logCalls.some(msg => msg && msg.includes('Cancelled')));
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
});
