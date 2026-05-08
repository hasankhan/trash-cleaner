const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command, Option } = require('commander');
const { FileSystemConfigStore } = require('./store/file-system-config-store');
const { GmailClientFactory } = require('./client/gmail-client');
const { OutlookClientFactory } = require('./client/outlook-client');
const { TrashCleanerFactory } = require('./trash-cleaner');
const { ActionLog } = require('./utils/action-log');
const { version } = require('../package.json');

/** @typedef {import('./store/config-store').ConfigStore} ConfigStore */
/** @typedef {import('./client/email-client').EmailClient} EmailClient */
/** @typedef {import('./trash-cleaner').TrashCleaner} TrashCleaner */

const EmailService = {
    GMAIL: 'gmail',
    OUTLOOK: 'outlook'
};

const PATH_CONFIG = 'config';

// Sample files bundled with the package
const SAMPLE_DIR = path.join(__dirname, '..', 'config');
const SAMPLE_FILES = {
    'keywords.json': 'keywords.json.sample',
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
                    .default(EmailService.GMAIL)
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

        this._cmd.parse(args);
        const options = this._cmd.opts();

        try {
            const configStore = new FileSystemConfigStore(options.configDirPath);
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
            console.log(`  2. Set up Gmail credentials: see README.md "Gmail Configuration"`);
            console.log(`     or Outlook credentials: see README.md "Outlook Configuration"`);
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
            const factory = new TrashCleanerFactory(configStore, {}, false);
            const keywords = await factory.readKeywords();

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
        const service = serviceIndex !== -1 ? args[serviceIndex + 1] : EmailService.GMAIL;
        const accountIndex = args.indexOf('-a') !== -1 ? args.indexOf('-a') : args.indexOf('--account');
        const account = accountIndex !== -1 ? args[accountIndex + 1] : undefined;

        try {
            const configStore = new FileSystemConfigStore(configDirPath);
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
            console.log(`  ${i + 1}. [${action}] ${email.from} — ${email.subject}`);
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

module.exports = { Cli };
