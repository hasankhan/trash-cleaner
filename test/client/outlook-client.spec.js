const sinon = require('sinon');

const { assert } = require('chai');
const { OutlookClient, OutlookClientFactory } = require('../../lib/client/outlook-client');
const { Email } = require('../../lib/client/email-client');

describe('OutlookCilent', () => {
    var client, mock;

    beforeEach(() => {
        client = new OutlookClient("http://abc/", "secret");
        mock = sinon.mock(client)
    });

    describe('getUnreadEmails', () => {
        function setupFolders(folders) {
            mock.expects('_callApi')
                .withArgs(
                    'get',
                    'http://abc/v1.0/me/mailFolders?$select=id,displayName',
                    'secret')
                .returns(Promise.resolve({
                    value: folders
                }));
        }

        function setupEmails(emails) {
            mock.expects('_callApi')
                .withArgs(
                    'get',
                    'http://abc/v1.0/me/messages?$select=subject,body,bodyPreview,categories,from,parentFolderId&$filter=isRead eq false',
                    'secret')
                .returns(Promise.resolve({
                    value: emails
                }));
        }

        it('returns empty list when there are no messages', async () => {
            setupFolders([]);
            setupEmails([]);

            const emails = await client.getUnreadEmails();

            mock.verify();
            assert.deepEqual(emails, []);
        });

        it('returns email when there is a message', async () => {
            setupFolders([
                {
                    id: 'abc',
                    displayName: 'inbox'
                }
            ]);

            setupEmails([
                {
                    id: '123',
                    parentFolderId: 'abc',
                    bodyPreview: 'preview text',
                    subject: 'the subject',
                    from: {
                        emailAddress: {
                            name: 'spammer',
                            address: 'sender@example.com'
                        }
                    },
                    body: {
                        content: 'the body'
                    }
                }
            ]);

            const emails = await client.getUnreadEmails();

            const email = new Email();
            email.id = '123';
            email.from = 'spammer <sender@example.com>';
            email.labels = ['inbox'];
            email.snippet = 'preview text';
            email.subject = 'the subject';
            email.body = 'the body';

            mock.verify();
            assert.deepEqual(emails, [email]);
        });
    });

    describe('deleteEmails', () => {
        function setupDelete(id, promise) {
            return mock.expects('_callApi')
                .withArgs(
                    'delete',
                    `http://abc/v1.0/me/messages/${id}`,
                    'secret')
                .returns(promise);
        }

        it('throws when fails', (done) => {
            setupDelete('abc', Promise.reject(Error('test')));

            client.deleteEmails([{ id: 'abc' }])
                .then(() => {
                    assert.fail('deleteEmails should throw');
                }).catch(err => {
                    assert.match(err.message, /Failed to delete messages: Error: test/);
                    done();
                });

            mock.verify();
        });

        it('delets email', async () => {
            setupDelete('123', Promise.resolve());

            await client.deleteEmails([{ id: '123' }]);

            mock.verify();
        });
    });

    describe('archiveEmails', () => {
        it('moves email to archive', async () => {
            mock.expects('_callApi')
                .withArgs(
                    'post',
                    'http://abc/v1.0/me/messages/123/move',
                    'secret',
                    { destinationId: 'archive' })
                .returns(Promise.resolve());

            await client.archiveEmails([{ id: '123' }]);

            mock.verify();
        });

        it('throws when fails', async () => {
            mock.expects('_callApi').returns(Promise.reject(Error('test')));

            try {
                await client.archiveEmails([{ id: '123' }]);
                assert.fail('should throw');
            } catch (err) {
                assert.match(err.message, /Failed to archive messages/);
            }
        });
    });

    describe('markAsReadEmails', () => {
        it('patches email as read', async () => {
            mock.expects('_callApi')
                .withArgs(
                    'patch',
                    'http://abc/v1.0/me/messages/123',
                    'secret',
                    { isRead: true })
                .returns(Promise.resolve());

            await client.markAsReadEmails([{ id: '123' }]);

            mock.verify();
        });

        it('throws when fails', async () => {
            mock.expects('_callApi').returns(Promise.reject(Error('test')));

            try {
                await client.markAsReadEmails([{ id: '123' }]);
                assert.fail('should throw');
            } catch (err) {
                assert.match(err.message, /Failed to mark messages as read/);
            }
        });
    });
});

describe('OutlookClientFactory', () => {
    describe('multi-account file names', () => {
        it('uses default file names when no account specified', () => {
            const factory = new OutlookClientFactory({});
            assert.equal(factory._credentialsFile, 'outlook.credentials.json');
            assert.equal(factory._tokenFile, 'outlook.token.json');
        });

        it('uses default file names for "default" account', () => {
            const factory = new OutlookClientFactory({}, 'default');
            assert.equal(factory._credentialsFile, 'outlook.credentials.json');
            assert.equal(factory._tokenFile, 'outlook.token.json');
        });

        it('uses account-specific file names for named account', () => {
            const factory = new OutlookClientFactory({}, 'work');
            assert.equal(factory._credentialsFile, 'outlook.credentials.work.json');
            assert.equal(factory._tokenFile, 'outlook.token.work.json');
        });
    });
});