const { TrashCleanerFactory } = require('./trash-cleaner');

/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.main = (req, res) => {
    main().then(() => {
        res.status(200).send("ok");
    }).catch(() => {
        res.status(500).send("error");
    });
};

/**
 * Entry point of the program encapsulated in a function to allow usage of await.
 */
async function main() {
    let trashCleaner = await new TrashCleanerFactory().getInstance();
    await trashCleaner.cleanTrash();
}

const isRunningInGoogleCloud = !!process.env.GCP_PROJECT
if (!isRunningInGoogleCloud) {
    main().catch(err => {
        console.error("An error occurred:", err);
    });
}
