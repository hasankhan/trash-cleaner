const sinon = require('sinon');

const { assert } = require('chai');
const { Email } = require('../lib/client/email-client');
const { ProgressReporter } = require('../lib/reporter/progress-reporter');
const { TrashKeyword, TrashCleaner, TrashCleanerFactory } = require('../lib/trash-cleaner');

describe('TrashKeyword', () => {
  describe('constructor', () => {
    it('throws when value is not set', () => {
      assert.throws(() => new TrashKeyword(null, ['*'], ['spam']), /Invalid keyword/);
    })

    it('throws when fields are not set', () => {
      assert.throws(() => new TrashKeyword('apple', null, ['*']), /Invalid keyword/);
    })

    it('throws when labels are not set', () => {
      assert.throws(() => new TrashKeyword('apple', ['*'], null), /Invalid keyword/);
    })

    it('does not throw when value and labels are set', () => {
      assert.doesNotThrow(() => new TrashKeyword('apple', ['*'], ['spam']));
    })
  })
});

describe('TrashCleaner', () => {
  var client, email, reporter;

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

    reporter = new ProgressReporter();
  });

  describe('cleanTrash', () => {
    [
      { match: 'keyword', value: 'orange', fields: ['*'], labels: ['spam'] },
      { match: 'field', value: 'apple', fields: ['subject'], labels: ['spam'] },
      { match: 'label', value: 'apple', fields: ['*'], labels: ['inbox'] },
    ].forEach(data =>
      it(`does not find spam when ${data.match} does not match`, async () => {
        email.body = 'apple';
        email.labels = ['spam'];

        const cleaner = new TrashCleaner(client, [{
          value: data.value, fields: data.fields, labels: data.labels
        }], reporter)

        await cleaner.cleanTrash();

        sinon.assert.notCalled(client.deleteEmails);
      }));

    it('uses regex', async () => {
      email.body = 'orange';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'mango|apple|orange', fields: ['*'], labels: ['spam']
      }], reporter)

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('finds spam with diacritics', async () => {
      email.body = 'Ápplé';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'apple', fields: ['*'], labels: ['spam']
      }], reporter)

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('finds spam with wildcard label', async () => {
      email.body = 'apple';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'apple', fields: ['*'], labels: ['*']
      }], reporter)

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('succeeds when there are no emails', async () => {
      client.getUnreadEmails.returns([]);

      const cleaner = new TrashCleaner(client, [{
        value: 'apple', fields: ['*'], labels: ['inbox']
      }], reporter)

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('is case insensitive', async () => {
      client.getUnreadEmails.returns([email]);

      const testData = [
        { keyword: 'apple', label: 'spam', emailBody: 'APPLE', emailLabel: 'SPAM' },
        { keyword: 'APPLE', label: 'spam', emailBody: 'apple', emailLabel: 'spam' },
        { keyword: 'apple', label: 'SPAM', emailBody: 'apple', emailLabel: 'spam' },
      ];

      for (const data of testData) {
        email.body = data.emailBody;
        email.labels = [data.emailLabel];

        const cleaner = new TrashCleaner(client, [{
          value: data.keyword, fields: ['*'], labels: [data.label]
        }], reporter)

        await cleaner.cleanTrash();

        sinon.assert.calledWith(client.deleteEmails, [email]);

        client.deleteEmails.reset();
      }
    });

    ['from', 'subject', 'snippet', 'body'].forEach(field =>
      it(`finds spam in ${field} field`, async () => {
        email[field] = 'apple';
        email.labels = ['spam'];

        const cleaner = new TrashCleaner(client, [{
          value: 'apple', fields: [field], labels: ['spam']
        }], reporter)

        await cleaner.cleanTrash();

        sinon.assert.calledWith(client.deleteEmails, [email]);
      }));
  });
});

describe('TrashCleanerFactory', () => {
  describe('readKeywords', () => {
    it('parses keywords from config store', async () => {
      const configStore = {
        getJson: sinon.stub().returns([
          { value: 'casino', fields: 'subject,body', labels: 'spam' }
        ])
      };

      const factory = new TrashCleanerFactory(configStore, {}, false);
      const keywords = await factory.readKeywords();

      assert.equal(keywords.length, 1);
      assert.equal(keywords[0].value, 'casino');
      assert.deepEqual(keywords[0].fields, ['subject', 'body']);
      assert.deepEqual(keywords[0].labels, ['spam']);
    });

    it('uses wildcard default when fields are missing', async () => {
      const configStore = {
        getJson: sinon.stub().returns([
          { value: 'test' }
        ])
      };

      const factory = new TrashCleanerFactory(configStore, {}, false);
      const keywords = await factory.readKeywords();

      assert.deepEqual(keywords[0].fields, ['*']);
      assert.deepEqual(keywords[0].labels, ['*']);
    });
  });

  describe('splitAndTrim', () => {
    it('splits comma-separated values', () => {
      const factory = new TrashCleanerFactory({}, {}, false);
      const result = factory.splitAndTrim('a, b, c', ',', '*');

      assert.deepEqual(result, ['a', 'b', 'c']);
    });

    it('uses default when value is null', () => {
      const factory = new TrashCleanerFactory({}, {}, false);
      const result = factory.splitAndTrim(null, ',', '*');

      assert.deepEqual(result, ['*']);
    });

    it('filters empty tokens', () => {
      const factory = new TrashCleanerFactory({}, {}, false);
      const result = factory.splitAndTrim('a,,b', ',', '*');

      assert.deepEqual(result, ['a', 'b']);
    });
  });

  describe('getInstance', () => {
    it('returns a TrashCleaner instance', async () => {
      const configStore = {
        getJson: sinon.stub().returns([
          { value: 'test', fields: '*', labels: 'spam' }
        ])
      };

      const factory = new TrashCleanerFactory(configStore, {}, false);
      const cleaner = await factory.getInstance();

      assert.instanceOf(cleaner, TrashCleaner);
    });
  });
});