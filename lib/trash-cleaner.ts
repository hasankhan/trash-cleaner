import diacriticLess from 'diacriticless';

import { ConsoleProgressReporter } from './reporter/console-progress-reporter.js';
import { classifyWithCli, classifyBatchWithCli } from './classifier/llm-cli-classifier.js';
import { SeenEmailCache } from './utils/seen-email-cache.js';
import type { Email } from './client/email-client.js';
import type { EmailClient } from './client/email-client.js';
import type { ProgressReporter } from './reporter/progress-reporter.js';
import type { ConfigStore } from './store/config-store.js';
import type { ActionLog } from './utils/action-log.js';
import type { LlmProvider } from './classifier/llm-cli-classifier.js';

// The file keywords.json stores the keywords and labels to use when finding
// trash email.
const FILE_KEYWORDS = 'keywords.json';

// The file allowlist.json stores senders that are protected from actions.
const FILE_ALLOWLIST = 'allowlist.json';

// The file llm-providers.json stores LLM CLI tool configurations.
const FILE_LLM_PROVIDERS = 'llm-providers.json';

const EmailAction = {
    DELETE: 'delete',
    ARCHIVE: 'archive',
    MARK_AS_READ: 'mark-as-read'
} as const;

type EmailActionValue = typeof EmailAction[keyof typeof EmailAction];

const VALID_ACTIONS: EmailActionValue[] = Object.values(EmailAction);

const RuleType = {
    KEYWORD: 'keyword',
    LLM: 'llm'
} as const;

type RuleTypeValue = typeof RuleType[keyof typeof RuleType];

/** Map of provider name to provider configuration. */
interface LlmProviderMap {
    [name: string]: LlmProvider;
}

/** Raw keyword entry as read from keywords.json before parsing. */
interface RawKeywordEntry {
    value: string;
    fields?: string;
    labels?: string;
    action?: string;
    type?: string;
    title?: string;
    llm?: string;
}

/**
 * An object to represent single trash keyword configuration.
 */
class TrashKeyword {
    value: string;
    fields: string[];
    labels: string[];
    action: EmailActionValue;
    type: RuleTypeValue;
    title: string | undefined;
    llm: string | undefined;

    constructor(
        value: string,
        fields: string[],
        labels: string[],
        action: EmailActionValue = EmailAction.DELETE,
        type: RuleTypeValue = RuleType.KEYWORD,
        title?: string,
        llm?: string
    ) {
        if (typeof value !== 'string' || !Array.isArray(fields) ||
            !Array.isArray(labels)) {
            throw new Error('Invalid keyword');
        }
        if (!VALID_ACTIONS.includes(action)) {
            throw new Error(`Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(', ')}`);
        }
        this.value = value;
        this.fields = fields;
        this.labels = labels;
        this.action = action;
        this.type = type;
        this.title = title;
        this.llm = llm;
    }
}

/**
 * Base class for trash rules.
 */
class TrashRule {
    action: EmailActionValue = EmailAction.DELETE;
    title: string = '';

    /**
     * Applies the rule to the email attributes and returns result.
     */
    isMatch(_email: Email): boolean | Promise<boolean> {
        return false;
    }
}

/**
 * A trash identification rule based on TrashKeyword.
 */
class KeywordTrashRule extends TrashRule {
    private regex: RegExp;
    private fields: Record<string, boolean>;
    private labels: string[];

    /**
     * Creates an instance of KeywordTrashRule for the given keyword.
     */
    constructor(keyword: TrashKeyword) {
        super();
        if (!keyword || typeof keyword.value !== 'string' ||
            !Array.isArray(keyword.fields) || !Array.isArray(keyword.labels)) {
            throw new Error('Invalid keyword');
        }

        this.regex = new RegExp(keyword.value, 'giu');
        this.fields = {};
        keyword.fields.forEach(field => {
            this.fields[field === '*' ? 'all' : field.toLowerCase()] = true;
        });
        this.labels = keyword.labels.map(l => l.toLowerCase());
        this.action = keyword.action || EmailAction.DELETE;
        this.title = keyword.title || keyword.value;
    }

