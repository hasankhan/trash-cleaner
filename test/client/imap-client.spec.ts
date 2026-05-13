import sinon from 'sinon';
import { assert } from 'chai';
import { ImapClient, ImapClientFactory } from '../../lib/client/imap-client.js';

describe('ImapClient', () => {
    let sandbox: sinon.SinonSandbox, mockImapFlowInstance: any;

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        mockImapFlowInstance = {
            connect: sandbox.stub().resolves(),
            logout: sandbox.stub().resolves(),
            getMailboxLock: sandbox.stub().resolves({ release: sandbox.stub() }),
            search: sandbox.stub().resolves([]),
            fetch: sandbox.stub(),
            messageFlagsAdd: sandbox.stub().resolves(),
            messageDelete: sandbox.stub().resolves(),
            messageMove: sandbox.stub().resolves(),
            list: sandbox.stub().resolves([
                { path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }
            ]),
        };
    });

    afterEach(() => sandbox.restore());

    function createClient(archiveFolder?: string): ImapClient {
        const client = new ImapClient({
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
            auth: { user: 'test@gmail.com', pass: 'secret' }
        } as any, archiveFolder);
        // Override _createClient to inject our mock
        sandbox.stub(client as any, '_createClient').returns(mockImapFlowInstance);
        return client;
    }

    describe('getUnreadEmails', () => {
        it('returns empty list when no unread messages', async () => {
            const client = createClient();
            mockImapFlowInstance.search.resolves([]);

            const emails = await client.getUnreadEmails();

            assert.deepEqual(emails, []);
            sinon.assert.calledOnce(mockImapFlowInstance.connect);
            sinon.assert.calledOnce(mockImapFlowInstance.logout);
        });

        it('returns emails when there are unread messages', async () => {
            const client = createClient();
            mockImapFlowInstance.search.resolves([101, 102]);

            // Build raw RFC822-ish messages for simpleParser
            const rawMsg1 = [
                'From: sender1@test.com',
                'Subject: Subject 1',
                'Date: Mon, 15 Jan 2024 00:00:00 +0000',
                'Content-Type: text/plain',
                '',
                'Body text 1'
            ].join('\r\n');

            const rawMsg2 = [
                'From: sender2@test.com',
                'Subject: Subject 2',
                'Date: Tue, 16 Jan 2024 00:00:00 +0000',
                'Content-Type: text/plain',
                '',
                'Body text 2'
            ].join('\r\n');

            const messages = [
                {
                    uid: 101,
                    source: Buffer.from(rawMsg1),
                    flags: new Set(['\\Flagged'])
                },
                {
                    uid: 102,
                    source: Buffer.from(rawMsg2),
                    flags: new Set()
                }
            ];

            mockImapFlowInstance.fetch.returns({
                async *[Symbol.asyncIterator]() {
                    for (const msg of messages) {
                        yield msg;
                    }
                }
            });

            const emails = await client.getUnreadEmails();

            assert.equal(emails.length, 2);
            assert.equal(emails[0].id, '101');
            assert.equal(emails[0].subject, 'Subject 1');
            assert.equal(emails[0].from, 'sender1@test.com');
            assert.include(emails[0].body, 'Body text 1');
            assert.include(emails[0].labels, 'flagged');
            assert.include(emails[0].labels, 'inbox');

            assert.equal(emails[1].id, '102');
            assert.equal(emails[1].subject, 'Subject 2');
            assert.notInclude(emails[1].labels, 'flagged');
            assert.include(emails[1].labels, 'inbox');
        });

        it('handles messages with missing fields gracefully', async () => {
            const client = createClient();
            mockImapFlowInstance.search.resolves([200]);

            // Minimal raw message
            const rawMsg = 'Content-Type: text/plain\r\n\r\n';
            mockImapFlowInstance.fetch.returns({
                async *[Symbol.asyncIterator]() {
                    yield { uid: 200, source: Buffer.from(rawMsg), flags: new Set() };
                }
            });

            const emails = await client.getUnreadEmails();

            assert.equal(emails.length, 1);
            assert.equal(emails[0].id, '200');
            assert.equal(emails[0].subject, '');
            assert.include(emails[0].labels, 'inbox');
        });

        it('releases lock and logs out on error', async () => {
            const client = createClient();
            mockImapFlowInstance.search.rejects(new Error('search failed'));

            try {
                await client.getUnreadEmails();
                assert.fail('should throw');
            } catch (err: any) {
                assert.include(err.message, 'search failed');
            }

            const lock = await mockImapFlowInstance.getMailboxLock.returnValues[0];
            sinon.assert.calledOnce(lock.release);
            sinon.assert.calledOnce(mockImapFlowInstance.logout);
        });
    });

    describe('deleteEmails', () => {
        it('deletes messages by UID', async () => {
            const client = createClient();
            const emails = [{ id: '101' }, { id: '102' }] as any;

            await client.deleteEmails(emails);

            sinon.assert.calledOnce(mockImapFlowInstance.messageDelete);
            sinon.assert.calledWith(mockImapFlowInstance.messageDelete,
                [101, 102], { uid: true });
            sinon.assert.calledOnce(mockImapFlowInstance.logout);
        });

        it('throws when delete fails', async () => {
            const client = createClient();
            mockImapFlowInstance.messageDelete.rejects(new Error('delete error'));

            try {
                await client.deleteEmails([{ id: '1' }] as any);
                assert.fail('should throw');
            } catch (err: any) {
                assert.match(err.message, /Failed to delete messages/);
            }
        });
    });

    describe('archiveEmails', () => {
        it('moves messages to archive folder', async () => {
            const client = createClient('[Gmail]/All Mail');
            const emails = [{ id: '101' }] as any;

            await client.archiveEmails(emails);

            sinon.assert.calledOnce(mockImapFlowInstance.messageMove);
            sinon.assert.calledWith(mockImapFlowInstance.messageMove,
                [101], '[Gmail]/All Mail', { uid: true });
            sinon.assert.calledOnce(mockImapFlowInstance.logout);
        });

        it('uses default archive folder when not specified', async () => {
            const client = createClient();
            const emails = [{ id: '50' }] as any;

            await client.archiveEmails(emails);

            sinon.assert.calledWith(mockImapFlowInstance.messageMove,
                [50], 'Archive', { uid: true });
        });

        it('throws when move fails', async () => {
            const client = createClient();
            mockImapFlowInstance.messageMove.rejects(new Error('move error'));

            try {
                await client.archiveEmails([{ id: '1' }] as any);
                assert.fail('should throw');
            } catch (err: any) {
                assert.match(err.message, /Failed to archive messages/);
            }
        });
    });

    describe('markAsReadEmails', () => {
        it('adds Seen flag to messages', async () => {
            const client = createClient();
            const emails = [{ id: '101' }, { id: '102' }] as any;

            await client.markAsReadEmails(emails);

            sinon.assert.calledOnce(mockImapFlowInstance.messageFlagsAdd);
            sinon.assert.calledWith(mockImapFlowInstance.messageFlagsAdd,
                [101, 102], ['\\Seen'], { uid: true });
            sinon.assert.calledOnce(mockImapFlowInstance.logout);
        });

        it('throws when flag add fails', async () => {
            const client = createClient();
            mockImapFlowInstance.messageFlagsAdd.rejects(new Error('flag error'));

            try {
                await client.markAsReadEmails([{ id: '1' }] as any);
                assert.fail('should throw');
            } catch (err: any) {
                assert.match(err.message, /Failed to mark messages as read/);
            }
        });
    });

    describe('restoreEmails', () => {
        it('throws not supported error', async () => {
            const client = createClient();

            try {
                await client.restoreEmails(['1', '2']);
                assert.fail('should throw');
            } catch (err: any) {
                assert.include(err.message, 'Undo is not supported in IMAP mode');
                assert.include(err.message, '--service gmail');
            }
        });
    });
});

