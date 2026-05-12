import sinon from 'sinon';

import { assert } from 'chai';
import { Email } from '../lib/client/email-client.js';
import { ProgressReporter } from '../lib/reporter/progress-reporter.js';
import { TrashKeyword, TrashCleaner, TrashCleanerFactory, LlmTrashRule, KeywordTrashRule } from '../lib/trash-cleaner.js';

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

    it('defaults type to keyword', () => {
      const keyword = new TrashKeyword('apple', ['*'], ['spam']);
      assert.equal(keyword.type, 'keyword');
    })

    it('accepts llm type', () => {
      const keyword = new TrashKeyword('marketing email', ['*'], ['*'], 'delete', 'llm');
      assert.equal(keyword.type, 'llm');
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
    it('returns matching emails without fetching', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter);

      const result = await cleaner.filterTrashEmails([email]);

      assert.deepEqual(result, [email]);
    });

    it('normalizes diacritics before matching', async () => {
      email.body = 'cásìnó';
      email.labels = ['spam'];

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter);

      const result = await cleaner.filterTrashEmails([email]);

      assert.deepEqual(result, [email]);
    });

    it('skips emails older than lastRun when seenCache is set', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];
      email.date = new Date('2026-05-10T08:00:00Z');

      const seenCache = {
        isSeen: sinon.stub().returns(true)
      };

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, [], null, null, seenCache);

      const result = await cleaner.filterTrashEmails([email]);

      assert.equal(result.length, 0);
    });

    it('evaluates emails newer than lastRun', async () => {
      email.body = 'casino offer';
      email.labels = ['spam'];
      email.date = new Date('2026-05-13T08:00:00Z');

      const seenCache = {
        isSeen: sinon.stub().returns(false)
      };

      const cleaner = new TrashCleaner(client, [{
        value: 'casino', fields: ['*'], labels: ['*']
      }], reporter, [], null, null, seenCache);

      const result = await cleaner.filterTrashEmails([email]);

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
      const { keywords } = await factory.readKeywords();

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
      const { keywords } = await factory.readKeywords();

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
        getJson: sinon.stub(),
        putJson: sinon.stub()
      };
      configStore.getJson.withArgs('keywords.json').returns([
        { value: 'test', fields: '*', labels: 'spam' }
      ]);
      configStore.getJson.withArgs('allowlist.json').returns(['safe@test.com']);
      configStore.getJson.withArgs('seen.json').returns(null);

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

    it('returns empty array for empty keywords config', async () => {
      const configStore = { getJson: sinon.stub().returns([]) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      const { keywords } = await factory.readKeywords();
      assert.deepEqual(keywords, []);
    });

    it('returns empty array when keywords.json does not exist', async () => {
      const configStore = { getJson: sinon.stub().rejects(new Error('ENOENT: no such file')) };
      const factory = new TrashCleanerFactory(configStore, {}, false);

      const { keywords } = await factory.readKeywords();
      assert.deepEqual(keywords, []);
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

      const { keywords } = await factory.readKeywords();
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

describe('LlmTrashRule', () => {
  it('stores label and action from keyword', () => {
    const keyword = new TrashKeyword('marketing email', ['*'], ['*'], 'archive', 'llm');
    const rule = new LlmTrashRule(keyword);
    assert.equal(rule.label, 'marketing email');
    assert.equal(rule.action, 'archive');
    assert.deepEqual(rule.labels, ['*']);
  });

  it('defaults action to delete', () => {
    const keyword = new TrashKeyword('spam content', ['*'], ['inbox'], undefined, 'llm');
    const rule = new LlmTrashRule(keyword);
    assert.equal(rule.action, 'delete');
  });

  it('uses default threshold', async () => {
    const { DEFAULT_THRESHOLD } = await import('../lib/classifier/llm-classifier.js');
    const keyword = new TrashKeyword('promo', ['*'], ['*'], 'delete', 'llm');
    const rule = new LlmTrashRule(keyword);
    assert.equal(rule.threshold, DEFAULT_THRESHOLD);
  });
});

describe('TrashCleanerFactory with LLM rules', () => {
  it('parses llm type from config', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'marketing email', labels: '*', type: 'llm', action: 'archive' }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);
    const { keywords } = await factory.readKeywords();

    assert.equal(keywords.length, 1);
    assert.equal(keywords[0].type, 'llm');
    assert.equal(keywords[0].value, 'marketing email');
    assert.equal(keywords[0].action, 'archive');
  });

  it('defaults type to keyword when not specified', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'casino', fields: 'subject', labels: 'spam' }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);
    const { keywords } = await factory.readKeywords();

    assert.equal(keywords[0].type, 'keyword');
  });

  it('rejects invalid type', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'test', type: 'invalid' }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);

    try {
      await factory.readKeywords();
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /invalid type/);
    }
  });

  it('creates LlmTrashRule for llm type keywords', () => {
    const reporter = new ProgressReporter();
    const keywords = [
      new TrashKeyword('marketing', ['*'], ['*'], 'archive', 'llm'),
      new TrashKeyword('casino', ['*'], ['*'], 'delete', 'keyword')
    ];
    const cleaner = new TrashCleaner({}, keywords, reporter);
    assert.instanceOf(cleaner._rules[0], LlmTrashRule);
    assert.notInstanceOf(cleaner._rules[1], LlmTrashRule);
  });
});