    /**
     * Applies the rule to the email attributes and returns result.
     */
    isMatch(email: Email): boolean {
        const keywordFound = Object.getOwnPropertyNames(email).some(field =>
            (this.fields.all || this.fields[field]) &&
            this.regex.test((email as unknown as Record<string, string>)[field]));

        return keywordFound && this.labels.some(label => label === '*' ||
            email.labels.includes(label));
    }
}

/**
 * A trash identification rule that uses an external LLM CLI tool.
 * The `value` field is a natural-language description (e.g. "marketing email").
 */
class LlmTrashRule extends TrashRule {
    readonly label: string;
    private labels: string[];
    readonly provider: LlmProvider;

    /**
     * Creates an instance of LlmTrashRule.
     */
    constructor(keyword: TrashKeyword, provider: LlmProvider) {
        super();
        this.label = keyword.value;
        this.labels = keyword.labels.map(l => l.toLowerCase());
        this.action = keyword.action || EmailAction.DELETE;
        this.title = keyword.title || keyword.value;
        this.provider = provider;
    }

    /**
     * Checks if the email matches this rule's label/folder scope.
     */
    matchesLabels(email: Email): boolean {
        return this.labels.some(label =>
            label === '*' || email.labels.includes(label));
    }

    /**
     * Checks if the email matches this LLM rule.
     */
    async isMatch(email: Email): Promise<boolean> {
        if (!this.matchesLabels(email)) {
            return false;
        }

        return await classifyWithCli(email, this.label, this.provider);
    }
}

/**
 * An object that can clean trash emails from the mailbox.
 */
class TrashCleaner {
    private _client: EmailClient;
    private _rules: TrashRule[];
    private _reporter: ProgressReporter;
    private _allowlist: RegExp[];
    private _actionLog: ActionLog | null;
    private _minAgeDays: number | null;
    private _seenCache: SeenEmailCache | null;
    private _llmProviders: LlmProviderMap;

    /**
     * Creates an instance of TrashCleaner.
     */
    constructor(
        client: EmailClient,
        keywords: TrashKeyword[],
        reporter: ProgressReporter,
        allowlist: string[] = [],
        actionLog: ActionLog | null = null,
        minAgeDays: number | null = null,
        seenCache: SeenEmailCache | null = null,
        llmProviders: LlmProviderMap = {}
    ) {
        this._client = client;
        this._llmProviders = llmProviders;
        this._rules = this._createRules(keywords);
        this._reporter = reporter;
        this._allowlist = allowlist.map(pattern => new RegExp(pattern, 'i'));
        this._actionLog = actionLog;
        this._minAgeDays = minAgeDays;
        this._seenCache = seenCache;
    }

    /**
     * Cleans trash email from the mailbox.
     */
    async cleanTrash(dryRun: boolean): Promise<void> {
        this._reporter.onStart(dryRun);

        try {
            const emails = await this._findTrashEmails();

            await this._processTrashEmails(emails, dryRun);

            if (this._seenCache) {
                await this._seenCache.save();
            }
        }
        finally {
            this._reporter.onStop();
        }
    }

    /**
     * Finds trash emails without acting on them.
     * Starts the reporter spinner but suppresses the summary output,
     * leaving display to the caller (e.g. interactive mode).
     */
    async findTrash(): Promise<Email[]> {
        this._reporter.onStart(true);
        try {
            const emails = await this._findTrashEmails();

            if (this._seenCache) {
                await this._seenCache.save();
            }

            return emails;
        } finally {
            this._reporter.onStopSpinner();
        }
    }

    /**
     * Processes pre-identified trash emails (executes actions).
     */
    async processEmails(emails: Email[]): Promise<void> {
        await this._processTrashEmails(emails, false);

        if (this._seenCache) {
            await this._seenCache.save();
        }
    }

