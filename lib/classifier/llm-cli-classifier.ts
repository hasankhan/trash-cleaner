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

interface LlmEmail {
    from?: string;
    subject?: string;
    snippet?: string;
}

interface LlmProvider {
    command: string;
    args: string[];
    prompt?: string;
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
        // If the CLI tool fails, treat as non-match (don't delete emails on error)
        const msg = error.code === 'ENOENT'
            ? `LLM command not found: "${provider.command}". Is it installed and in PATH?`
            : `LLM command failed: ${error.message}`;
        throw new Error(msg);
    }
}

export { classifyWithCli, renderPrompt, DEFAULT_PROMPT };
export type { LlmEmail, LlmProvider };
