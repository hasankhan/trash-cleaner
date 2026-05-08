const readline = require('readline');
const open = require('open');

const { google } = require('googleapis');
const { Email, EmailClient, EmailClientFactory } = require('./email-client');
// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/'];

/**
 * Returns the credential and token file names for an account.
 * Default account uses the original file names for backward compatibility.
 * 
 * @param {string} account The account name.
 * @returns {{ tokenFile: string, credentialsFile: string }}
 */
function getGmailFileNames(account) {
    if (!account || account === 'default') {
        return {
            tokenFile: 'gmail.token.json',
            credentialsFile: 'gmail.credentials.json'
        };
    }
    return {
        tokenFile: `gmail.token.${account}.json`,
        credentialsFile: `gmail.credentials.${account}.json`
    };
}

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
        const res = await this._gmail.users.messages.list({
            userId: 'me',
            labelIds: 'UNREAD',
            includeSpamTrash: 'true',
        });
        if (!res.data.messages) {
            return [];
        }

        const emails = [];
        for (const message of res.data.messages) {
            const email = await this._getEmail(message.id);
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
        const messageIds = emails.map(e => e.id);
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
     * Archives emails by removing the INBOX label.
     * 
     * @param {Email[]} emails A list of emails to archive.
     */
    async archiveEmails(emails) {
        try {
            const messageIds = emails.map(e => e.id);
            await this._gmail.users.messages.batchModify({
                userId: 'me',
                ids: messageIds,
                removeLabelIds: ['INBOX']
            });
        } catch (err) {
            throw new Error(`Failed to archive messages: ${err}`);
        }
    }

    /**
     * Marks emails as read by removing the UNREAD label.
     * 
     * @param {Email[]} emails A list of emails to mark as read.
     */
    async markAsReadEmails(emails) {
        try {
            const messageIds = emails.map(e => e.id);
            await this._gmail.users.messages.batchModify({
                userId: 'me',
                ids: messageIds,
                removeLabelIds: ['UNREAD']
            });
        } catch (err) {
            throw new Error(`Failed to mark messages as read: ${err}`);
        }
    }

    /**
     * Reads the email from the mailbox.
     *
     * @param {string} messageId The id of the message. 
     * @returns {Email} The email object.
     */
    async _getEmail(messageId) {
        const msg = await this._gmail.users.messages.get({
            userId: 'me',
            id: messageId
        });
        const email = this._parseMessage(msg);
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
        email.subject = this._getHeader(message, 'Subject') ?? '';
        email.from = this._getHeader(message, 'From') ?? '';
        email.body = this._getBody(message?.data?.payload) ?? '';
        return email;
    }

    /**
     * Reads the body of the message.
     *
     * @param {gmail_v1.Schema$Message} message The message.
     * @returns {string} The body.
     */
    _getBody(payload) {
        if (payload?.body?.data) {
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
        const header = message.data.payload.headers
            .find(header => header.name === name)
        return header?.value
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
     * @param {string} account The account name.
     */
    constructor(configStore, account) {
        super();
        this.configStore = configStore;
        const fileNames = getGmailFileNames(account);
        this._tokenFile = fileNames.tokenFile;
        this._credentialsFile = fileNames.credentialsFile;
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
            const credentials = await this.configStore.getJson(this._credentialsFile);
            // Authorize a client with credentials, then call the Gmail API.
            auth = await this._authorize(credentials, reconfig, launch);
        } catch (err) {
            throw new Error(`Error creating client instance: ${err}`);
        }

        const gmail = google.gmail({ version: 'v1', auth: auth });
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
        const token = await this.configStore.getJson(this._tokenFile);
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

        const code = await new Promise(resolve =>
            rl.question('Enter the code from that page here: ', resolve));
        rl.close();

        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);
        // Store the token to disk for later program executions
        await this.configStore.putJson(this._tokenFile, tokens);
    }

}

module.exports = { GmailClient, GmailClientFactory };