    /**
     * Processes the trash emails by grouping them by action and executing.
     */
    private async _processTrashEmails(emails: Email[], dryRun: boolean): Promise<void> {
        if (emails.length === 0) {
            return;
        }

        const grouped: Record<string, Email[]> = {};
        for (const email of emails) {
            const action = email._action || EmailAction.DELETE;
            if (!grouped[action]) {
                grouped[action] = [];
            }
            grouped[action].push(email);
        }

        const logEntries: { id: string; action: string; from: string; subject: string }[] = [];

        for (const [action, actionEmails] of Object.entries(grouped)) {
            this._reporter.onProcessingAction(action, actionEmails.length);
            if (!dryRun) {
                switch (action) {
                    case EmailAction.ARCHIVE:
                        await this._client.archiveEmails(actionEmails);
                        break;
                    case EmailAction.MARK_AS_READ:
                        await this._client.markAsReadEmails(actionEmails);
                        break;
                    case EmailAction.DELETE:
                    default:
                        await this._client.deleteEmails(actionEmails);
                        break;
                }
                for (const email of actionEmails) {
                    logEntries.push({
                        id: email.id,
                        action,
                        from: email.from,
                        subject: email.subject
                    });
                }
            }
            this._reporter.onActionComplete(action, actionEmails.length);
        }

        if (!dryRun && this._actionLog && logEntries.length > 0) {
            this._actionLog.record(logEntries);
        }
    }

    /**
     * Deletes the trash emails.
     */
    async deleteTrashEmails(emails: Email[], dryRun: boolean): Promise<void> {
        if (emails.length === 0) {
            return;
        }

        this._reporter.onDeletingTrash();
        if (!dryRun) {
            await this._client.deleteEmails(emails);
        }
        this._reporter.onTrashDeleted();
    }

    /**
     * Converts the list of keywords into trash rules.
     */
    private _createRules(keywords: TrashKeyword[]): TrashRule[] {
        return keywords.map(keyword => {
            if (keyword.type === RuleType.LLM) {
                const provider = this._llmProviders[keyword.llm!];
                if (!provider) {
                    throw new Error(
                        `LLM provider "${keyword.llm}" not found in llm-providers.json. ` +
                        'Configure it or run "trash-cleaner init" to create the config file.'
                    );
                }
                return new LlmTrashRule(keyword, provider);
            }
            return new KeywordTrashRule(keyword);
        });
    }

    /**
     * Finds trash emails in the mailbox.
     */
    private async _findTrashEmails(): Promise<Email[]> {
        const emails = await this._getUnreadEmails();

        return await this.filterTrashEmails(emails);
    }

    /**
     * Filters out trash email from the list of emails.
     * Emails already seen in a previous run (based on date) are skipped.
     */
    async filterTrashEmails(emails: Email[]): Promise<Email[]> {
        const normalized = emails.map(this._normalizeEmail.bind(this));

        // Skip emails already evaluated in a previous run
        const toEvaluate = this._seenCache
            ? normalized.filter(email => !this._seenCache!.isSeen(email))
            : normalized;

        const trashEmails: Email[] = [];
        const needsLlm: Email[] = [];

        // Phase 1: Run keyword rules (instant)
        for (let i = 0; i < toEvaluate.length; i++) {
            this._reporter.onEvaluatingEmail(i + 1, toEvaluate.length);
            const email = toEvaluate[i]!;

            if (this._isAllowlisted(email) || !this._meetsMinAge(email)) {
                continue;
            }

            if (this._matchKeywordRules(email)) {
                trashEmails.push(email);
            } else if (this._hasLlmRules()) {
                needsLlm.push(email);
            }
        }

        // Phase 2: Batch LLM evaluation (single call per rule)
        if (needsLlm.length > 0) {
            this._reporter.onEvaluatingLlm(needsLlm.length);
            const llmMatches = await this._batchLlmEvaluation(needsLlm);
            trashEmails.push(...llmMatches);
        }

        this._reporter.onTrashEmailsIdentified(trashEmails);
        return trashEmails;
    }

    /**
     * Gets unread emails from the mailbox.
     */
    private async _getUnreadEmails(): Promise<Email[]> {
        this._reporter.onRetrievingUnreadEmails();
        try {
            const since = this._seenCache ? this._seenCache.lastRun : null;
            const emails = await this._client.getUnreadEmails(since ?? undefined);
            this._reporter.onUnreadEmailsRetrieved(emails);
            return emails;
        } catch (err) {
            throw new Error(`Failed to get trash emails: ${err}`);
        }
    }

