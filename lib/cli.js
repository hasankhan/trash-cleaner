import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { Command, Option } from 'commander';
import { FileSystemConfigStore } from './store/file-system-config-store.js';
import { SecureConfigStore } from './store/secure-config-store.js';
import { GmailClientFactory } from './client/gmail-client.js';
import { OutlookClientFactory } from './client/outlook-client.js';
import { ImapClientFactory } from './client/imap-client.js';
import { TrashCleanerFactory } from './trash-cleaner.js';
import { ActionLog } from './utils/action-log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = pkg.version;

/** @typedef {import('./store/config-store.js').ConfigStore} ConfigStore */
/** @typedef {import('./client/email-client.js').EmailClient} EmailClient */
/** @typedef {import('./trash-cleaner.js').TrashCleaner} TrashCleaner */

const EmailService = {
    IMAP: 'imap',
    GMAIL: 'gmail',
    OUTLOOK: 'outlook'
};

const PATH_CONFIG = path.join(os.homedir(), '.config', 'trash-cleaner');

// Sample files bundled with the package
const SAMPLE_DIR = path.join(__dirname, '..', 'config');
const SAMPLE_FILES = {
    'keywords.json': 'keywords.json.sample',
    'imap.credentials.json': 'imap.credentials.json.sample',
    'gmail.credentials.json': 'gmail.credentials.json.sample',
    'outlook.credentials.json': 'outlook.credentials.sample.json'
};

/**
 * A command line interface for the trash cleaner.
 */
class Cli {
    /**
     * Creates an instance of Cli.
     */
    constructor() {
        this._cmd = new Command();
        this._cmd.version(version);
        this._cmd
            .addOption(
                new Option('-r, --reconfig', 'reconfigures the auth for a service'))
            .addOption(
                new Option('-t, --dry-run', 'perform a dry-run cleanup without deleting the emails'))
            .addOption(
                new Option('-q, --quiet', 'suppress spinner and verbose output (for cron/scripts)'))
            .addOption(
                new Option('-i, --interactive', 'preview matches and confirm before acting'))
            .addOption(
                new Option('-d, --debug', 'output extra debugging info'))
            .addOption(
                new Option('-l, --launch', 'launch the auth url in the browser'))
            .addOption(
                new Option('-c, --configDirPath <path>',
                    'the path to config directory')
                    .default(PATH_CONFIG))
            .addOption(
                new Option('-s, --service <service>',
                    'the email service to use')
                    .default(EmailService.IMAP)
                    .choices(Object.values(EmailService)))
            .addOption(
                new Option('-a, --account <name>',
                    'the account name for multi-account support')
                    .default('default'))
            .addOption(
                new Option('-f, --format <format>',
                    'output format for the report')
                    .default('text')
                    .choices(['text', 'html']))
            .addOption(
                new Option('-m, --min-age <days>',
                    'only process emails older than N days')
                    .argParser(parseInt));

        this._cmd.addHelpText('after', `
Commands:
  login                           save credentials securely in OS keychain
  logout                          remove credentials from OS keychain
  init [configDir]                initialize config directory with sample files
  validate [configDir]            validate keywords config file
  list-rules [configDir]          list all configured keyword rules
  undo [configDir]                undo last action using the action log`);
    }

