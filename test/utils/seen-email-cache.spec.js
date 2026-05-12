import sinon from 'sinon';
import { assert } from 'chai';
import { SeenEmailCache } from '../../lib/utils/seen-email-cache.js';

describe('SeenEmailCache', () => {
    let configStore;

    beforeEach(() => {
        configStore = {
            getJson: sinon.stub(),
            putJson: sinon.stub().resolves()
        };
    });

    describe('computeRulesHash', () => {
        it('returns consistent hash for same input', () => {
            const rules = [{ value: 'casino', fields: '*' }];
            const hash1 = SeenEmailCache.computeRulesHash(rules);
            const hash2 = SeenEmailCache.computeRulesHash(rules);
            assert.equal(hash1, hash2);
        });

        it('returns different hash for different rules', () => {
            const hash1 = SeenEmailCache.computeRulesHash([{ value: 'casino' }]);
            const hash2 = SeenEmailCache.computeRulesHash([{ value: 'spam' }]);
            assert.notEqual(hash1, hash2);
        });
    });

    describe('load', () => {
        it('loads lastRun when rules hash matches', async () => {
            const rulesHash = SeenEmailCache.computeRulesHash([{ value: 'test' }]);
            const lastRun = '2026-05-12T10:00:00.000Z';
            configStore.getJson.withArgs('seen.json').resolves({
                rulesHash,
                lastRun
            });

            const cache = new SeenEmailCache(configStore, rulesHash);
            await cache.load();

            assert.deepEqual(cache.lastRun, new Date(lastRun));
        });

        it('invalidates when rules hash differs', async () => {
            configStore.getJson.withArgs('seen.json').resolves({
                rulesHash: 'old-hash',
                lastRun: '2026-05-12T10:00:00.000Z'
            });

            const cache = new SeenEmailCache(configStore, 'new-hash');
            await cache.load();

            assert.isNull(cache.lastRun);
        });

        it('handles missing seen.json gracefully', async () => {
            configStore.getJson.withArgs('seen.json').rejects(new Error('ENOENT'));

            const cache = new SeenEmailCache(configStore, 'hash');
            await cache.load();

            assert.isNull(cache.lastRun);
        });

        it('handles null data gracefully', async () => {
            configStore.getJson.withArgs('seen.json').resolves(null);

            const cache = new SeenEmailCache(configStore, 'hash');
            await cache.load();

            assert.isNull(cache.lastRun);
        });
    });

    describe('isSeen', () => {
        it('returns false when no lastRun', () => {
            const cache = new SeenEmailCache(configStore, 'hash');
            const email = { id: '1', _folder: 'INBOX', date: new Date('2026-05-10') };
            assert.isFalse(cache.isSeen(email));
        });

        it('returns false when email has no date', async () => {
            const rulesHash = 'hash';
            configStore.getJson.withArgs('seen.json').resolves({
                rulesHash,
                lastRun: '2026-05-12T10:00:00.000Z'
            });
            const cache = new SeenEmailCache(configStore, rulesHash);
            await cache.load();

            const email = { id: '1', _folder: 'INBOX', date: null };
            assert.isFalse(cache.isSeen(email));
        });

        it('returns true for email older than lastRun', async () => {
            const rulesHash = 'hash';
            configStore.getJson.withArgs('seen.json').resolves({
                rulesHash,
                lastRun: '2026-05-12T10:00:00.000Z'
            });
            const cache = new SeenEmailCache(configStore, rulesHash);
            await cache.load();

            const email = { id: '1', _folder: 'INBOX', date: new Date('2026-05-11T09:00:00.000Z') };
            assert.isTrue(cache.isSeen(email));
        });

        it('returns false for email newer than lastRun', async () => {
            const rulesHash = 'hash';
            configStore.getJson.withArgs('seen.json').resolves({
                rulesHash,
                lastRun: '2026-05-12T10:00:00.000Z'
            });
            const cache = new SeenEmailCache(configStore, rulesHash);
            await cache.load();

            const email = { id: '1', _folder: 'INBOX', date: new Date('2026-05-12T11:00:00.000Z') };
            assert.isFalse(cache.isSeen(email));
        });
    });

    describe('save', () => {
        it('persists rulesHash and lastRun timestamp', async () => {
            const cache = new SeenEmailCache(configStore, 'my-hash');
            await cache.save();

            assert.isTrue(configStore.putJson.calledOnce);
            const [key, data] = configStore.putJson.firstCall.args;
            assert.equal(key, 'seen.json');
            assert.equal(data.rulesHash, 'my-hash');
            assert.isString(data.lastRun);
            // Verify it's a valid ISO date
            assert.isFalse(isNaN(new Date(data.lastRun).getTime()));
        });
    });
});
