import { expect } from 'chai';
import sinon from 'sinon';
import { SecureConfigStore, SERVICE_NAME } from '../../lib/store/secure-config-store.js';

describe('SecureConfigStore', () => {
    let store;
    let fileStore;
    let mockKeychain;

    beforeEach(() => {
        fileStore = {
            get: sinon.stub(),
            getJson: sinon.stub(),
            put: sinon.stub(),
            putJson: sinon.stub()
        };
        mockKeychain = {
            getPassword: sinon.stub(),
            setPassword: sinon.stub(),
            deletePassword: sinon.stub()
        };
        store = new SecureConfigStore(fileStore, mockKeychain);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('get', () => {
        it('should read sensitive keys from keychain first', async () => {
            mockKeychain.getPassword.resolves('{"user":"test"}');
            const result = await store.get('imap.credentials.json');
            expect(result).to.equal('{"user":"test"}');
            expect(mockKeychain.getPassword.calledWith(SERVICE_NAME, 'imap.credentials.json')).to.be.true;
            expect(fileStore.get.called).to.be.false;
        });

        it('should fall back to file store when keychain returns null', async () => {
            mockKeychain.getPassword.resolves(null);
            fileStore.get.resolves('{"user":"file"}');
            const result = await store.get('imap.credentials.json');
            expect(result).to.equal('{"user":"file"}');
        });

        it('should fall back to file store when keychain throws', async () => {
            mockKeychain.getPassword.rejects(new Error('no keychain'));
            fileStore.get.resolves('{"user":"file"}');
            const result = await store.get('gmail.token.json');
            expect(result).to.equal('{"user":"file"}');
        });

        it('should use file store directly for non-sensitive keys', async () => {
            fileStore.get.resolves('["keyword1"]');
            const result = await store.get('keywords.json');
            expect(result).to.equal('["keyword1"]');
            expect(mockKeychain.getPassword.called).to.be.false;
        });
    });

    describe('getJson', () => {
        it('should parse JSON from keychain for credential files', async () => {
            mockKeychain.getPassword.resolves('{"host":"imap.gmail.com"}');
            const result = await store.getJson('imap.credentials.json');
            expect(result).to.deep.equal({ host: 'imap.gmail.com' });
        });

        it('should return null when no value found', async () => {
            mockKeychain.getPassword.resolves(null);
            fileStore.get.resolves(null);
            const result = await store.getJson('imap.credentials.json');
            expect(result).to.be.null;
        });
    });

    describe('put', () => {
        it('should save sensitive keys to keychain', async () => {
            mockKeychain.setPassword.resolves();
            await store.put('outlook.credentials.json', '{"client_id":"abc"}');
            expect(mockKeychain.setPassword.calledWith(
                SERVICE_NAME, 'outlook.credentials.json', '{"client_id":"abc"}'
            )).to.be.true;
            expect(fileStore.put.called).to.be.false;
        });

        it('should fall back to file store when keychain write fails', async () => {
            mockKeychain.setPassword.rejects(new Error('denied'));
            fileStore.put.resolves();
            await store.put('imap.credentials.json', '{"user":"test"}');
            expect(fileStore.put.calledWith('imap.credentials.json', '{"user":"test"}')).to.be.true;
        });

        it('should use file store for non-sensitive keys', async () => {
            fileStore.put.resolves();
            await store.put('keywords.json', '[]');
            expect(mockKeychain.setPassword.called).to.be.false;
            expect(fileStore.put.calledWith('keywords.json', '[]')).to.be.true;
        });
    });

    describe('putJson', () => {
        it('should serialize and save to keychain', async () => {
            mockKeychain.setPassword.resolves();
            await store.putJson('imap.credentials.json', { host: 'test' });
            expect(mockKeychain.setPassword.calledWith(
                SERVICE_NAME, 'imap.credentials.json', '{"host":"test"}'
            )).to.be.true;
        });
    });

    describe('remove', () => {
        it('should remove from keychain', async () => {
            mockKeychain.deletePassword.resolves(true);
            const result = await store.remove('imap.credentials.json');
            expect(result).to.be.true;
            expect(mockKeychain.deletePassword.calledWith(SERVICE_NAME, 'imap.credentials.json')).to.be.true;
        });

        it('should return false when keychain throws', async () => {
            mockKeychain.deletePassword.rejects(new Error('not found'));
            const result = await store.remove('imap.credentials.json');
            expect(result).to.be.false;
        });
    });

    describe('_isSensitive', () => {
        it('should identify credential files as sensitive', () => {
            expect(store._isSensitive('imap.credentials.json')).to.be.true;
            expect(store._isSensitive('gmail.credentials.json')).to.be.true;
            expect(store._isSensitive('outlook.credentials.work.json')).to.be.true;
        });

        it('should identify token files as sensitive', () => {
            expect(store._isSensitive('gmail.token.json')).to.be.true;
            expect(store._isSensitive('outlook.token.work.json')).to.be.true;
        });

        it('should not flag non-sensitive files', () => {
            expect(store._isSensitive('keywords.json')).to.be.false;
            expect(store._isSensitive('allowlist.json')).to.be.false;
        });
    });
});