    /**
     * The entry point for the command line interface.
     *
     * @param {string[]} args The command line arguments.
     * @returns {Promise<boolean>} True if cli runs successfully, False otherwise.
     */
    async run(args) {
        // Handle 'init' subcommand before Commander parsing
        const initIndex = args.indexOf('init');
        if (initIndex >= 2) {
            const configDirPath = args[initIndex + 1] || PATH_CONFIG;
            return this._initConfig(configDirPath);
        }

        // Handle 'list-rules' subcommand before Commander parsing
        const listRulesIndex = args.indexOf('list-rules');
        if (listRulesIndex >= 2) {
            const configDirPath = args[listRulesIndex + 1] || PATH_CONFIG;
            return this._listRules(configDirPath);
        }

        // Handle 'undo' subcommand before Commander parsing
        const undoIndex = args.indexOf('undo');
        if (undoIndex >= 2) {
            const configDirPath = args[undoIndex + 1] || PATH_CONFIG;
            return this._undo(configDirPath, args);
        }

        // Handle 'validate' subcommand before Commander parsing
        const validateIndex = args.indexOf('validate');
        if (validateIndex >= 2) {
            const configDirPath = args[validateIndex + 1] || PATH_CONFIG;
            return this._validate(configDirPath);
        }

        // Handle 'login' subcommand before Commander parsing
        const loginIndex = args.indexOf('login');
        if (loginIndex >= 2) {
            return this._login(args);
        }

        // Handle 'logout' subcommand before Commander parsing
        const logoutIndex = args.indexOf('logout');
        if (logoutIndex >= 2) {
            return this._logout(args);
        }

        this._cmd.parse(args);
        const options = this._cmd.opts();

        if (!fs.existsSync(options.configDirPath)) {
            console.error(`Config directory not found: ${options.configDirPath}\nRun 'trash-cleaner init' to set up your configuration.`);
            return false;
        }

        try {
            const configStore = this._createConfigStore(options.configDirPath);
            const client = await this._createEmailClient(configStore,
                options.service,
                options.reconfig,
                options.launch,
                options.account);
            const actionLog = new ActionLog(options.configDirPath);
            const trashCleanerFactory = new TrashCleanerFactory(configStore,
                client,
                !options.quiet /*cliMode*/,
                !!options.quiet,
                options.format,
                actionLog,
                options.minAge);
            const trashCleaner = await trashCleanerFactory.getInstance();

            if (options.interactive) {
                await this._runInteractive(trashCleaner);
            } else {
                await trashCleaner.cleanTrash(!!options.dryRun);
            }
        }
        catch (err) {
            if (options.debug) {
                console.error('An error occurred:', err);
            }
            else {
                console.error(err.message);
            }
            return false;
        }

        return true;
    }

    /**
     * Initializes the config directory with sample files.
     *
     * @param {string} configDirPath Path to the config directory.
     * @returns {boolean} True if init succeeds.
     */
    _initConfig(configDirPath) {
        if (!fs.existsSync(configDirPath)) {
            fs.mkdirSync(configDirPath, { recursive: true });
            console.log(`Created config directory: ${configDirPath}`);
        } else {
            console.log(`Config directory already exists: ${configDirPath}`);
        }

        let copiedCount = 0;
        for (const [targetName, sampleName] of Object.entries(SAMPLE_FILES)) {
            const targetPath = path.join(configDirPath, targetName);
            const samplePath = path.join(SAMPLE_DIR, sampleName);

            if (fs.existsSync(targetPath)) {
                console.log(`  Skipped ${targetName} (already exists)`);
            } else if (!fs.existsSync(samplePath)) {
                console.log(`  Skipped ${targetName} (sample not found)`);
            } else {
                fs.copyFileSync(samplePath, targetPath);
                console.log(`  Created ${targetName}`);
                copiedCount++;
            }
        }

        console.log('');
        if (copiedCount > 0) {
            console.log('Next steps:');
            console.log(`  1. Edit ${path.join(configDirPath, 'keywords.json')} to configure your keyword rules`);
            console.log(`  2. Run: trash-cleaner login   (saves credentials securely in OS keychain)`);
            console.log(`     or edit IMAP/Gmail/Outlook credential files for file-based setup`);
            console.log(`  3. Run: trash-cleaner -c ${configDirPath}`);
        } else {
            console.log('All config files already exist. Edit them as needed.');
        }

        return true;
    }

    /**
     * Lists active keyword rules from the config.
     *
     * @param {string} configDirPath Path to the config directory.
     * @returns {Promise<boolean>} True if list-rules succeeds.
     */
    async _listRules(configDirPath) {
        try {
            const configStore = new FileSystemConfigStore(configDirPath);
            const factory = new TrashCleanerFactory(configStore, /** @type {any} */ ({}), false);
            const { keywords } = await factory.readKeywords();

            console.log(`Rules loaded from: ${path.join(configDirPath, 'keywords.json')}`);
            console.log(`Total rules: ${keywords.length}`);
            console.log('');

            keywords.forEach((keyword, index) => {
                const action = keyword.action || 'delete';
                const fields = keyword.fields.join(', ');
                const labels = keyword.labels.join(', ');
                console.log(`  ${index + 1}. /${keyword.value}/`);
                console.log(`     Fields: ${fields} | Labels: ${labels} | Action: ${action}`);
            });

            // Show allowlist if present
            const allowlist = await factory.readAllowlist();
            if (allowlist.length > 0) {
                console.log('');
                console.log(`Allowlist (${allowlist.length} pattern${allowlist.length === 1 ? '' : 's'}):`);
                allowlist.forEach((pattern, index) => {
                    console.log(`  ${index + 1}. /${pattern}/`);
                });
            }
        } catch (err) {
            console.error(err.message);
            return false;
        }

        return true;
    }