    /**
     * Checks if a message is trash according to keywords list.
     * Tags the email with the action from the first matching rule.
     * Allowlisted senders are always protected.
     */
    private async _isTrashEmail(email: Email): Promise<boolean> {
        if (this._isAllowlisted(email)) {
            return false;
        }
        if (!this._meetsMinAge(email)) {
            return false;
        }
        for (const rule of this._rules) {
            if (await rule.isMatch(email)) {
                email._action = rule.action;
                email._rule = rule.title;
                return true;
            }
        }
        return false;
    }

    /**
     * Matches an email against keyword rules only (no LLM rules).
     * Tags the email with the action from the first matching rule.
     */
    private _matchKeywordRules(email: Email): boolean {
        for (const rule of this._rules) {
            if (rule instanceof KeywordTrashRule && rule.isMatch(email)) {
                email._action = rule.action;
                email._rule = rule.title;
                return true;
            }
        }
        return false;
    }

    /**
     * Returns true if any configured rule is an LLM rule.
     */
    private _hasLlmRules(): boolean {
        return this._rules.some(rule => rule instanceof LlmTrashRule);
    }

    /**
     * Evaluates emails against all LLM rules in batched calls.
     * Each LLM rule sends one batched prompt for all candidate emails.
     */
    private async _batchLlmEvaluation(emails: Email[]): Promise<Email[]> {
        const matched: Email[] = [];
        const remaining = new Set(emails);

        for (const rule of this._rules) {
            if (!(rule instanceof LlmTrashRule) || remaining.size === 0) {
                continue;
            }

            // Filter to emails that match this rule's label scope
            const candidates = [...remaining].filter(email =>
                rule.matchesLabels(email));

            if (candidates.length === 0) {
                continue;
            }

            const results = await classifyBatchWithCli(
                candidates, rule.label, rule.provider
            );

            for (const [index, isMatch] of results) {
                if (isMatch && remaining.has(candidates[index]!)) {
                    const email = candidates[index]!;
                    email._action = rule.action;
                    email._rule = rule.title;
                    matched.push(email);
                    remaining.delete(email);
                }
            }
        }

        return matched;
    }

    /**
     * Checks if the email meets the minimum age requirement.
     */
    private _meetsMinAge(email: Email): boolean {
        if (this._minAgeDays == null || !email.date) {
            return true;
        }
        const ageMs = Date.now() - email.date.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        return ageDays >= this._minAgeDays;
    }

    /**
     * Checks if an email's sender matches the allowlist.
     */
    private _isAllowlisted(email: Email): boolean {
        if (this._allowlist.length === 0) {
            return false;
        }
        return this._allowlist.some(pattern => pattern.test(email.from));
    }

    /**
     * Normalizes email object fields for keyword matching.
     */
    private _normalizeEmail(email: Email): Email {
        email.labels = email.labels.map(l => l.toLowerCase());
        email.snippet = diacriticLess(email.snippet);
        email.subject = diacriticLess(email.subject);
        email.from = diacriticLess(email.from);
        email.body = diacriticLess(email.body);

        return email;
    }
}

/**
 * Factory for TrashCleaner objects.
 */
class TrashCleanerFactory {
    private _configStore: ConfigStore;
    private _client: EmailClient;
    private _cliMode: boolean;
    private _quiet: boolean;
    private _format: string;
    private _actionLog: ActionLog | null;
    private _minAgeDays: number | null;

    constructor(
        configStore: ConfigStore,
        client: EmailClient,
        cliMode: boolean,
        quiet: boolean = false,
        format: string = 'text',
        actionLog: ActionLog | null = null,
        minAgeDays: number | null = null
    ) {
        this._configStore = configStore;
        this._client = client;
        this._cliMode = cliMode;
        this._quiet = quiet;
        this._format = format;
        this._actionLog = actionLog;
        this._minAgeDays = minAgeDays;
    }

