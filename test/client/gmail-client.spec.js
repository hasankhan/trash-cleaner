const sinon = require('sinon');

const { assert } = require('chai');
const { GmailClient, GmailClientFactory } = require('../../lib/client/gmail-client');
const { Email } = require('../../lib/client/email-client');

describe('GmailCilent', () => {
    var gmail, client;

    beforeEach(() => {
        gmail = {
            users: {
                messages: {
                    list: sinon.stub(),
                    batchDelete: sinon.stub(),
                    batchModify: sinon.stub(),
                    get: sinon.stub()
                }
            }
        };
        client = new GmailClient(gmail);
    })

    describe('getUnreadEmails', () => {
        var response;

        beforeEach(() => {
            response = { data: {} };
            gmail.users.messages.list.returns(Promise.resolve(response));
        });

        it('returns empty list when there are no messages', async () => {
            const emails = await client.getUnreadEmails();

            assert.deepEqual(emails, []);
        });

        it('returns email when there is a message', async () => {
            response.data.messages = ['123'];
            gmail.users.messages.get.returns({
                data: {
                    id: '123',
                    labelIds: ['trash'],
                    snippet: 'snippet',
                    payload: {
                        headers: [
                            { name: 'Subject', value: 'subject' },
                            { name: 'From', value: 'spammer' }
                        ],
                        body: {
                            size: 4,
                            data: 'c3BhbQ=='
                        }
                    }
                }
            });

            const emails = await client.getUnreadEmails();

            const email = new Email();
            email.id = '123';
            email.from = 'spammer';
            email.labels = ['trash'];
            email.snippet = 'snippet';
            email.subject = 'subject';
            email.body = 'spam';

            assert.deepEqual(emails, [email]);
        });

        it('can read body in parts', async () => {
            response.data.messages = ['123'];
            gmail.users.messages.get.returns({
                data: {
                    id: '123',
                    labelIds: ['trash'],
                    snippet: 'snippet',
                    payload: {
                        headers: [
                            { name: 'Subject', value: 'subject' },
                            { name: 'From', value: 'spammer' }
                        ],
                        parts: [
                            {
                                body: {
                                    size: 4,
                                    data: 'c3BhbQ=='
                                },
                            }
                        ]
                    }
                }
            });

            const emails = await client.getUnreadEmails();

            assert.equal(emails.length, 1);
            assert.deepEqual(emails[0].body, 'spam');
        });
    });

    describe('deleteEmails', () => {
        it('throws when fails', (done) => {
            gmail.users.messages.batchDelete.returns(Promise.reject(Error('test')));

            client.deleteEmails([])
                .then(() => {
                    assert.fail('deleteEmails should throw');
                }).catch(err => {
                    assert.match(err.message, /Failed to delete messages: Error: test/);
                    done();
                });
        });

        it('sends email ids', async () => {
            gmail.users.messages.batchDelete.returns(Promise.resolve());

            await client.deleteEmails([{ id: '123' }])

            const args = { userId: 'me', ids: ['123'] };
            sinon.assert.calledWith(gmail.users.messages.batchDelete, args);
        });
    });

    describe('archiveEmails', () => {
        it('removes INBOX label', async () => {
            gmail.users.messages.batchModify.returns(Promise.resolve());

            await client.archiveEmails([{ id: '123' }]);

            sinon.assert.calledWith(gmail.users.messages.batchModify, {
                userId: 'me',
                ids: ['123'],
                removeLabelIds: ['INBOX']
            });
        });

        it('throws when fails', async () => {
            gmail.users.messages.batchModify.returns(Promise.reject(Error('test')));

            try {
                await client.archiveEmails([{ id: '123' }]);
                assert.fail('should throw');
            } catch (err) {
                assert.match(err.message, /Failed to archive messages/);
            }
        });
    });

    describe('markAsReadEmails', () => {
        it('removes UNREAD label', async () => {
            gmail.users.messages.batchModify.returns(Promise.resolve());

            await client.markAsReadEmails([{ id: '123' }]);

            sinon.assert.calledWith(gmail.users.messages.batchModify, {
                userId: 'me',
                ids: ['123'],
                removeLabelIds: ['UNREAD']
            });
        });

        it('throws when fails', async () => {
            gmail.users.messages.batchModify.returns(Promise.reject(Error('test')));

            try {
                await client.markAsReadEmails([{ id: '123' }]);
                assert.fail('should throw');
            } catch (err) {
                assert.match(err.message, /Failed to mark messages as read/);
            }
        });
    });
});

describe('GmailClientFactory', () => {
    describe('multi-account file names', () => {
        it('uses default file names when no account specified', () => {
            const factory = new GmailClientFactory({});
            assert.equal(factory._credentialsFile, 'gmail.credentials.json');
            assert.equal(factory._tokenFile, 'gmail.token.json');
        });

        it('uses default file names for "default" account', () => {
            const factory = new GmailClientFactory({}, 'default');
            assert.equal(factory._credentialsFile, 'gmail.credentials.json');
            assert.equal(factory._tokenFile, 'gmail.token.json');
        });

        it('uses account-specific file names for named account', () => {
            const factory = new GmailClientFactory({}, 'work');
            assert.equal(factory._credentialsFile, 'gmail.credentials.work.json');
            assert.equal(factory._tokenFile, 'gmail.token.work.json');
        });
    });
});