    /**
     * Shows the last action batch and offers to undo it.
     *
     * @param {string} configDirPath The config directory path.
     * @param {string[]} args CLI args (to detect --service and --account).
     * @returns {Promise<boolean>} True on success.
     */
    async _undo(configDirPath, args) {
        const actionLog = new ActionLog(configDirPath);
        const batch = actionLog.getLastBatch();

        if (!batch) {
            console.log('No actions to undo.');
            return true;
        }

        console.log(`\nLast action (${batch.timestamp}):\n`);
        batch.entries.forEach((entry, i) => {
            console.log(`  ${i + 1}. [${entry.action}] ${entry.from} — ${entry.subject}`);
        });
        console.log('');

        const confirmed = await this._confirm(
            `Restore ${batch.entries.length} email(s)? (y/N) `
        );

        if (!confirmed) {
            console.log('Cancelled.');
            return true;
        }

        // Determine service and account from args
        const serviceIndex = args.indexOf('-s') !== -1 ? args.indexOf('-s') : args.indexOf('--service');
        const service = serviceIndex !== -1 ? args[serviceIndex + 1] : EmailService.IMAP;

        if (service === EmailService.IMAP) {
            console.error('Undo is not supported in IMAP mode. Use --service gmail or --service outlook for undo support.');
            return false;
        }

        const accountIndex = args.indexOf('-a') !== -1 ? args.indexOf('-a') : args.indexOf('--account');
        const account = accountIndex !== -1 ? args[accountIndex + 1] : undefined;

        try {
            const configStore = this._createConfigStore(configDirPath);
            const client = await this._createEmailClient(configStore, service, false, false, account);

            const emailIds = batch.entries.map(e => e.id);
            await client.restoreEmails(emailIds);

            actionLog.removeLastBatch();
            console.log(`Restored ${batch.entries.length} email(s).`);
        } catch (err) {
            console.error(`Undo failed: ${err.message}`);
            return false;
        }

        return true;
    }

    /**
     * Validates configuration files and reports any issues.
     *
     * @param {string} configDirPath The config directory path.
     * @returns {Promise<boolean>} True if config is valid.
     */
    async _validate(configDirPath) {
        const issues = [];
        let hasErrors = false;

        // Check config directory exists
        if (!fs.existsSync(configDirPath)) {
            console.error(`Config directory not found: ${configDirPath}`);
            console.log('Run "trash-cleaner init" to create it.');
            return false;
        }

        // Check keywords.json
        const keywordsPath = path.join(configDirPath, 'keywords.json');
        if (!fs.existsSync(keywordsPath)) {
            issues.push({ file: 'keywords.json', level: 'error', message: 'File not found (required)' });
            hasErrors = true;
        } else {
            try {
                const configStore = new FileSystemConfigStore(configDirPath);
                const factory = new TrashCleanerFactory(configStore, /** @type {any} */ ({}), false);
                const { keywords } = await factory.readKeywords();
                issues.push({ file: 'keywords.json', level: 'ok', message: `${keywords.length} rule(s) loaded` });
            } catch (err) {
                issues.push({ file: 'keywords.json', level: 'error', message: err.message });
                hasErrors = true;
            }
        }

        // Check allowlist.json (optional)
        const allowlistPath = path.join(configDirPath, 'allowlist.json');
        if (fs.existsSync(allowlistPath)) {
            try {
                const configStore = new FileSystemConfigStore(configDirPath);
                const factory = new TrashCleanerFactory(configStore, /** @type {any} */ ({}), false);
                const allowlist = await factory.readAllowlist();
                // Validate patterns compile to regex
                for (const pattern of allowlist) {
                    new RegExp(pattern, 'i');
                }
                issues.push({ file: 'allowlist.json', level: 'ok', message: `${allowlist.length} pattern(s) loaded` });
            } catch (err) {
                issues.push({ file: 'allowlist.json', level: 'error', message: err.message });
                hasErrors = true;
            }
        } else {
            issues.push({ file: 'allowlist.json', level: 'info', message: 'Not found (optional)' });
        }

        // Check credential files
        for (const credFile of ['imap.credentials.json', 'gmail.credentials.json', 'outlook.credentials.json']) {
            const credPath = path.join(configDirPath, credFile);
            if (fs.existsSync(credPath)) {
                try {
                    JSON.parse(fs.readFileSync(credPath, 'utf8'));
                    issues.push({ file: credFile, level: 'ok', message: 'Valid JSON' });
                } catch {
                    issues.push({ file: credFile, level: 'error', message: 'Invalid JSON' });
                    hasErrors = true;
                }
            } else {
                issues.push({ file: credFile, level: 'info', message: 'Not found (needed for service)' });
            }
        }

        // Print results
        console.log(`\nValidating config: ${configDirPath}\n`);
        for (const issue of issues) {
            const icon = issue.level === 'ok' ? '✓' : issue.level === 'error' ? '✗' : '–';
            console.log(`  ${icon} ${issue.file}: ${issue.message}`);
        }
        console.log('');

        if (hasErrors) {
            console.log('Validation failed. Fix the errors above.');
        } else {
            console.log('Configuration is valid.');
        }

        return !hasErrors;
    }

