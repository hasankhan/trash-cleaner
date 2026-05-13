import { createHash } from 'crypto';
import type { ConfigStore } from '../store/config-store.js';
import type { Email } from '../client/email-client.js';

const FILE_SEEN = 'seen.json';

interface SeenData {
    rulesHash: string;
    lastRun: string;
}

/**
 * Tracks the last completed run timestamp so that subsequent runs only
 * evaluate emails received after that point.  The timestamp resets when
 * the rules config changes (detected via a SHA-256 hash).
 *
 * Stored format: `{ rulesHash: string, lastRun: string (ISO-8601) }`
 */
class SeenEmailCache {
    private readonly _configStore: ConfigStore;
    private readonly _rulesHash: string;
    private _lastRun: Date | null;

    constructor(configStore: ConfigStore, rulesHash: string) {
        this._configStore = configStore;
        this._rulesHash = rulesHash;
        this._lastRun = null;
    }

    /**
     * Loads the cache from disk.  If the stored rules hash does not match
     * the current one the timestamp is discarded and all emails will be
     * re-evaluated.
     */
    async load(): Promise<void> {
        let data: unknown;
        try {
            data = await this._configStore.getJson(FILE_SEEN);
        } catch {
            // File missing or unreadable — start fresh.
            return;
        }

        if (!data || typeof data !== 'object') {
            return;
        }

        const seenData = data as SeenData;

        if (seenData.rulesHash !== this._rulesHash) {
            // Rules changed — invalidate.
            return;
        }

        if (seenData.lastRun) {
            this._lastRun = new Date(seenData.lastRun);
        }
    }

    /**
     * Returns true if the email was received before the last completed run
     * and therefore does not need to be re-evaluated.
     */
    isSeen(email: Email): boolean {
        if (!this._lastRun || !email.date) {
            return false;
        }
        return email.date < this._lastRun;
    }

    /**
     * Persists the current time as the last-run timestamp.
     */
    async save(): Promise<void> {
        await this._configStore.putJson(FILE_SEEN, {
            rulesHash: this._rulesHash,
            lastRun: new Date().toISOString()
        });
    }

    /**
     * Returns the last-run timestamp, or null if no previous run.
     */
    get lastRun(): Date | null {
        return this._lastRun;
    }

    /**
     * Computes a SHA-256 hash of a keywords configuration array.
     */
    static computeRulesHash(keywords: object[]): string {
        const json = JSON.stringify(keywords);
        return createHash('sha256').update(json).digest('hex');
    }
}

export { SeenEmailCache };
