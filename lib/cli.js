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
                    .choices(Object.values(EmailService)));
    }

    /**
     * The entry point for the command line interface.
     *
     * @param {string[]} args The command line arguments.
     * @returns {boolean} True if cli runs successfully, False otherwise.
     */
    async run(args) {
        this._cmd.parse(args);
        let options = this._cmd.opts();

        try {
            let configStore = new FileSystemConfigStore(options.configDirPath);
            let client = await this._createEmailClient(configStore,
                options.service,
                options.reconfig,
                options.launch);
            let trashCleanerFactory = new TrashCleanerFactory(configStore,
                client,
                true /*cliMode*/);
            let trashCleaner = await trashCleanerFactory.getInstance();
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
     * Creates an instance of email client by service name.
     *
     * @param {ConfigStore} configStore An instance of ConfigStore.
     * @param {string} service The email service to use.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {EmailClient} An instance of email client.
     */
    async _createEmailClient(configStore, service, reconfig, launch) {
        let factory = null;
        switch (service) {
            case EmailService.GMAIL:
                factory = new GmailClientFactory(configStore);
                break;
            case EmailService.OUTLOOK:
                factory = new OutlookClientFactory(configStore);
                break;
            default:
                throw new Error(`Email service '${service}' not yet implemented.`);
        }
        return await factory.getInstance(reconfig, launch);
    }
}

module.exports = { Cli };
