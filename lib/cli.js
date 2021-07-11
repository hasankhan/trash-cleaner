const { FileSystemConfigStore } = require('./store/file-system-config-store');
const { TrashCleanerFactory } = require('./trash-cleaner');
const { GmailClientFactory } = require('./client/gmail-client');
const { Command, Option } = require('commander');

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
        this._cmd.version('0.0.1');
        this._cmd
            .addOption(
                new Option('-d, --debug', 'output extra debugging info'))
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
            let client = await this._createEmailClient(configStore, options.service);
            let trashCleanerFactory = new TrashCleanerFactory(configStore, client, true /*cliMode*/);
            let trashCleaner = await trashCleanerFactory.getInstance();
            await trashCleaner.cleanTrash();
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
     * @returns {EmailClient} An instance of email client.
     */
    async _createEmailClient(configStore, service) {
        let factory = null;
        switch (service) {
            case EmailService.GMAIL:
                factory = new GmailClientFactory(configStore);
                break;
            default:
                throw new Error(`Email service '${service}' not yet implemented.`);
        }
        return await factory.getInstance();
    }
}

module.exports = { Cli };
