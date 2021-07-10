const path = require('path');
const { FileSystemConfigStore } = require('./lib/store/file-system-config-store');
const { TrashCleanerFactory } = require('./lib/trash-cleaner');

const PATH_CONFIG = path.join(__dirname, 'config');

/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.main = (req, res) => {
    main(false /*cliMode*/).then(() => {
        res.status(200).send('ok');
    }).catch(() => {
        res.status(500).send('error');
    });
};

/**
 * Entry point of the program encapsulated in a function to allow usage of await.
 * 
 * @param {boolean} cliMode Indicates if an interactive CLI mode is on.
 */
async function main(cliMode) {
    let configStore = new FileSystemConfigStore(PATH_CONFIG);
    let trashCleanerFactory = new TrashCleanerFactory(configStore, cliMode);
    let trashCleaner = await trashCleanerFactory.getInstance();
    await trashCleaner.cleanTrash();
}

const isRunningInGoogleCloud = !!process.env.GCP_PROJECT
if (!isRunningInGoogleCloud) {
    main(true /*cliMode*/).catch(err => {
        console.error('An error occurred:', err);
    });
}