describe('ImapClientFactory', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => sandbox.restore());

    describe('multi-account file names', () => {
        it('uses default file name when no account specified', () => {
            const factory = new ImapClientFactory({} as any);
            assert.equal((factory as any)._credentialsFile, 'imap.credentials.json');
        });

        it('uses default file name for "default" account', () => {
            const factory = new ImapClientFactory({} as any, 'default');
            assert.equal((factory as any)._credentialsFile, 'imap.credentials.json');
        });

        it('uses account-specific file name for named account', () => {
            const factory = new ImapClientFactory({} as any, 'work');
            assert.equal((factory as any)._credentialsFile, 'imap.credentials.work.json');
        });
    });

    describe('getInstance', () => {
        it('reads credentials from config store', async () => {
            const credentials = {
                host: 'imap.gmail.com',
                port: 993,
                user: 'test@gmail.com',
                password: 'secret',
                archiveFolder: '[Gmail]/All Mail'
            };
            const configStore = {
                getJson: sandbox.stub().resolves(credentials),
                putJson: sandbox.stub().resolves()
            } as any;
            const factory = new ImapClientFactory(configStore);

            const client = await factory.getInstance(false, false);

            sinon.assert.calledWith(configStore.getJson, 'imap.credentials.json');
            assert.exists(client);
            assert.instanceOf(client, ImapClient);
        });

        it('prompts for credentials when config is missing', async () => {
            const configStore = {
                getJson: sandbox.stub().rejects(new Error('not found')),
                putJson: sandbox.stub().resolves()
            } as any;
            const factory = new ImapClientFactory(configStore);

            sandbox.stub(factory as any, '_promptCredentials').resolves({
                host: 'imap.test.com',
                port: 993,
                user: 'user@test.com',
                password: 'pass'
            });

            const client = await factory.getInstance(false, false);

            sinon.assert.calledOnce((factory as any)._promptCredentials);
            sinon.assert.calledOnce(configStore.putJson);
            assert.exists(client);
        });

        it('prompts for credentials when reconfig is true', async () => {
            const credentials = {
                host: 'imap.gmail.com',
                port: 993,
                user: 'test@gmail.com',
                password: 'old-pass'
            };
            const configStore = {
                getJson: sandbox.stub().resolves(credentials),
                putJson: sandbox.stub().resolves()
            } as any;
            const factory = new ImapClientFactory(configStore);

            sandbox.stub(factory as any, '_promptCredentials').resolves({
                host: 'imap.gmail.com',
                port: 993,
                user: 'test@gmail.com',
                password: 'new-pass'
            });

            const client = await factory.getInstance(true, false);

            sinon.assert.calledOnce((factory as any)._promptCredentials);
            assert.exists(client);
        });
    });
});
