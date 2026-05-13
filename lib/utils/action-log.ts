import fs from 'fs';
import path from 'path';

const LOG_FILE = 'action-log.json';
const MAX_ENTRIES = 10;

interface ActionEntry {
    id: string;
    action: string;
    from: string;
    subject: string;
}

interface ActionBatch {
    timestamp: string;
    entries: ActionEntry[];
}

/**
 * Records processed email actions for undo support.
 */
class ActionLog {
    private readonly _filePath: string;

    constructor(configDir: string) {
        this._filePath = path.join(configDir, LOG_FILE);
    }

    /**
     * Records a batch of processed emails.
     */
    record(entries: ActionEntry[]): void {
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
     */
    getLastBatch(): ActionBatch | null {
        const log = this._read();
        return log.length > 0 ? log[0]! : null;
    }

    /**
     * Removes the most recent batch from the log.
     */
    removeLastBatch(): void {
        const log = this._read();
        if (log.length > 0) {
            log.shift();
            fs.writeFileSync(this._filePath, JSON.stringify(log, null, 2));
        }
    }

    /**
     * Reads the log file.
     */
    _read(): ActionBatch[] {
        try {
            const data = fs.readFileSync(this._filePath, 'utf8');
            return JSON.parse(data) as ActionBatch[];
        } catch {
            return [];
        }
    }
}

export { ActionLog, LOG_FILE };
export type { ActionEntry, ActionBatch };
