const fs = require('fs');
const path = require('path');
const tmp = require('tmp');

const { assert } = require('chai');
const { FileSystemConfigStore } = require('../../lib/store/file-system-config-store');

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

    describe('get', () => {
        it('parses value as json', async () => {
            var store = new FileSystemConfigStore(configDirPath);
            fs.writeFileSync(path.join(configDirPath, FILE_TEST), '[3]');

            let value = await store.get(FILE_TEST);

            assert.deepEqual(value, [3]);
        });

        it('returns null when key does not exist', async () => {
            var store = new FileSystemConfigStore(configDirPath);

            let value = await store.get(FILE_TEST + '.old');

            assert.isNull(value);
        });
    });

    describe('put', () => {
        it('saves value as json', async () => {
            var store = new FileSystemConfigStore(configDirPath);
            await store.put(FILE_TEST, { val: 3 });

            let value = fs.readFileSync(path.join(configDirPath, FILE_TEST), 'utf-8');

            assert.equal(value, '{"val":3}');
        });
    });
});