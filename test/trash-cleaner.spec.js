const assert = require('assert');
const sinon = require('sinon');
const { Email } = require('../email-client');
const { TrashCleaner } = require('../trash-cleaner');

describe('TrashCleaner', () => {
  var client, email;

  before(() => {
    sinon.stub(console, 'log');
  });

  beforeEach(() => {
    email = new Email();

    client = {
      getUnreadEmails: sinon.stub().returns([email]),
      deleteEmails: sinon.stub()
    };
  });

  describe('cleanTrash', () => {
    it('finds spam with diacritics', async () => {
      email.body = 'Ápplé';
      email.labels = ["spam"];

      let cleaner = new TrashCleaner(client, [{
        val: "apple", labels: ["spam"]
      }])

      await cleaner.cleanTrash();

      assert(client.deleteEmails.calledWith([email]));
    });

    it('finds spam with wildcard label', async () => {
      email.body = 'apple';
      email.labels = ["spam"];

      let cleaner = new TrashCleaner(client, [{
        val: "apple", labels: ["*"]
      }])

      await cleaner.cleanTrash();

      assert(client.deleteEmails.calledWith([email]));
    });

    it('does not find spam when label does not match', async () => {
      email.body = 'apple';
      email.labels = ["spam"];

      let cleaner = new TrashCleaner(client, [{
        val: "apple", labels: ["inbox"]
      }])

      await cleaner.cleanTrash();

      assert(client.deleteEmails.notCalled);
    });

    it('succeeds when there are no emails', async () => {
      client.getUnreadEmails.returns([]);

      let cleaner = new TrashCleaner(client, [{
        val: "apple", labels: ["inbox"]
      }])

      await cleaner.cleanTrash();

      assert(client.deleteEmails.notCalled);
    });

    it('is case insensitive', async () => {
      client.getUnreadEmails.returns([email]);

      let testData = [
        { keyword: 'apple', label: 'spam', emailBody: 'APPLE', emailLabel: 'SPAM' },
        { keyword: 'APPLE', label: 'spam', emailBody: 'apple', emailLabel: 'spam' },
        { keyword: 'apple', label: 'SPAM', emailBody: 'apple', emailLabel: 'spam' },
      ];

      for (data of testData) {
        email.body = data.emailBody;
        email.labels = [data.emailLabel];

        let cleaner = new TrashCleaner(client, [{
          val: data.keyword, labels: [data.label]
        }])

        await cleaner.cleanTrash();

        assert(client.deleteEmails.calledWith([email]));

        client.deleteEmails.reset();
      }
    });

    ["from", "subject", "snippet", "body"].forEach(field =>
      it(`finds spam in "${field}" field`, async () => {
        email[field] = 'apple';
        email.labels = ["spam"];

        let cleaner = new TrashCleaner(client, [{
          val: "apple", labels: ["spam"]
        }])

        await cleaner.cleanTrash();

        assert(client.deleteEmails.calledWith([email]));
      }));
  });
});