const fs = require('fs');
const path = require('path');

const { GmailClientFactory } = require('./gmail-client');
const { TrashCleaner } = require('./trash-cleaner');

// The file keywords.json stores the keywords and labels to use when finding
// trash email.
const PATH_KEYWORDS = path.join(__dirname, 'keywords.json');

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
    let client = await new GmailClientFactory().getClient();
    let keywords = JSON.parse(fs.readFileSync(PATH_KEYWORDS));
    let cleaner = new TrashCleaner(client, keywords);
    await cleaner.cleanTrash();
}

const isRunningInGoogleCloud = !!process.env.GCP_PROJECT
if (!isRunningInGoogleCloud) {
    main().catch(err => {
        console.error("An error occurred:", err);
    });
}
