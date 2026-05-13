/**
 * LLM CLI classifier — invokes an external LLM tool as a subprocess
 * and interprets its response as true/false.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_PROMPT = `Does the following email match this description: "{{rule}}"?
Reply with only "true" or "false", nothing else.

From: {{from}}
Subject: {{subject}}
Snippet: {{snippet}}`;

/**
 * Renders a prompt template by replacing placeholders.
 *
 * @param {string} template The prompt template with {{placeholders}}.
 * @param {object} values Key-value pairs for replacement.
 * @returns {string} The rendered prompt.
 */
function renderPrompt(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        values[key] !== undefined ? String(values[key]) : '');
}

/**
 * Classifies an email by invoking an external LLM CLI tool.
 *
 * @param {object} email The email object with from, subject, snippet fields.
 * @param {string} ruleDescription The natural language rule description.
 * @param {object} provider The LLM provider config (command, args, optional prompt).
 * @returns {Promise<boolean>} True if the LLM says the email matches.
 */
async function classifyWithCli(email, ruleDescription, provider) {
    const promptTemplate = provider.prompt || DEFAULT_PROMPT;
    const prompt = renderPrompt(promptTemplate, {
        rule: ruleDescription,
        from: email.from || '',
        subject: email.subject || '',
        snippet: email.snippet || ''
    });

    const args = provider.args.map(arg =>
        arg === '{{prompt}}' ? prompt : arg
    );

    try {
        const { stdout } = await execFileAsync(provider.command, args, {
            timeout: 30000,
            maxBuffer: 1024 * 64
        });
        const response = stdout.trim().toLowerCase();
        return response === 'true' || response.startsWith('true');
    } catch (err) {
        // If the CLI tool fails, treat as non-match (don't delete emails on error)
        const msg = err.code === 'ENOENT'
            ? `LLM command not found: "${provider.command}". Is it installed and in PATH?`
            : `LLM command failed: ${err.message}`;
        throw new Error(msg);
    }
}

export { classifyWithCli, renderPrompt, DEFAULT_PROMPT };
