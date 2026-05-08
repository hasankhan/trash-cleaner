const fs = require('fs');
const path = require('path');
const { Command, Option } = require('commander');
const { FileSystemConfigStore } = require('./store/file-system-config-store');
const { GmailClientFactory } = require('./client/gmail-client');
const { OutlookClientFactory } = require('./client/outlook-client');
const { TrashCleanerFactory } = require('./trash-cleaner');
const { version } = require('../package.json');

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
                    .choices(['text', 'html']));
    }

    /**
     * The entry point for the command line interface.
     *
     * @param {string[]} args The command line arguments.
     * @returns {boolean} True if cli runs successfully, False otherwise.
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

        this._cmd.parse(args);
        const options = this._cmd.opts();

        try {
            const configStore = new FileSystemConfigStore(options.configDirPath);
            const client = await this._createEmailClient(configStore,
                options.service,
                options.reconfig,
                options.launch,
                options.account);
            const trashCleanerFactory = new TrashCleanerFactory(configStore,
                client,
                !options.quiet /*cliMode*/,
                !!options.quiet,
                options.format);
            const trashCleaner = await trashCleanerFactory.getInstance();
            await trashCleaner.cleanTrash(!!options.dryRun);
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
     * @returns {boolean} True if list-rules succeeds.
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
     * Creates an instance of email client by service name.
     *
     * @param {ConfigStore} configStore An instance of ConfigStore.
     * @param {string} service The email service to use.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser.
     * @param {string} account The account name. 
     * @returns {EmailClient} An instance of email client.
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
}

module.exports = { Cli };
