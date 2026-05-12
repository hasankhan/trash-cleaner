import { createHash } from 'crypto';

const FILE_SEEN = 'seen.json';

/**
 * Tracks the last completed run timestamp so that subsequent runs only
 * evaluate emails received after that point.  The timestamp resets when
 * the rules config changes (detected via a SHA-256 hash).
 *
 * Stored format: `{ rulesHash: string, lastRun: string (ISO-8601) }`
 */
class SeenEmailCache {
    /**
     * @param {import('../store/config-store.js').ConfigStore} configStore
     * @param {string} rulesHash SHA-256 hex digest of the current rules.
     */
    constructor(configStore, rulesHash) {
        this._configStore = configStore;
        this._rulesHash = rulesHash;
        /** @type {Date|null} */
        this._lastRun = null;
    }

    /**
     * Loads the cache from disk.  If the stored rules hash does not match
     * the current one the timestamp is discarded and all emails will be
     * re-evaluated.
     */
    async load() {
        let data;
        try {
            data = await this._configStore.getJson(FILE_SEEN);
        } catch {
            // File missing or unreadable — start fresh.
            return;
        }

        if (!data || typeof data !== 'object') {
            return;
        }

        if (data.rulesHash !== this._rulesHash) {
            // Rules changed — invalidate.
            return;
        }

        if (data.lastRun) {
            this._lastRun = new Date(data.lastRun);
        }
    }

    /**
     * Returns true if the email was received before the last completed run
     * and therefore does not need to be re-evaluated.
     *
     * @param {import('../client/email-client.js').Email} email
     * @returns {boolean}
     */
    isSeen(email) {
        if (!this._lastRun || !email.date) {
            return false;
        }
        return email.date < this._lastRun;
    }

    /**
     * Persists the current time as the last-run timestamp.
     */
    async save() {
        await this._configStore.putJson(FILE_SEEN, {
            rulesHash: this._rulesHash,
            lastRun: new Date().toISOString()
        });
    }

    /**
     * Returns the last-run timestamp, or null if no previous run.
     *
     * @returns {Date|null}
     */
    get lastRun() {
        return this._lastRun;
    }

    /**
     * Computes a SHA-256 hash of a keywords configuration array.
     *
     * @param {object[]} keywords Raw keywords array from config.
     * @returns {string} Hex digest.
     */
    static computeRulesHash(keywords) {
        const json = JSON.stringify(keywords);
        return createHash('sha256').update(json).digest('hex');
    }
}

export { SeenEmailCache };
