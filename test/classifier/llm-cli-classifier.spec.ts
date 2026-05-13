import { assert } from 'chai';
import { renderPrompt, DEFAULT_PROMPT } from '../../lib/classifier/llm-cli-classifier.js';

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
});
