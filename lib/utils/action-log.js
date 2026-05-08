const fs = require('fs');
const path = require('path');

const LOG_FILE = 'action-log.json';
const MAX_ENTRIES = 10;

/**
 * Records processed email actions for undo support.
 */
class ActionLog {
    /**
     * @param {string} configDir Path to the config directory.
     */
    constructor(configDir) {
        this._filePath = path.join(configDir, LOG_FILE);
    }

    /**
     * Records a batch of processed emails.
     *
     * @param {object[]} entries Array of { id, action, from, subject }.
     */
    record(entries) {
        if (!entries || entries.length === 0) return;

        const log = this._read();
        log.unshift({
            timestamp: new Date().toISOString(),
            entries
        });

        // Keep only the last MAX_ENTRIES batches
        if (log.length > MAX_ENTRIES) {
            log.length = MAX_ENTRIES;
        }

        fs.writeFileSync(this._filePath, JSON.stringify(log, null, 2));
    }

    /**
     * Gets the most recent batch of actions.
     *
     * @returns {object|null} The last batch or null if empty.
     */
    getLastBatch() {
        const log = this._read();
        return log.length > 0 ? log[0] : null;
    }

    /**
     * Removes the most recent batch from the log.
     */
    removeLastBatch() {
        const log = this._read();
        if (log.length > 0) {
            log.shift();
            fs.writeFileSync(this._filePath, JSON.stringify(log, null, 2));
        }
    }

    /**
     * Reads the log file.
     *
     * @returns {object[]} The log entries.
     */
    _read() {
        try {
            const data = fs.readFileSync(this._filePath, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }
}

module.exports = { ActionLog, LOG_FILE };
