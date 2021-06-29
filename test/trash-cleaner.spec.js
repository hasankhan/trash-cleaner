const assert = require('assert');
const sinon = require('sinon');

const { Email } = require('../email-client');
const { TrashKeyword, TrashCleaner } = require('../trash-cleaner');

describe('TrashKeyword', ()=> {
  describe('constructor', ()=>{
    it('throws when value is not set', ()=> {
      assert.throws(() => new TrashKeyword(null, ["spam"]), /Invalid keyword/);
    })

    it('throws when labels are not set', ()=> {
      assert.throws(() => new TrashKeyword("apple", null), /Invalid keyword/);
      assert.throws(() => new TrashKeyword("apple", []), /Invalid keyword/);
    })

    it('does not throw when value and labels are set', ()=> {
      assert.doesNotThrow(() => new TrashKeyword("apple", ["spam"]));
    })
  })
});

describe('TrashCleaner', () => {
  var client, email;

  before(() => {
    sinon.stub(console, 'log');
  });

  after(() => {
    console.log.restore();
  });

  beforeEach(() => {
    email = new Email();

    client = {
      getUnreadEmails: sinon.stub().returns([email]),
      deleteEmails: sinon.stub()
    };
  });

  describe('cleanTrash', () => {
    it('does not delete email that does not match', async() => {
      email.body = 'apple';
      email.labels = ['spam'];

      let cleaner = new TrashCleaner(client, [{
        value: 'orange', labels: ['spam']
      }])

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('uses regex', async () => {
      email.body = 'orange';
      email.labels = ['spam'];

      let cleaner = new TrashCleaner(client, [{
        value: 'mango|apple|orange', labels: ['spam']
      }])

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('finds spam with diacritics', async () => {
      email.body = 'Ápplé';
      email.labels = ['spam'];

      let cleaner = new TrashCleaner(client, [{
        value: 'apple', labels: ['spam']
      }])

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('finds spam with wildcard label', async () => {
      email.body = 'apple';
      email.labels = ['spam'];

      let cleaner = new TrashCleaner(client, [{
        value: 'apple', labels: ['*']
      }])

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('does not find spam when label does not match', async () => {
      email.body = 'apple';
      email.labels = ['spam'];

      let cleaner = new TrashCleaner(client, [{
        value: 'apple', labels: ['inbox']
      }])

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('succeeds when there are no emails', async () => {
      client.getUnreadEmails.returns([]);

      let cleaner = new TrashCleaner(client, [{
        value: 'apple', labels: ['inbox']
      }])

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
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
          value: data.keyword, labels: [data.label]
        }])

        await cleaner.cleanTrash();

        sinon.assert.calledWith(client.deleteEmails, [email]);

        client.deleteEmails.reset();
      }
    });

    ['from', 'subject', 'snippet', 'body'].forEach(field =>
      it(`finds spam in '${field}' field`, async () => {
        email[field] = 'apple';
        email.labels = ['spam'];

        let cleaner = new TrashCleaner(client, [{
          value: 'apple', labels: ['spam']
        }])

        await cleaner.cleanTrash();

        sinon.assert.calledWith(client.deleteEmails, [email]);
      }));
  });
});