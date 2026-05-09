import fs from 'fs';
import path from 'path';
import os from 'os';
import { assert } from 'chai';
import { ActionLog } from '../../lib/utils/action-log.js';

describe('ActionLog', () => {
    let tmpDir, actionLog;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-log-'));
        actionLog = new ActionLog(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('record', () => {
        it('writes entries to action-log.json', () => {
            const entries = [
                { id: '1', action: 'delete', from: 'spam@test.com', subject: 'Win!' }
            ];
            actionLog.record(entries);

            const logFile = path.join(tmpDir, 'action-log.json');
            assert.isTrue(fs.existsSync(logFile));
            const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
            assert.lengthOf(data, 1);
            assert.deepEqual(data[0].entries, entries);
            assert.isString(data[0].timestamp);
        });

        it('prepends new batches to log', () => {
            actionLog.record([{ id: '1', action: 'delete', from: 'a', subject: 'a' }]);
            actionLog.record([{ id: '2', action: 'archive', from: 'b', subject: 'b' }]);

            const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'action-log.json'), 'utf8'));
            assert.lengthOf(data, 2);
            assert.equal(data[0].entries[0].id, '2');
            assert.equal(data[1].entries[0].id, '1');
        });

        it('limits to max 10 entries', () => {
            for (let i = 0; i < 12; i++) {
                actionLog.record([{ id: String(i), action: 'delete', from: 'x', subject: 'x' }]);
            }

            const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'action-log.json'), 'utf8'));
            assert.lengthOf(data, 10);
        });

        it('does nothing for empty entries', () => {
            actionLog.record([]);
            const logFile = path.join(tmpDir, 'action-log.json');
            assert.isFalse(fs.existsSync(logFile));
        });

        it('does nothing for null entries', () => {
            actionLog.record(null);
            const logFile = path.join(tmpDir, 'action-log.json');
            assert.isFalse(fs.existsSync(logFile));
        });
    });

    describe('getLastBatch', () => {
        it('returns null when no log exists', () => {
            assert.isNull(actionLog.getLastBatch());
        });

        it('returns the most recent batch', () => {
            actionLog.record([{ id: '1', action: 'delete', from: 'a', subject: 'a' }]);
            actionLog.record([{ id: '2', action: 'archive', from: 'b', subject: 'b' }]);

            const batch = actionLog.getLastBatch();
            assert.equal(batch.entries[0].id, '2');
        });
    });

    describe('removeLastBatch', () => {
        it('removes the most recent batch', () => {
            actionLog.record([{ id: '1', action: 'delete', from: 'a', subject: 'a' }]);
            actionLog.record([{ id: '2', action: 'archive', from: 'b', subject: 'b' }]);

            actionLog.removeLastBatch();

            const batch = actionLog.getLastBatch();
            assert.equal(batch.entries[0].id, '1');
        });

        it('does nothing when log is empty', () => {
            actionLog.removeLastBatch(); // should not throw
            assert.isNull(actionLog.getLastBatch());
        });
    });
});
