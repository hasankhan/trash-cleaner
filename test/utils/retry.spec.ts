import sinon from 'sinon';
import { assert } from 'chai';
import { retry, isRetryableError } from '../../lib/utils/retry.js';

describe('retry', () => {
    it('returns result on first success', async () => {
        const fn = sinon.stub().resolves('success');
        const result = await retry(fn, { baseDelay: 1 });
        assert.equal(result, 'success');
        sinon.assert.calledOnce(fn);
    });

    it('retries on retryable error and succeeds', async () => {
        const fn = sinon.stub();
        fn.onFirstCall().rejects({ response: { status: 429 } });
        fn.onSecondCall().resolves('ok');

        const result = await retry(fn, { baseDelay: 1 });
        assert.equal(result, 'ok');
        sinon.assert.calledTwice(fn);
    });

    it('retries up to maxRetries times', async () => {
        const err = { response: { status: 503 } };
        const fn = sinon.stub().rejects(err);

        try {
            await retry(fn, { maxRetries: 2, baseDelay: 1 });
            assert.fail('should throw');
        } catch (e) {
            assert.equal(e, err);
        }
        assert.equal(fn.callCount, 3); // initial + 2 retries
    });

    it('does not retry non-retryable errors', async () => {
        const err = new Error('bad request') as any;
        err.response = { status: 400 };
        const fn = sinon.stub().rejects(err);

        try {
            await retry(fn, { baseDelay: 1 });
            assert.fail('should throw');
        } catch (e) {
            assert.equal(e, err);
        }
        sinon.assert.calledOnce(fn);
    });

    it('uses custom shouldRetry predicate', async () => {
        const fn = sinon.stub();
        fn.onFirstCall().rejects(new Error('custom'));
        fn.onSecondCall().resolves('done');

        const result = await retry(fn, {
            baseDelay: 1,
            shouldRetry: (err: Error) => err.message === 'custom'
        });
        assert.equal(result, 'done');
    });

    it('applies exponential backoff delay', async () => {
        const fn = sinon.stub();
        fn.onFirstCall().rejects({ response: { status: 500 } });
        fn.onSecondCall().rejects({ response: { status: 500 } });
        fn.onThirdCall().resolves('done');

        const start = Date.now();
        await retry(fn, { baseDelay: 10, maxRetries: 3 });
        const elapsed = Date.now() - start;

        // baseDelay * 2^0 + baseDelay * 2^1 = 10 + 20 = 30ms minimum
        assert.isAtLeast(elapsed, 20);
    });
});

describe('isRetryableError', () => {
    it('returns true for 429 rate limit', () => {
        assert.isTrue(isRetryableError({ response: { status: 429 } }));
    });

    it('returns true for 500 server error', () => {
        assert.isTrue(isRetryableError({ response: { status: 500 } }));
    });

    it('returns true for 502 bad gateway', () => {
        assert.isTrue(isRetryableError({ response: { status: 502 } }));
    });

    it('returns true for 503 service unavailable', () => {
        assert.isTrue(isRetryableError({ response: { status: 503 } }));
    });

    it('returns true for ECONNRESET', () => {
        assert.isTrue(isRetryableError({ code: 'ECONNRESET' }));
    });

    it('returns true for ETIMEDOUT', () => {
        assert.isTrue(isRetryableError({ code: 'ETIMEDOUT' }));
    });

    it('returns true for Network Error message', () => {
        assert.isTrue(isRetryableError({ message: 'Network Error' }));
    });

    it('returns false for 400 bad request', () => {
        assert.isFalse(isRetryableError({ response: { status: 400 } }));
    });

    it('returns false for 401 unauthorized', () => {
        assert.isFalse(isRetryableError({ response: { status: 401 } }));
    });

    it('returns false for generic error', () => {
        assert.isFalse(isRetryableError(new Error('something went wrong')));
    });
});
