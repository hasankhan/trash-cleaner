import fs from 'fs';
import path from 'path';
import tmp from 'tmp';

import { assert } from 'chai';
import { FileSystemConfigStore } from '../../lib/store/file-system-config-store.js';

const FILE_TEST = 'test.json';

describe('FileSystemConfigStore', () => {
    var configDirPath, cleanupDir;

    before((done) => {
        tmp.dir((err, path, cleanup) => {
            if (err) throw err;

            configDirPath = path;
            cleanupDir = cleanup;
            done();
        });
    });

    after(() => {
        if (cleanupDir) {
            cleanupDir();
        }
    });

    describe('constructor', () => {
        it('throws for non-existent directory', () => {
            assert.throws(
                () => new FileSystemConfigStore('/nonexistent/path'),
                /Config directory not found/
            );
        });

        it('accepts existing directory', () => {
            assert.doesNotThrow(() => new FileSystemConfigStore(configDirPath));
        });
    });

    describe('get', () => {
        it('parses value as json', async () => {
            var store = new FileSystemConfigStore(configDirPath);
            fs.writeFileSync(path.join(configDirPath, FILE_TEST), '[3]');

            const value = await store.getJson(FILE_TEST);

            assert.deepEqual(value, [3]);
        });

        it('returns null when key does not exist', async () => {
            var store = new FileSystemConfigStore(configDirPath);

            const value = await store.getJson(FILE_TEST + '.old');

            assert.isNull(value);
        });

        it('reads raw string value', async () => {
            var store = new FileSystemConfigStore(configDirPath);
            fs.writeFileSync(path.join(configDirPath, 'raw.txt'), 'hello world');

            const value = await store.get('raw.txt');

            assert.include(value.toString(), 'hello world');
        });
    });

    describe('put', () => {
        it('saves value as json', async () => {
            var store = new FileSystemConfigStore(configDirPath);
            await store.putJson(FILE_TEST, { val: 3 });

            const value = fs.readFileSync(path.join(configDirPath, FILE_TEST), 'utf-8');

            assert.equal(value, '{"val":3}');
        });

        it('saves raw string value', async () => {
            var store = new FileSystemConfigStore(configDirPath);
            await store.put('raw.txt', 'test data');

            const value = fs.readFileSync(path.join(configDirPath, 'raw.txt'), 'utf-8');

            assert.equal(value, 'test data');
        });
    });
});