    /**
     * Creates a ConfigStore with keychain support for secure credential storage.
     *
     * @param {string} configDirPath Path to the config directory.
     * @returns {ConfigStore} The config store.
     */
    _createConfigStore(configDirPath) {
        const fileStore = new FileSystemConfigStore(configDirPath);
        return new SecureConfigStore(fileStore);
    }

    /**
     * Creates a readline interface for interactive prompts.
     *
     * @returns {readline.Interface} The readline interface.
     */
    _createReadlineInterface() {
        return readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    /**
     * Saves credentials to the OS keychain for a service.
     *
     * @param {string[]} args CLI args.
     * @returns {Promise<boolean>} True on success.
     */
    async _login(args) {
        const service = this._getArgValue(args, '-s', '--service') || EmailService.IMAP;
        const account = this._getArgValue(args, '-a', '--account') || 'default';

        const rl = this._createReadlineInterface();
        const ask = (question) => new Promise(resolve =>
            rl.question(question, resolve));

        try {
            /** @type {object} */
            let credentials;
            /** @type {string} */
            let keychainKey;

            switch (service) {
                case EmailService.IMAP: {
                    const suffix = (!account || account === 'default') ? '' : `.${account}`;
                    keychainKey = `imap.credentials${suffix}.json`;
                    const host = await ask('IMAP host (e.g., imap.gmail.com): ');
                    if (!host.trim()) {
                        console.error('Error: IMAP host is required.');
                        return false;
                    }
                    const port = await ask('IMAP port (default: 993): ');
                    const user = await ask('Email address: ');
                    if (!user.trim()) {
                        console.error('Error: Email address is required.');
                        return false;
                    }
                    const password = await ask('App password: ');
                    if (!password.trim()) {
                        console.error('Error: App password is required.');
                        return false;
                    }
                    const archiveFolder = await ask('Archive folder (default: Archive): ');
                    credentials = {
                        host: host.trim(),
                        port: parseInt(port) || 993,
                        user: user.trim(),
                        password,
                        archiveFolder: archiveFolder.trim() || undefined
                    };
                    break;
                }
                case EmailService.GMAIL: {
                    const suffix = (!account || account === 'default') ? '' : `.${account}`;
                    keychainKey = `gmail.credentials${suffix}.json`;
                    console.log('Paste your Gmail OAuth2 credentials JSON (from Google Cloud Console):');
                    const json = await ask('> ');
                    if (!json.trim()) {
                        console.error('Error: OAuth2 credentials JSON is required.');
                        return false;
                    }
                    credentials = JSON.parse(json);
                    break;
                }
                case EmailService.OUTLOOK: {
                    const suffix = (!account || account === 'default') ? '' : `.${account}`;
                    keychainKey = `outlook.credentials${suffix}.json`;
                    const clientId = await ask('Client ID: ');
                    if (!clientId.trim()) {
                        console.error('Error: Client ID is required.');
                        return false;
                    }
                    const tenantId = await ask('Tenant ID: ');
                    if (!tenantId.trim()) {
                        console.error('Error: Tenant ID is required.');
                        return false;
                    }
                    const aadEndpoint = await ask('AAD endpoint (default: https://login.microsoftonline.com/): ');
                    const graphEndpoint = await ask('Graph endpoint (default: https://graph.microsoft.com/): ');
                    credentials = {
                        client_id: clientId.trim(),
                        tenant_id: tenantId.trim(),
                        aad_endpoint: aadEndpoint.trim() || 'https://login.microsoftonline.com/',
                        graph_endpoint: graphEndpoint.trim() || 'https://graph.microsoft.com/'
                    };
                    break;
                }
                default:
                    console.error(`Unknown service: ${service}`);
                    return false;
            }

            const { SecureConfigStore: SC } = await import('./store/secure-config-store.js');
            const store = new SC(/** @type {any} */ ({ get: () => null, put: () => {} }));
            await store.putJson(keychainKey, credentials);

            console.log(`\n✓ Credentials saved to OS keychain for ${service} (account: ${account})`);
            console.log('  Your credentials are stored securely and will not be written to disk.');
            if (!fs.existsSync(PATH_CONFIG)) {
                console.log(`\nNext step: run 'trash-cleaner init' to create your config directory with keyword rules.`);
            }
            return true;
        } catch (err) {
            console.error(`Login failed: ${err.message}`);
            return false;
        } finally {
            rl.close();
        }
    }

    /**
     * Removes credentials from the OS keychain for a service.
     *
     * @param {string[]} args CLI args.
     * @returns {Promise<boolean>} True on success.
     */
    async _logout(args) {
        const service = this._getArgValue(args, '-s', '--service') || EmailService.IMAP;
        const account = this._getArgValue(args, '-a', '--account') || 'default';
        const suffix = (!account || account === 'default') ? '' : `.${account}`;

        const { SecureConfigStore: SC } = await import('./store/secure-config-store.js');
        const store = new SC(/** @type {any} */ ({ get: () => null, put: () => {} }));

        /** @type {string[]} */
        const keys = [];

        switch (service) {
            case EmailService.IMAP:
                keys.push(`imap.credentials${suffix}.json`);
                break;
            case EmailService.GMAIL:
                keys.push(`gmail.credentials${suffix}.json`);
                keys.push(`gmail.token${suffix}.json`);
                break;
            case EmailService.OUTLOOK:
                keys.push(`outlook.credentials${suffix}.json`);
                keys.push(`outlook.token${suffix}.json`);
                break;
            default:
                console.error(`Unknown service: ${service}`);
                return false;
        }

        let removed = 0;
        for (const key of keys) {
            if (await store.remove(key)) {
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`✓ Removed ${removed} credential(s) from OS keychain for ${service} (account: ${account})`);
        } else {
            console.log(`No keychain credentials found for ${service} (account: ${account})`);
        }

        return true;
    }

    /**
     * Gets a CLI argument value by short or long flag.
     *
     * @param {string[]} args The CLI args.
     * @param {string} shortFlag The short flag (e.g., '-s').
     * @param {string} longFlag The long flag (e.g., '--service').
     * @returns {string|undefined} The argument value.
     */
    _getArgValue(args, shortFlag, longFlag) {
        const index = args.indexOf(shortFlag) !== -1 ? args.indexOf(shortFlag) : args.indexOf(longFlag);
        return index !== -1 ? args[index + 1] : undefined;
    }

    /**
     * Creates an instance of email client by service name.
     *
     * @param {ConfigStore} configStore An instance of ConfigStore.
     * @param {string} service The email service to use.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser.
     * @param {string} account The account name. 
     * @returns {Promise<EmailClient>} An instance of email client.
     */
    async _createEmailClient(configStore, service, reconfig, launch, account) {
        let factory = null;
        switch (service) {
            case EmailService.IMAP:
                factory = new ImapClientFactory(configStore, account);
                break;
            case EmailService.GMAIL:
                factory = new GmailClientFactory(configStore, account);
                break;
            case EmailService.OUTLOOK:
                factory = new OutlookClientFactory(configStore, account);
                break;
            default:
                throw new Error(`Email service '${service}' not yet implemented.`);
        }
        return await factory.getInstance(reconfig, launch);
    }

    /**
     * Runs the cleaner in interactive mode: preview matches, then confirm.
     *
     * @param {TrashCleaner} trashCleaner The configured cleaner instance.
     */
    async _runInteractive(trashCleaner) {
        const emails = await trashCleaner.findTrash();

        if (emails.length === 0) {
            console.log('No trash emails found.');
            return;
        }

        console.log(`\nFound ${emails.length} trash email(s):\n`);
        emails.forEach((email, i) => {
            const action = email._action || 'delete';
            const rule = email._rule ? ` (${email._rule})` : '';
            console.log(`  ${i + 1}. [${action}]${rule} ${email.from} — ${email.subject}`);
        });
        console.log('');

        const confirmed = await this._confirm(
            `Proceed with these actions on ${emails.length} email(s)? (y/N) `
        );

        if (confirmed) {
            await trashCleaner.processEmails(emails);
            console.log('Done.');
        } else {
            console.log('Cancelled.');
        }
    }

    /**
     * Prompts the user for yes/no confirmation.
     *
     * @param {string} question The question to ask.
     * @returns {Promise<boolean>} True if user confirms.
     */
    _confirm(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
            });
        });
    }
}

export { Cli };
