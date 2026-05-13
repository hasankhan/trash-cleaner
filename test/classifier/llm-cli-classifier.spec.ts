import { assert } from 'chai';
import { renderPrompt, parseBatchResponse, DEFAULT_PROMPT, DEFAULT_BATCH_PROMPT } from '../../lib/classifier/llm-cli-classifier.js';

describe('LLM CLI Classifier', () => {
  describe('renderPrompt', () => {
    it('replaces all placeholders', () => {
      const template = 'Rule: {{rule}}, From: {{from}}, Subject: {{subject}}';
      const result = renderPrompt(template, {
        rule: 'marketing',
        from: 'test@example.com',
        subject: 'Buy now'
      });
      assert.equal(result, 'Rule: marketing, From: test@example.com, Subject: Buy now');
    });

    it('replaces missing values with empty string', () => {
      const template = '{{rule}} — {{from}}';
      const result = renderPrompt(template, { rule: 'spam' });
      assert.equal(result, 'spam — ');
    });

    it('handles multiple occurrences of same placeholder', () => {
      const template = '{{rule}} and {{rule}}';
      const result = renderPrompt(template, { rule: 'test' });
      assert.equal(result, 'test and test');
    });
  });

  describe('DEFAULT_PROMPT', () => {
    it('contains required placeholders', () => {
      assert.include(DEFAULT_PROMPT, '{{rule}}');
      assert.include(DEFAULT_PROMPT, '{{from}}');
      assert.include(DEFAULT_PROMPT, '{{subject}}');
      assert.include(DEFAULT_PROMPT, '{{snippet}}');
    });

    it('asks for true/false response', () => {
      assert.include(DEFAULT_PROMPT, 'true');
      assert.include(DEFAULT_PROMPT, 'false');
    });
  });

  describe('DEFAULT_BATCH_PROMPT', () => {
    it('contains required placeholders', () => {
      assert.include(DEFAULT_BATCH_PROMPT, '{{rule}}');
      assert.include(DEFAULT_BATCH_PROMPT, '{{emails}}');
    });
  });

  describe('parseBatchResponse', () => {
    it('parses colon-separated format', () => {
      const results = parseBatchResponse('1: true\n2: false\n3: true', 3);
      assert.equal(results.get(0), true);
      assert.equal(results.get(1), false);
      assert.equal(results.get(2), true);
    });

    it('parses dot-separated format', () => {
      const results = parseBatchResponse('1. true\n2. false', 2);
      assert.equal(results.get(0), true);
      assert.equal(results.get(1), false);
    });

    it('parses space-separated format', () => {
      const results = parseBatchResponse('1 true\n2 false', 2);
      assert.equal(results.get(0), true);
      assert.equal(results.get(1), false);
    });

    it('is case insensitive', () => {
      const results = parseBatchResponse('1: True\n2: FALSE', 2);
      assert.equal(results.get(0), true);
      assert.equal(results.get(1), false);
    });

    it('ignores lines without numbers', () => {
      const results = parseBatchResponse('Here are the results:\n1: true\n2: false', 2);
      assert.equal(results.size, 2);
      assert.equal(results.get(0), true);
    });

    it('ignores out of range indices', () => {
      const results = parseBatchResponse('1: true\n5: true', 3);
      assert.equal(results.size, 1);
      assert.equal(results.get(0), true);
    });

    it('handles empty response', () => {
      const results = parseBatchResponse('', 3);
      assert.equal(results.size, 0);
    });
  });
});
