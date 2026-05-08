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
});
