const sinon = require('sinon');

const { assert } = require('chai');
const { OutlookClient } = require('../../lib/client/outlook-client');
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

            let emails = await client.getUnreadEmails();

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

            let emails = await client.getUnreadEmails();

            let email = new Email();
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
});