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

const DEFAULT_BATCH_PROMPT = `For each numbered email below, decide if it matches: "{{rule}}".
Reply with one line per email: the number followed by true or false.
Example: "1: true"

{{emails}}`;

interface LlmEmail {
    from?: string;
    subject?: string;
    snippet?: string;
}

interface LlmProvider {
    command: string;
    args: string[];
    prompt?: string;
    batchPrompt?: string;
}

/**
 * Renders a prompt template by replacing placeholders.
 */
function renderPrompt(template: string, values: Record<string, string | undefined>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
        values[key] !== undefined ? String(values[key]) : '');
}

/**
 * Classifies an email by invoking an external LLM CLI tool.
 */
async function classifyWithCli(email: LlmEmail, ruleDescription: string, provider: LlmProvider): Promise<boolean> {
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
        const error = err as NodeJS.ErrnoException;
        const msg = error.code === 'ENOENT'
            ? `LLM command not found: "${provider.command}". Is it installed and in PATH?`
            : `LLM command failed: ${error.message}`;
        throw new Error(msg);
    }
}

/**
 * Classifies a batch of emails in a single LLM CLI call.
 * Returns a map of index → true/false result.
 */
async function classifyBatchWithCli(
    emails: LlmEmail[],
    ruleDescription: string,
    provider: LlmProvider
): Promise<Map<number, boolean>> {
    if (emails.length === 0) {
        return new Map();
    }

    // Build numbered email list
    const emailLines = emails.map((email, i) => {
        return `${i + 1}.\nFrom: ${email.from || ''}\nSubject: ${email.subject || ''}\nSnippet: ${email.snippet || ''}`;
    }).join('\n\n');

    const promptTemplate = provider.batchPrompt || DEFAULT_BATCH_PROMPT;
    const prompt = renderPrompt(promptTemplate, {
        rule: ruleDescription,
        emails: emailLines
    });

    const args = provider.args.map(arg =>
        arg === '{{prompt}}' ? prompt : arg
    );

    // Longer timeout for batch calls
    const timeout = Math.max(60000, emails.length * 5000);

    try {
        const { stdout } = await execFileAsync(provider.command, args, {
            timeout,
            maxBuffer: 1024 * 256
        });
        return parseBatchResponse(stdout, emails.length);
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        const msg = error.code === 'ENOENT'
            ? `LLM command not found: "${provider.command}". Is it installed and in PATH?`
            : `LLM batch command failed: ${error.message}`;
        throw new Error(msg);
    }
}

/**
 * Parses numbered true/false lines from LLM batch response.
 * Accepts formats like "1: true", "1. true", "1 true", "1:true".
 */
function parseBatchResponse(stdout: string, count: number): Map<number, boolean> {
    const results = new Map<number, boolean>();
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s*[.:)\-]?\s*(true|false)\b/i);
        if (match) {
            const index = parseInt(match[1]!) - 1;
            if (index >= 0 && index < count) {
                results.set(index, match[2]!.toLowerCase() === 'true');
            }
        }
    }

    return results;
}

export { classifyWithCli, classifyBatchWithCli, renderPrompt, parseBatchResponse, DEFAULT_PROMPT, DEFAULT_BATCH_PROMPT };
export type { LlmEmail, LlmProvider };