    /**
     * Creates an instance of TrashCleaner.
     */
    async getInstance(): Promise<TrashCleaner> {
        const { keywords, rawKeywords } = await this.readKeywords();
        if (keywords.length === 0) {
            console.warn('Warning: No keyword rules configured. Add rules to keywords.json to identify trash emails.');
        }
        const allowlist = await this.readAllowlist();
        const llmProviders = await this.readLlmProviders();
        let reporter: ProgressReporter;
        if (this._format === 'html') {
            const { HtmlProgressReporter } = await import('./reporter/html-progress-reporter.js');
            reporter = new HtmlProgressReporter();
        } else {
            reporter = new ConsoleProgressReporter(this._cliMode, this._quiet);
        }

        const rulesHash = SeenEmailCache.computeRulesHash(rawKeywords);
        const seenCache = new SeenEmailCache(this._configStore, rulesHash);
        await seenCache.load();

        const cleaner = new TrashCleaner(this._client, keywords, reporter, allowlist, this._actionLog, this._minAgeDays, seenCache, llmProviders);
        return cleaner;
    }

    /**
     * Reads the allowlist from the config file.
     * Returns an empty array if the file doesn't exist.
     */
    async readAllowlist(): Promise<string[]> {
        let allowlist: unknown;
        try {
            allowlist = await this._configStore.getJson(FILE_ALLOWLIST);
        } catch (err) {
            // If file doesn't exist or is null, return empty allowlist
            // Re-throw parse errors
            if (err instanceof Error && err.message && err.message.includes('Unexpected token')) {
                throw err;
            }
            return [];
        }

        if (allowlist === null || allowlist === undefined) {
            return [];
        }
        if (!Array.isArray(allowlist)) {
            throw new Error('allowlist.json must contain a JSON array of sender patterns.');
        }
        return allowlist as string[];
    }

    /**
     * Reads the LLM provider configurations from the config file.
     * Returns an empty object if the file doesn't exist.
     */
    async readLlmProviders(): Promise<LlmProviderMap> {
        let providers: unknown;
        try {
            providers = await this._configStore.getJson(FILE_LLM_PROVIDERS);
        } catch (err) {
            if (err instanceof Error && err.message && err.message.includes('Unexpected token')) {
                throw err;
            }
            return {};
        }

        if (providers === null || providers === undefined) {
            return {};
        }
        if (typeof providers !== 'object' || Array.isArray(providers)) {
            throw new Error(
                'llm-providers.json must contain a JSON object mapping provider names to configs. ' +
                'See config/llm-providers.json.sample for the expected format.'
            );
        }
        this._validateLlmProviders(providers as Record<string, unknown>);
        return providers as LlmProviderMap;
    }

    /**
     * Validates the LLM providers configuration.
     */
    private _validateLlmProviders(providers: Record<string, unknown>): void {
        for (const [name, config] of Object.entries(providers)) {
            if (!config || typeof config !== 'object') {
                throw new Error(`llm-providers.json: provider "${name}" must be an object.`);
            }
            const cfg = config as Record<string, unknown>;
            if (typeof cfg.command !== 'string' || (cfg.command as string).trim() === '') {
                throw new Error(`llm-providers.json: provider "${name}" is missing a valid "command" field.`);
            }
            if (!Array.isArray(cfg.args)) {
                throw new Error(`llm-providers.json: provider "${name}" is missing an "args" array.`);
            }
            if (!(cfg.args as string[]).some(arg => arg.includes('{{prompt}}'))) {
                throw new Error(
                    `llm-providers.json: provider "${name}" args must contain a "{{prompt}}" placeholder.`
                );
            }
            if (cfg.prompt !== undefined && (typeof cfg.prompt !== 'string' || (cfg.prompt as string).trim() === '')) {
                throw new Error(`llm-providers.json: provider "${name}" has an invalid "prompt" field.`);
            }
        }
    }

