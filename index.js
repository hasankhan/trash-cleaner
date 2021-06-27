const diacriticLess = require('diacriticless');
const fs = require('fs');
const path = require('path');

const { Email, GmailClient, GmailClientFactory } = require('./gmail-client');

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
    let keywords = readKeywords();
    let emails = await findTrashEmails(client, keywords);
    if (emails.length == 0) {
        console.log("No trash messages found!");
        return;
    }

    await client.deleteEmails(emails);
}

/**
 * Read the list of keywords and their labels for trash search.
 * 
 * @returns {[Object]} List of keywords and their labels for trash search.
 */
function readKeywords() {
    return JSON.parse(fs.readFileSync(PATH_KEYWORDS)).map(k => ({
        regex: new RegExp(k.val, 'gi'),
        labels: k.labels.map(l => l.toLowerCase())
    }));
}

/**
 * Finds trash emails in the mailbox.
 *
 * @param {GmailClient} client An instance of Gmail client.
 * @param {string[]} keywords The list of keywords to look for in the messages.
 * @returns {string[]} The list of trash message ids.
 */
async function findTrashEmails(client, keywords) {
    let emails;

    try {
        emails = await client.getUnreadEmails();
    } catch (err) {
        console.error("Failed to get unread emails: ", err);
    }

    let trashEmails = emails.map(normalizeEmail)
        .filter(email => isTrashEmail(email, keywords));

    for (email of trashEmails) {
        logEmail(email);
    }

    return trashEmails;
}

/**
 * Logs the key properties of an email to the console.
 * 
 * @param {Email} email The email to log. 
 */
function logEmail(email) {
    console.log(`From: ${email.from}`);
    console.log(`Labels: ${email.labels}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Snippet: ${email.snippet}`);
    console.log(`Body: ${email.body}`);
    console.log('-'.repeat(60));
}

/**
 * Checks if a message is trash according to keywords list.
 * 
 * @param {Email} email The email to check.
 * @param {string[]} keywords The list of keywords to look for in the message.
 * @returns {boolean} True if the message is trash, False otherwise.
 */
function isTrashEmail(email, keywords) {
    for (keyword of keywords) {
        if (isTrashKeywordMatch(email, keyword)) {
            return true;
        }
    }

    return false;
}

/**
 * Checks if a message is trash according to given keyword.
 * 
 * @param {gmail_v1.Schema$Message} message The message to check.
 * @param {string} keyword The keyword to look for in the message.
 * @returns {boolean} True if the message is trash, False otherwise.
 */
function isTrashKeywordMatch(message, keyword) {
    let found = keyword.regex.test(message.snippet) ||
        keyword.regex.test(message.subject) ||
        keyword.regex.test(message.from) ||
        keyword.regex.test(message.body);
    if (!found) {
        return false;
    }

    for (label of keyword.labels) {
        if (label == "*" || message.labels.includes(label)) {
            return true;
        }
    }

    return false;
}

/**
 * Normalizes email object fields for keyword matching.
 *
 * @param {Email} email The email object to normalize.
 * @returns {Email} The same email object as input after normalization.
 */
function normalizeEmail(email) {
    email.labels = email.labels.map(l => l.toLowerCase());
    email.snippet = diacriticLess(email.snippet);
    email.subject = diacriticLess(email.subject);
    email.from = diacriticLess(email.from);
    email.body = diacriticLess(email.body);

    return email;
}

const isRunningInGoogleCloud = !!process.env.GCP_PROJECT
if (!isRunningInGoogleCloud) {
    main().catch(err => {
        // error already written to console, ignore.
    });
}
