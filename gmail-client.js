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

class Email {
    id = '';
    labels = [];
    snippet = '';
    subject = '';
    from = '';
    body = '';
}

/**
 * A Gmail client to get unread emails from mailbox. 
 */
class GmailClient {
    _gmail = null;

    /**
     * Constructs the GmailClient instance.
     * 
     * @param {gmail_v1.Gmail} gmail An instance of gmail client.
     */
    constructor(gmail) {
        this._gmail = gmail;
    }

    /**
     * Gets the unread emails from the mailbox.
     * 
     * @returns {Email[]} A list of unread emails.
     */
    async getUnreadEmails() {
        let res = await this._gmail.users.messages.list({
            userId: 'me',
            labelIds: 'UNREAD',
            includeSpamTrash: 'true',
        });
        if (!res.data.messages) {
            return [];
        }

        let emails = [];
        for (let message of res.data.messages) {
            let email = await this._getEmail(message.id);
            emails.push(email);
        }

        return emails;
    }

    /**
     * Deletes the emails.
     * 
     * @param {Email[]} emails A list of emails to delete.
     */
    async deleteEmails(emails) {
        let messageIds = emails.map(e => e.id);
        try {
            await this._gmail.users.messages.batchDelete({
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
     * Reads the email from the mailbox.
     * 
     * @param {string} messageId The id of the message. 
     * @returns {Email} The email object.
     */
    async _getEmail(messageId) {
        let msg = await this._gmail.users.messages.get({
            userId: 'me',
            id: messageId
        });
        let email = this._parseMessage(msg);
        return email;
    }

    /**
     * Converts the Gmail's message object to email object.
     *
     * @param {gmail_v1.Schema$Message} message The message object.
     * @returns {Email} The parsed email. 
     */
    _parseMessage(message) {
        var email = new Email();
        email.id = message.data.id;
        email.labels = message.data.labelIds;
        email.snippet = message.data.snippet;
        email.subject = this._getHeader(message, 'Subject');
        email.from = this._getHeader(message, 'From');
        email.body = this._getBody(message);
        return email;
    }

    /**
     * Reads the body of the message.
     *
     * @param {gmail_v1.Schema$Message} message The message.
     * @returns {string} The body.
     */
    _getBody(message) {
        if (!message.data.payload.body.data) return '';
        return Buffer.from(message.data.payload.body.data, 'base64')
            .toString('utf-8');
    }


    /**
     * Gets the header from a message
     * 
     * @param {gmail_v1.Schema$Message} message The message.
     * @param {string} name The name of header to read.
     * @returns {string} The value of header.
     */
    _getHeader(message, name) {
        return message.data.payload.headers
            .find(header => header.name == name)
            .value
    }
}

/**
 * Factory for GmailClient objects.
 */
class GmailClientFactory {
    /**
     * Creates an instance of GmailClient.
     * 
     * @returns {GmailClient} The Gmail client. 
     */
    async getClient() {
        var auth;
        try {
            let content = fs.readFileSync(PATH_CREDENTIALS);
            // Authorize a client with credentials, then call the Gmail API.
            auth = await this._authorize(JSON.parse(content));
        } catch (err) {
            console.error('Error loading client secret file: ', err);
            throw err;
        }

        let gmail = google.gmail({ version: 'v1', auth: auth });
        return new GmailClient(gmail);
    }

    /**
     * Create an OAuth2 client with the given credentials
     *
     * @param {Object} credentials The authorization client credentials.
     * @returns {OAuth2Client} The authorization client.
     */
    async _authorize(credentials) {
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const auth = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);

        // Check if we have previously stored a token.
        if (fs.existsSync(PATH_TOKEN)) {
            let token = fs.readFileSync(PATH_TOKEN);
            auth.setCredentials(JSON.parse(token))
        }
        else {
            await this._createNewToken(auth)
        }

        return auth
    }

    /**
     * Get and store new token after prompting for user authorization and 
     * returns the authorized OAuth2 client.
     * 
     * @param {google.auth.OAuth2} auth The OAuth2 client to get token for.
     */
     async _createNewToken(auth) {
        const authUrl = auth.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });
        console.log('Authorize this app by visiting this url:', authUrl);
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        let code = await new Promise(resolve =>
            rl.question('Enter the code from that page here: ', resolve));
        rl.close();

        let { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);
        // Store the token to disk for later program executions
        fs.writeFileSync(PATH_TOKEN, JSON.stringify(tokens))
    }

}

module.exports = { Email, GmailClient, GmailClientFactory };