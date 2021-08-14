const readline = require('readline');
const open = require('open');

const { google, gmail_v1 } = require('googleapis');
const { ConfigStore } = require('../store/config-store');
const { OAuth2Client } = require('google-auth-library');
const { Email, EmailClient, EmailClientFactory } = require('./email-client');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const FILE_TOKEN = 'gmail.token.json';
// The file credentials.json stores the google api credentials.
const FILE_CREDENTIALS = 'gmail.credentials.json';

/**
 * A Gmail client to get unread emails from mailbox.
 */
class GmailClient extends EmailClient {
    /**
     * Constructs the {GmailClient} instance.
     * 
     * @param {gmail_v1.Gmail} gmail An instance of gmail client.
     */
    constructor(gmail) {
        super();
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
        } catch (err) {
            throw new Error(`Failed to delete messages: ${err}`);
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
        email.body = this._getBody(message?.data?.payload);
        return email;
    }

    /**
     * Reads the body of the message.
     *
     * @param {gmail_v1.Schema$Message} message The message.
     * @returns {string} The body.
     */
    _getBody(payload) {
        if (payload?.body?.size > 0) {
            return this._decode(payload.body.data);
        }

        if (payload?.parts?.length > 0) {
            return payload.parts
                .reduce((prev, curr) => {
                    return prev + this._getBody(curr);
                }, '');
        }

        return '';
    }

    /**
     * Decodes the base64 encoded string.
     * 
     * @param {string} encodedText Base64 encoded string.
     * @returns {string} The decoded string.
     */
    _decode(encodedText) {
        return Buffer.from(encodedText, 'base64').toString('utf-8');
    }

    /**
     * Gets the header from a message.
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
class GmailClientFactory extends EmailClientFactory {
    /**
     * Creates an instance of GmailClientFactory
     * 
     * @param {ConfigStore} configStore The configuration store.
     */
    constructor(configStore) {
        super();
        this.configStore = configStore;
    }

    /**
     * Creates an instance of GmailClient.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {GmailClient} The Gmail client. 
     */
    async getInstance(reconfig, launch) {
        var auth;
        try {
            let credentials = await this.configStore.getJson(FILE_CREDENTIALS);
            // Authorize a client with credentials, then call the Gmail API.
            auth = await this._authorize(credentials, reconfig, launch);
        } catch (err) {
            throw new Error(`Error creating client instance: ${err}`);
        }

        let gmail = google.gmail({ version: 'v1', auth: auth });
        return new GmailClient(gmail);
    }

    /**
     * Create an OAuth2 client with the given credentials.
     *
     * @param {Object} credentials The authorization client credentials.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {OAuth2Client} The authorization client.
     */
    async _authorize(credentials, reconfig, launch) {
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const auth = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);

        // Check if we have previously stored a token.
        let token = await this.configStore.getJson(FILE_TOKEN);
        if (token && !reconfig) {
            auth.setCredentials(token)
        }
        else {
            await this._createNewToken(auth, launch)
        }

        return auth
    }

    /**
     * Get and store new token after prompting for user authorization and 
     * returns the authorized OAuth2 client.
     * 
     * @param {google.auth.OAuth2} auth The OAuth2 client to get token for.
     * @param {boolean} launch Launch the auth url in the browser. 
     */
    async _createNewToken(auth, launch) {
        const authUrl = auth.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });

        if (launch) {
            console.log('Please authorize this app by logging into newly opened window');
            open(authUrl);
        }
        else {
            console.log('Please authorize this app by visiting this url:', authUrl);
        }

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
        await this.configStore.putJson(FILE_TOKEN, tokens);
    }

}

module.exports = { GmailClient, GmailClientFactory };