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

    it('defaults action to delete', () => {
      const keyword = new TrashKeyword('apple', ['*'], ['spam']);
      assert.equal(keyword.action, 'delete');
    })

    it('accepts valid action', () => {
      const keyword = new TrashKeyword('apple', ['*'], ['spam'], 'archive');
      assert.equal(keyword.action, 'archive');
    })

    it('throws for invalid action', () => {
      assert.throws(() => new TrashKeyword('apple', ['*'], ['spam'], 'invalid'), /Invalid action/);
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
      deleteEmails: sinon.stub(),
      archiveEmails: sinon.stub(),
      markAsReadEmails: sinon.stub()
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

    it('archives emails when action is archive', async () => {
      email.body = 'newsletter content';
      email.labels = ['inbox'];

      const cleaner = new TrashCleaner(client, [{
        value: 'newsletter', fields: ['*'], labels: ['*'], action: 'archive'
      }], reporter);

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.archiveEmails, [email]);
      sinon.assert.notCalled(client.deleteEmails);
    });

    it('marks emails as read when action is mark-as-read', async () => {
      email.body = 'notification update';
      email.labels = ['inbox'];

      const cleaner = new TrashCleaner(client, [{
        value: 'notification', fields: ['*'], labels: ['*'], action: 'mark-as-read'
      }], reporter);

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.markAsReadEmails, [email]);
      sinon.assert.notCalled(client.deleteEmails);
    });

    it('groups emails by action and processes each group', async () => {
      const email2 = new Email();
      email.body = 'casino spam';
      email.labels = ['spam'];
      email2.body = 'newsletter digest';
      email2.labels = ['inbox'];

      client.getUnreadEmails.returns([email, email2]);

      const cleaner = new TrashCleaner(client, [
        { value: 'casino', fields: ['*'], labels: ['*'], action: 'delete' },
        { value: 'newsletter', fields: ['*'], labels: ['*'], action: 'archive' }
      ], reporter);

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
      sinon.assert.calledWith(client.archiveEmails, [email2]);
    });

    it('does not execute actions in dry-run mode', async () => {
      email.body = 'newsletter content';
      email.labels = ['inbox'];

      const cleaner = new TrashCleaner(client, [{
        value: 'newsletter', fields: ['*'], labels: ['*'], action: 'archive'
      }], reporter);

      await cleaner.cleanTrash(true /*dryRun*/);

      sinon.assert.notCalled(client.archiveEmails);
      sinon.assert.notCalled(client.deleteEmails);
    });
  });

  describe('allowlist', () => {
    it('protects allowlisted sender from deletion', async () => {
      email.body = 'casino spam';
      email.from = 'boss@example.com';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, ['boss@example\\.com']);

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('allows non-allowlisted sender to be deleted', async () => {
      email.body = 'casino spam';
      email.from = 'spammer@evil.com';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, ['boss@example\\.com']);

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });

    it('allowlist patterns are case-insensitive', async () => {
      email.body = 'promo offer';
      email.from = 'BOSS@Example.COM';
      email.labels = ['inbox'];

      const cleaner = new TrashCleaner(client, [{
        value: 'promo', fields: ['*'], labels: ['*']
      }], reporter, ['boss@example\\.com']);

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('supports regex patterns in allowlist', async () => {
      email.body = 'newsletter';
      email.from = 'news@trusted-domain.org';
      email.labels = ['inbox'];

      const cleaner = new TrashCleaner(client, [{
        value: 'newsletter', fields: ['*'], labels: ['*']
      }], reporter, ['@trusted-domain\\.org']);

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('works with empty allowlist', async () => {
      email.body = 'casino';
      email.from = 'anyone@test.com';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, []);

      await cleaner.cleanTrash();

      sinon.assert.calledWith(client.deleteEmails, [email]);
    });
  });

  describe('minAge filter', () => {
    it('skips emails newer than minAge', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];
      email.date = new Date(); // now — too new

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, [], null, 7);

      await cleaner.cleanTrash();

      sinon.assert.notCalled(client.deleteEmails);
    });

    it('includes emails older than minAge', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];
      email.date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, [], null, 7);

      await cleaner.cleanTrash();

      sinon.assert.calledOnce(client.deleteEmails);
    });

    it('includes emails when minAge is not set', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];
      email.date = new Date(); // now — but no age filter

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter);

      await cleaner.cleanTrash();

      sinon.assert.calledOnce(client.deleteEmails);
    });

    it('includes emails with no date when minAge is set', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];
      email.date = null;

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, [], null, 7);

      await cleaner.cleanTrash();

      sinon.assert.calledOnce(client.deleteEmails);
    });
  });

  describe('error handling', () => {
    it('throws when getUnreadEmails fails', async () => {
      client.getUnreadEmails.rejects(new Error('API timeout'));

      const cleaner = new TrashCleaner(client, [{
        value: 'test', fields: ['*'], labels: ['*']
      }], reporter);

      try {
        await cleaner.cleanTrash();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /Failed to get trash emails/);
      }
    });
  });

  describe('filterTrashEmails', () => {
    it('returns matching emails without fetching', () => {
      email.body = 'casino offer';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter);

      const result = cleaner.filterTrashEmails([email]);

      assert.deepEqual(result, [email]);
    });

    it('normalizes diacritics before matching', () => {
      email.body = 'cásìnó';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter);

      const result = cleaner.filterTrashEmails([email]);

      assert.deepEqual(result, [email]);
    });
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
        getJson: sinon.stub()
      };
      configStore.getJson.withArgs('keywords.json').returns([
        { value: 'test', fields: '*', labels: 'spam' }
      ]);
      configStore.getJson.withArgs('allowlist.json').returns(['safe@test.com']);

      const factory = new TrashCleanerFactory(configStore, {}, false);
      const cleaner = await factory.getInstance();

      assert.instanceOf(cleaner, TrashCleaner);
    });
  });

  describe('readAllowlist', () => {
    it('reads allowlist from config store', async () => {
      const configStore = {
        getJson: sinon.stub().withArgs('allowlist.json').returns(['sender@test.com'])
      };
      const factory = new TrashCleanerFactory(configStore, {}, false);
      const allowlist = await factory.readAllowlist();

      assert.deepEqual(allowlist, ['sender@test.com']);
    });

    it('returns empty array when file does not exist', async () => {
      const configStore = {
        getJson: sinon.stub().withArgs('allowlist.json').throws(new Error('File not found'))
      };
      const factory = new TrashCleanerFactory(configStore, {}, false);
      const allowlist = await factory.readAllowlist();

      assert.deepEqual(allowlist, []);
    });

    it('throws when file contains invalid JSON', async () => {
      const configStore = {
        getJson: sinon.stub().withArgs('allowlist.json')
          .throws(new Error('Unexpected token in JSON'))
      };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readAllowlist();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /Unexpected token/);
      }
    });

    it('throws when allowlist is not an array', async () => {
      const configStore = {
        getJson: sinon.stub().withArgs('allowlist.json').returns({ sender: 'test' })
      };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readAllowlist();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /must contain a JSON array/);
      }
    });
  });

  describe('config validation', () => {
    it('rejects non-array config', async () => {
      const configStore = { getJson: sinon.stub().returns({}) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /must contain a JSON array/);
      }
    });

    it('rejects empty array', async () => {
      const configStore = { getJson: sinon.stub().returns([]) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /at least one keyword/);
      }
    });

    it('rejects entry without value', async () => {
      const configStore = { getJson: sinon.stub().returns([{ fields: '*' }]) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /missing a valid "value" field/);
      }
    });

    it('rejects non-string fields', async () => {
      const configStore = { getJson: sinon.stub().returns([{ value: 'test', fields: ['*'] }]) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /"fields" must be a comma-separated string/);
      }
    });

    it('rejects non-string labels', async () => {
      const configStore = { getJson: sinon.stub().returns([{ value: 'test', labels: ['spam'] }]) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /"labels" must be a comma-separated string/);
      }
    });

    it('rejects invalid action', async () => {
      const configStore = { getJson: sinon.stub().returns([{ value: 'test', action: 'explode' }]) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /invalid action "explode"/);
      }
    });

    it('accepts valid config with all fields', async () => {
      const configStore = {
        getJson: sinon.stub().returns([
          { value: 'test', fields: 'subject', labels: 'spam', action: 'archive' }
        ])
      };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      const keywords = await factory.readKeywords();
      assert.equal(keywords.length, 1);
      assert.equal(keywords[0].action, 'archive');
    });

    it('includes index in error for bad entry', async () => {
      const configStore = {
        getJson: sinon.stub().returns([
          { value: 'ok' },
          { value: '' }
        ])
      };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      try {
        await factory.readKeywords();
        assert.fail('should throw');
      } catch (err) {
        assert.match(err.message, /index 1/);
      }
    });
  });
});