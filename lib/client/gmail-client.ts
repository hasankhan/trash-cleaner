import readline from 'readline';
import open from 'open';

import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { Email, EmailClient, EmailClientFactory } from './email-client.js';
import { retry } from '../utils/retry.js';
import type { ConfigStore } from '../store/config-store.js';

// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/'];

interface GmailFileNames {
    tokenFile: string;
    credentialsFile: string;
}

interface GmailCredentials {
    installed: {
        client_secret: string;
        client_id: string;
        redirect_uris: string[];
    };
}

interface GmailMessagePayload {
    body?: { data?: string };
    parts?: GmailMessagePayload[];
    headers?: Array<{ name: string; value: string }>;
}

/**
 * Returns the credential and token file names for an account.
 * Default account uses the original file names for backward compatibility.
 */
function getGmailFileNames(account: string): GmailFileNames {
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
    private _gmail: gmail_v1.Gmail;

    /**
     * Constructs the {GmailClient} instance.
     */
    constructor(gmail: gmail_v1.Gmail) {
        super();
        this._gmail = gmail;
    }

    /**
     * Gets the unread emails from the mailbox.
     */
    async getUnreadEmails(since?: Date): Promise<Email[]> {
        const params: gmail_v1.Params$Resource$Users$Messages$List = {
            userId: 'me',
            labelIds: ['UNREAD'],
            includeSpamTrash: true,
        };
        if (since) {
            params.q = `after:${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;
        }
        const res = await retry(() => this._gmail.users.messages.list(params));
        if (!res.data.messages) {
            return [];
        }

        const emails: Email[] = [];
        for (const message of res.data.messages) {
            const email = await this._getEmail(message.id!);
            emails.push(email);
        }

        return emails;
    }

    /**
     * Deletes the emails.
     */
    async deleteEmails(emails: Email[]): Promise<void> {
        const messageIds = emails.map(e => e.id);
        try {
            await retry(() => this._gmail.users.messages.batchDelete({
                userId: 'me',
                requestBody: { ids: messageIds }
            }));
        } catch (err) {
            throw new Error(`Failed to delete messages: ${err}`);
        }
    }

    /**
     * Archives emails by removing the INBOX label.
     */
    async archiveEmails(emails: Email[]): Promise<void> {
        try {
            const messageIds = emails.map(e => e.id);
            await retry(() => this._gmail.users.messages.batchModify({
                userId: 'me',
                requestBody: {
                    ids: messageIds,
                    removeLabelIds: ['INBOX']
                }
            }));
        } catch (err) {
            throw new Error(`Failed to archive messages: ${err}`);
        }
    }

    /**
     * Marks emails as read by removing the UNREAD label.
     */
    async markAsReadEmails(emails: Email[]): Promise<void> {
        try {
            const messageIds = emails.map(e => e.id);
            await retry(() => this._gmail.users.messages.batchModify({
                userId: 'me',
                requestBody: {
                    ids: messageIds,
                    removeLabelIds: ['UNREAD']
                }
            }));
        } catch (err) {
            throw new Error(`Failed to mark messages as read: ${err}`);
        }
    }

    /**
     * Restores emails by moving them back to inbox (untrash + add INBOX label).
     */
    async restoreEmails(emailIds: string[]): Promise<void> {
        try {
            await retry(() => this._gmail.users.messages.batchModify({
                userId: 'me',
                requestBody: {
                    ids: emailIds,
                    addLabelIds: ['INBOX'],
                    removeLabelIds: ['TRASH']
                }
            }));
        } catch (err) {
            throw new Error(`Failed to restore emails: ${err}`);
        }
    }

    /**
     * Reads the email from the mailbox.
     */
    private async _getEmail(messageId: string): Promise<Email> {
        const msg = await retry(() => this._gmail.users.messages.get({
            userId: 'me',
            id: messageId
        }));
        const email = this._parseMessage(msg);
        return email;
    }

    /**
     * Converts the Gmail's message object to email object.
     */
    private _parseMessage(message: { data: gmail_v1.Schema$Message }): Email {
        const email = new Email();
        email.id = message.data.id ?? '';
        email.labels = message.data.labelIds ?? [];
        email.snippet = message.data.snippet ?? '';
        email.subject = this._getHeader(message, 'Subject') ?? '';
        email.from = this._getHeader(message, 'From') ?? '';
        email.body = this._getBody(message.data.payload as GmailMessagePayload | undefined) ?? '';
        const dateStr = this._getHeader(message, 'Date');
        email.date = dateStr ? new Date(dateStr) : null;
        return email;
    }

    /**
     * Reads the body of the message.
     */
    private _getBody(payload: GmailMessagePayload | undefined | null): string {
        if (payload?.body?.data) {
            return this._decode(payload.body.data);
        }

        if (payload?.parts && payload.parts.length > 0) {
            return payload.parts
                .reduce((prev: string, curr: GmailMessagePayload) => {
                    return prev + this._getBody(curr);
                }, '');
        }

        return '';
    }

    /**
     * Decodes the base64 encoded string.
     */
    private _decode(encodedText: string): string {
        return Buffer.from(encodedText, 'base64').toString('utf-8');
    }

    /**
     * Gets the header from a message.
     */
    private _getHeader(message: { data: gmail_v1.Schema$Message }, name: string): string | undefined {
        const header = message.data.payload?.headers
            ?.find(header => header.name === name);
        return header?.value ?? undefined;
    }
}

/**
 * Factory for GmailClient objects.
 */
class GmailClientFactory extends EmailClientFactory {
    configStore: ConfigStore;
    private _tokenFile: string;
    private _credentialsFile: string;

    /**
     * Creates an instance of GmailClientFactory.
     */
    constructor(configStore: ConfigStore, account: string) {
        super();
        this.configStore = configStore;
        const fileNames = getGmailFileNames(account);
        this._tokenFile = fileNames.tokenFile;
        this._credentialsFile = fileNames.credentialsFile;
    }

    /**
     * Creates an instance of GmailClient.
     */
    async getInstance(reconfig: boolean, launch: boolean): Promise<GmailClient> {
        let auth: OAuth2Client;
        try {
            const credentials = await this.configStore.getJson(this._credentialsFile) as GmailCredentials;
            // Authorize a client with credentials, then call the Gmail API.
            auth = await this._authorize(credentials, reconfig, launch);
        } catch (err) {
            throw new Error(`Error creating client instance: ${err}`);
        }

        const gmail = google.gmail({ version: 'v1', auth });
        return new GmailClient(gmail);
    }

    /**
     * Create an OAuth2 client with the given credentials.
     */
    private async _authorize(credentials: GmailCredentials, reconfig: boolean, launch: boolean): Promise<OAuth2Client> {
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const auth = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);

        // Check if we have previously stored a token.
        const token = await this.configStore.getJson(this._tokenFile);
        if (token && !reconfig) {
            auth.setCredentials(token as object);
        }
        else {
            await this._createNewToken(auth, launch);
        }

        return auth;
    }

    /**
     * Get and store new token after prompting for user authorization and
     * returns the authorized OAuth2 client.
     */
    private async _createNewToken(auth: OAuth2Client, launch: boolean): Promise<void> {
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

        const code = await new Promise<string>(resolve =>
            rl.question('Enter the code from that page here: ', resolve));
        rl.close();

        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);
        // Store the token to disk for later program executions
        await this.configStore.putJson(this._tokenFile, tokens);
    }

}

export { GmailClient, GmailClientFactory };