    /**
     * Reads the trash keywords from the config file.
     */
    async readKeywords(): Promise<{ keywords: TrashKeyword[]; rawKeywords: RawKeywordEntry[] }> {
        let rawKeywords: unknown;
        try {
            rawKeywords = await this._configStore.getJson(FILE_KEYWORDS);
        } catch (err) {
            if (err instanceof Error && err.message && err.message.includes('Unexpected token')) {
                throw err;
            }
            return { keywords: [], rawKeywords: [] };
        }
        this._validateKeywordsConfig(rawKeywords);
        const entries = rawKeywords as RawKeywordEntry[];
        const keywords = entries.map((keyword, index) => {
            try {
                const fields = this.splitAndTrim(keyword.fields, ',', '*');
                const labels = this.splitAndTrim(keyword.labels, ',', '*');
                const type = (keyword.type || RuleType.KEYWORD) as RuleTypeValue;
                return new TrashKeyword(keyword.value, fields, labels, keyword.action as EmailActionValue, type, keyword.title, keyword.llm);
            } catch (err) {
                throw new Error(`Invalid keyword at index ${index}: ${(err as Error).message}`);
            }
        });
        return { keywords, rawKeywords: entries };
    }

    /**
     * Validates the keywords.json configuration structure.
     */
    private _validateKeywordsConfig(keywords: unknown): asserts keywords is RawKeywordEntry[] {
        if (!Array.isArray(keywords)) {
            throw new Error(
                'keywords.json must contain a JSON array. ' +
                'See config/keywords.json.sample for the expected format.'
            );
        }
        if (keywords.length === 0) {
            return;
        }
        for (let i = 0; i < keywords.length; i++) {
            const entry = keywords[i] as Record<string, unknown>;
            if (!entry || typeof entry !== 'object') {
                throw new Error(
                    `keywords.json entry at index ${i} must be an object. ` +
                    'Expected format: { "value": "pattern", "fields": "...", "labels": "..." }'
                );
            }
            if (entry.type !== undefined && entry.type !== RuleType.KEYWORD && entry.type !== RuleType.LLM) {
                throw new Error(
                    `keywords.json entry at index ${i}: invalid type "${entry.type}". ` +
                    `Must be one of: ${RuleType.KEYWORD}, ${RuleType.LLM}`
                );
            }
            if (typeof entry.value !== 'string' || (entry.value as string).trim() === '') {
                throw new Error(
                    `keywords.json entry at index ${i} is missing a valid "value" field. ` +
                    'The "value" field must be a non-empty string.'
                );
            }
            if (entry.fields !== undefined && typeof entry.fields !== 'string') {
                throw new Error(
                    `keywords.json entry at index ${i}: "fields" must be a comma-separated string ` +
                    '(e.g. "subject,body" or "*"). Got: ' + typeof entry.fields
                );
            }
            if (entry.labels !== undefined && typeof entry.labels !== 'string') {
                throw new Error(
                    `keywords.json entry at index ${i}: "labels" must be a comma-separated string ` +
                    '(e.g. "spam,inbox" or "*"). Got: ' + typeof entry.labels
                );
            }
            if (entry.action !== undefined && !VALID_ACTIONS.includes(entry.action as EmailActionValue)) {
                throw new Error(
                    `keywords.json entry at index ${i}: invalid action "${entry.action}". ` +
                    `Must be one of: ${VALID_ACTIONS.join(', ')}`
                );
            }
            if (entry.title !== undefined && (typeof entry.title !== 'string' || (entry.title as string).trim() === '')) {
                throw new Error(
                    `keywords.json entry at index ${i}: "title" must be a non-empty string.`
                );
            }
            if (entry.type === RuleType.LLM) {
                if (typeof entry.llm !== 'string' || (entry.llm as string).trim() === '') {
                    throw new Error(
                        `keywords.json entry at index ${i}: LLM rules require a "llm" field ` +
                        'specifying the provider name (e.g. "claude", "copilot").'
                    );
                }
            }
        }
    }

    /**
     * Splits and trims a delimited string.
     */
    splitAndTrim(string: string | undefined, separator: string, defaultValue: string): string[] {
        return (string ?? defaultValue).split(separator)
            .map(t => t.trim())
            .filter(t => t);
    }
}

export {
    EmailAction,
    RuleType,
    TrashKeyword,
    TrashCleaner,
    TrashCleanerFactory,
    TrashRule,
    LlmTrashRule,
    KeywordTrashRule,
};

export type { EmailActionValue, RuleTypeValue, LlmProviderMap, RawKeywordEntry };
