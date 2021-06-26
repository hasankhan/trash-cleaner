const fs = require('fs');
const path = require('path');
const readline = require('readline');
const util = require('util')

const { google, gmail_v1 } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const PATH_TOKEN = path.join(__dirname, 'token.json');
// The file credentials.json stores the google api credentials.
const PATH_CREDENTIALS = path.join(__dirname, 'credentials.json');
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
    var oAuth2Client;
    try {
        let content = fs.readFileSync(PATH_CREDENTIALS);
        // Authorize a client with credentials, then call the Gmail API.
        oAuthClient = await authorize(JSON.parse(content));
    } catch (err) {
        console.error('Error loading client secret file: ', err);
        throw err;
    }

    let gmail = google.gmail({ version: 'v1', auth: oAuthClient });
    let keywords = readKeywords();
    let messageIds = await findTrashMessages(gmail, keywords);
    if (messageIds.length == 0) {
        console.log("No trash messages found!");
        return;
    }

    await deleteMessages(gmail, messageIds);
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
 * Deletes the messages specified by message ids.
 * 
 * @param {gmail_v1.Gmail} gmail An instance of Gmail client.
 * @param {string[]} messageIds List of message ids to delete.
 */
async function deleteMessages(gmail, messageIds) {
    try {
        await gmail.users.messages.batchDelete({
            userId: 'me',
            ids: messageIds
        });
        console.log("Successfully deleted trash messages.");
    } catch (err) {
        console.error('Failed to delete messages: ', err);
        throw err;
    }
}

/**
 * Create an OAuth2 client with the given credentials
 * @param {Object} credentials The authorization client credentials.
 * @returns {OAuth2Client} The authorization client.
 */
async function authorize(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuthClient = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    try {
        let token = fs.readFileSync(PATH_TOKEN);
        oAuthClient.setCredentials(JSON.parse(token));
    } catch (err) {
        await getNewToken(oAuthClient)
    }
    return oAuthClient
}

/**
 * Get and store new token after prompting for user authorization and returns the 
 * authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 */
async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    let code = await util.promisify(rl.question)('Enter the code from that page here: ');
    rl.close();
    let token = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(token);
    // Store the token to disk for later program executions
    fs.writeFileSync(PATH_TOKEN, JSON.stringify(token))
    console.log(`Token stored to ${PATH_TOKEN}.`);
}

/**
 * Finds trash emails in the mailbox.
 *
 * @param {gmail_v1.Gmail} gmail An instance of Gmail client.
 * @param {string[]} keywords The list of keywords to look for in the messages.
 * @returns {string[]} The list of trash message ids.
 */
async function findTrashMessages(gmail, keywords) {
    let res = await gmail.users.messages.list({
        userId: 'me',
        labelIds: 'UNREAD',
        includeSpamTrash: 'true',
    });
    if (!res.data.messages) {
        return [];
    }

    let messageIds = [];
    for (message of res.data.messages) {
        let msg = await getMessage(gmail.users.messages, message.id);
        if (isTrashMessage(msg, keywords)) {
            messageIds.push(message.id);
            logMessage(msg);
        }
    }

    return messageIds;
}

/**
 * Logs the key properties of a message to the console.
 * 
 * @param {gmail_v1.Schema$Message} message The message to log. 
 */
function logMessage(message) {
    console.log(`From: ${message.from}`);
    console.log(`Labels: ${message.labels}`);
    console.log(`Subject: ${message.subject}`);
    console.log(`Snippet: ${message.snippet}`);
    console.log(`Body: ${message.body}`);
    console.log('-'.repeat(60));
}

/**
 * Checks if a message is trash according to keywords list.
 * 
 * @param {gmail_v1.Schema$Message} message The message to check.
 * @param {string[]} keywords The list of keywords to look for in the message.
 * @returns {boolean} True if the message is trash, False otherwise.
 */
function isTrashMessage(message, keywords) {
    for (keyword of keywords) {
        if (isTrashKeywordMatch(message, keyword)) {
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
 * Gets the message from the user's account.
 *
 * @param {gmail_v1.Resource$Users$Messages} messages The messages resource.
 * @param {string} id The message id.
 */
async function getMessage(messages, id) {
    let message = await messages.get({
        userId: 'me',
        id: id
    });

    return {
        labels: message.data.labelIds.map(l => l.toLowerCase()),
        snippet: message.data.snippet,
        subject: getHeader(message, 'Subject'),
        from: getHeader(message, 'From'),
        body: getBody(message),
    }
}

/**
 * Reads the body of the message.
 *
 * @param {gmail_v1.Schema$Message} message The message.
 * @returns {string} The body.
 */
function getBody(message) {
    if (!message.data.payload.body.data) return '';
    return Buffer.from(message.data.payload.body.data, 'base64').toString('utf-8');
}

/**
 * Gets the header from a message
 * 
 * @param {gmail_v1.Schema$Message} message The message.
 * @param {string} name The name of header to read.
 */
function getHeader(message, name) {
    return message.data.payload.headers.find(header => header.name == name).value
}

const isRunningInGoogleCloud = !!process.env.GCP_PROJECT
if (!isRunningInGoogleCloud) {
    main().catch(err => {
        // error already written to console, ignore.
    });
}