describe('Rule title', () => {
  it('KeywordTrashRule uses title from keyword when provided', () => {
    const keyword = new TrashKeyword('casino', ['*'], ['*'], 'delete', 'keyword', 'Casino spam');
    const rule = new KeywordTrashRule(keyword);
    assert.equal(rule.title, 'Casino spam');
  });

  it('KeywordTrashRule defaults title to value when not provided', () => {
    const keyword = new TrashKeyword('casino', ['*'], ['*']);
    const rule = new KeywordTrashRule(keyword);
    assert.equal(rule.title, 'casino');
  });

  it('LlmTrashRule uses title from keyword when provided', () => {
    const keyword = new TrashKeyword('marketing email', ['*'], ['*'], 'archive', 'llm', 'Marketing emails');
    const rule = new LlmTrashRule(keyword);
    assert.equal(rule.title, 'Marketing emails');
  });

  it('LlmTrashRule defaults title to value when not provided', () => {
    const keyword = new TrashKeyword('marketing email', ['*'], ['*'], 'archive', 'llm');
    const rule = new LlmTrashRule(keyword);
    assert.equal(rule.title, 'marketing email');
  });

  it('_isTrashEmail sets _rule on matched email', async () => {
    const email = { from: 'test', subject: 'casino offer', snippet: '', body: 'casino offer', labels: ['spam'] };
    const keyword = new TrashKeyword('casino', ['*'], ['*'], 'delete', 'keyword', 'Casino spam');
    const reporter = new ProgressReporter();
    const cleaner = new TrashCleaner({}, [keyword], reporter);

    const result = await cleaner.filterTrashEmails([email]);
    assert.equal(result.length, 1);
    assert.equal(result[0]._rule, 'Casino spam');
  });

  it('TrashKeyword stores title', () => {
    const keyword = new TrashKeyword('test', ['*'], ['*'], 'delete', 'keyword', 'My Rule');
    assert.equal(keyword.title, 'My Rule');
  });

  it('TrashKeyword title defaults to undefined when not provided', () => {
    const keyword = new TrashKeyword('test', ['*'], ['*']);
    assert.equal(keyword.title, undefined);
  });

  it('readKeywords parses title from config', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'casino', fields: '*', labels: 'spam', title: 'Casino spam' }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);
    const { keywords } = await factory.readKeywords();
    assert.equal(keywords[0].title, 'Casino spam');
  });

  it('validation rejects non-string title', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'test', title: 123 }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);

    try {
      await factory.readKeywords();
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /"title" must be a non-empty string/);
    }
  });

  it('validation rejects empty title', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'test', title: '  ' }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);

    try {
      await factory.readKeywords();
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /"title" must be a non-empty string/);
    }
  });

  it('validation accepts missing title', async () => {
    const configStore = {
      getJson: sinon.stub().returns([
        { value: 'test' }
      ])
    };
    const factory = new TrashCleanerFactory(configStore, {}, false);
    const { keywords } = await factory.readKeywords();
    assert.equal(keywords.length, 1);
  });
});