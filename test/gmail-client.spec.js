const sinon = require('sinon');

const { assert } = require('chai');
const { GmailClient } = require('../lib/gmail-client');
const { Email } = require('../lib/email-client');

describe('GmailCilent', () => {
    var gmail, client;

    beforeEach(() => {
        gmail = {
            users: {
                messages: {
                    list: sinon.stub(),
                    batchDelete: sinon.stub(),
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
            let emails = await client.getUnreadEmails();

            assert.deepEqual(emails, []);
        });

        it('returns email when there is a message', async () => {
            response.data.messages = ["123"];
            gmail.users.messages.get.returns({
                data: {
                    id: "123",
                    labelIds: ["trash"],
                    snippet: "snippet",
                    payload: {
                        headers: [
                            { name: 'Subject', value: 'subject' },
                            { name: 'From', value: 'spammer' }
                        ],
                        body: {
                            data: 'c3BhbQ=='
                        }
                    }
                }
            });

            let emails = await client.getUnreadEmails();

            let email = new Email();
            email.id = "123";
            email.from = "spammer";
            email.labels = ["trash"];
            email.snippet = "snippet";
            email.subject = "subject";
            email.body = "spam";

            assert.deepEqual(emails, [email]);
        });
    });

    describe("deleteEmails", () => {
        it("throws when fails", (done) => {
            gmail.users.messages.batchDelete.returns(Promise.reject(Error('test')));

            client.deleteEmails([])
                .then(() => {
                    assert.fail('deleteEmails should throw');
                }).catch(err => {
                    assert.match(err.message, /Failed to delete messages: Error: test/);
                    done();
                });
        });

        it("sends email ids", async () => {
            gmail.users.messages.batchDelete.returns(Promise.resolve());

            await client.deleteEmails([{ id: "123" }])

            let args = { userId: 'me', ids: ['123'] };
            sinon.assert.calledWith(gmail.users.messages.batchDelete, args);
        });
    });
});