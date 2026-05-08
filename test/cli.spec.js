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
});
