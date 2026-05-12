import readline from 'readline';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Email, EmailClient, EmailClientFactory } from './email-client.js';
import { retry } from '../utils/retry.js';

/** @typedef {import('../store/config-store.js').ConfigStore} ConfigStore */

const DEFAULT_ARCHIVE_FOLDER = 'Archive';

/**
 * Returns the credential file name for an account.
 * Default account uses the original file name for backward compatibility.
 *
 * @param {string} account The account name.
 * @returns {{ credentialsFile: string }}
 */
function getImapFileNames(account) {
    if (!account || account === 'default') {
        return { credentialsFile: 'imap.credentials.json' };
    }
    return { credentialsFile: `imap.credentials.${account}.json` };
}

/**
 * An IMAP client to get unread emails from mailbox.
 */
class ImapClient extends EmailClient {
    /**
     * Constructs the {ImapClient} instance.
     *
     * @param {object} connectionConfig The IMAP connection config.
     * @param {string} connectionConfig.host The IMAP server host.
     * @param {number} connectionConfig.port The IMAP server port.
     * @param {object} connectionConfig.auth The auth credentials.
     * @param {string} connectionConfig.auth.user The username.
     * @param {string} connectionConfig.auth.pass The password.
     * @param {boolean} connectionConfig.secure Whether to use TLS.
     * @param {string} [archiveFolder] The folder to archive messages to.
     */
    constructor(connectionConfig, archiveFolder) {
        super();
        this._connectionConfig = connectionConfig;
        this._archiveFolder = archiveFolder || DEFAULT_ARCHIVE_FOLDER;
    }

    /**
     * Gets the unread emails from the mailbox.
     *
     * @param {Date} [since] Optional date to only fetch emails received after.
     * @returns {Promise<Email[]>} A list of unread emails.
     */
    async getUnreadEmails(since) {
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            const folders = await this._listFolders(client);
            const allEmails = [];

            for (const folder of folders) {
                const emails = await this._getUnreadFromFolder(client, folder, since);
                allEmails.push(...emails);
            }

            return allEmails;
        } finally {
            await client.logout();
        }
    }

    /**
     * Lists all scannable mailbox folders.
     *
     * @param {ImapFlow} client The IMAP client.
     * @returns {Promise<string[]>} List of folder paths.
     */
    async _listFolders(client) {
        const list = await client.list();
        const folders = [];
        for (const mailbox of list) {
            // Skip folders that can't be selected (e.g. [Gmail] parent)
            if (mailbox.flags?.has('\\Noselect')) {
                continue;
            }
            // Skip Sent, Drafts, and All Mail to avoid noise
            if (mailbox.specialUse === '\\Sent' ||
                mailbox.specialUse === '\\Drafts' ||
                mailbox.specialUse === '\\All') {
                continue;
            }
            folders.push(mailbox.path);
        }
        return folders;
    }

    /**
     * Gets unread emails from a specific folder.
     *
     * @param {ImapFlow} client The IMAP client.
     * @param {string} folder The folder path.
     * @param {Date} [since] Optional date to only fetch emails received after.
     * @returns {Promise<Email[]>} List of unread emails.
     */
    async _getUnreadFromFolder(client, folder, since) {
        let lock;
        try {
            lock = await client.getMailboxLock(folder);
        } catch {
            return [];
        }
        try {
            const searchCriteria = { seen: false };
            if (since) {
                searchCriteria.since = since;
            }
            const uids = await client.search(searchCriteria, { uid: true });
            if (!uids || uids.length === 0) {
                return [];
            }

            const emails = [];
            for await (const msg of client.fetch({ uid: uids }, {
                envelope: true,
                source: true,
                uid: true
            })) {
                const parsed = await simpleParser(msg.source);
                const email = new Email();
                email.id = String(msg.uid);
                email.subject = parsed.subject || '';
                email.from = parsed.from ? parsed.from.text : '';
                email.body = parsed.text || '';
                email.snippet = (parsed.text || '').substring(0, 200);
                email.date = parsed.date || null;
                email.labels = this._extractLabels(msg, folder);
                email._folder = folder;
                emails.push(email);
            }

            return emails;
        } finally {
            lock.release();
        }
    }

    /**
     * Deletes the emails.
     *
     * @param {Email[]} emails A list of emails to delete.
     */
    async deleteEmails(emails) {
        const byFolder = this._groupByFolder(emails);
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            for (const [folder, folderEmails] of byFolder) {
                const uids = folderEmails.map(e => Number(e.id));
                const lock = await client.getMailboxLock(folder);
                try {
                    await retry(() => client.messageDelete(uids, { uid: true }));
                } finally {
                    lock.release();
                }
            }
        } catch (err) {
            throw new Error(`Failed to delete messages: ${err}`);
        } finally {
            await client.logout();
        }
    }

    /**
     * Archives emails by moving them to the archive folder.
     *
     * @param {Email[]} emails A list of emails to archive.
     */
    async archiveEmails(emails) {
        const byFolder = this._groupByFolder(emails);
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            for (const [folder, folderEmails] of byFolder) {
                const uids = folderEmails.map(e => Number(e.id));
                const lock = await client.getMailboxLock(folder);
                try {
                    await retry(() => client.messageMove(uids, this._archiveFolder, { uid: true }));
                } finally {
                    lock.release();
                }
            }
        } catch (err) {
            throw new Error(`Failed to archive messages: ${err}`);
        } finally {
            await client.logout();
        }
    }

    /**
     * Marks emails as read by adding the \\Seen flag.
     *
     * @param {Email[]} emails A list of emails to mark as read.
     */
    async markAsReadEmails(emails) {
        const byFolder = this._groupByFolder(emails);
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            for (const [folder, folderEmails] of byFolder) {
                const uids = folderEmails.map(e => Number(e.id));
                const lock = await client.getMailboxLock(folder);
                try {
                    await retry(() => client.messageFlagsAdd(uids, ['\\Seen'], { uid: true }));
                } finally {
                    lock.release();
                }
            }
        } catch (err) {
            throw new Error(`Failed to mark messages as read: ${err}`);
        } finally {
            await client.logout();
        }
    }

    /**
     * Restores previously processed emails. Not supported in IMAP mode.
     *
     * @param {string[]} _emailIds A list of email IDs to restore.
     */
    async restoreEmails(_emailIds) {
        throw new Error(
            'Undo is not supported in IMAP mode. Deleted messages cannot be restored via IMAP. ' +
            'Use --service gmail or --service outlook for undo support.'
        );
    }

    /**
     * Extracts labels from IMAP message flags and folder name.
     *
     * @param {object} msg The IMAP message object.
     * @param {string} folder The mailbox folder path.
     * @returns {string[]} The extracted labels.
     */
    _extractLabels(msg, folder) {
        const labels = [];
        if (msg.flags) {
            for (const flag of msg.flags) {
                if (flag === '\\Flagged') {
                    labels.push('flagged');
                } else if (flag === '\\Seen') {
                    labels.push('read');
                } else if (flag === '\\Answered') {
                    labels.push('answered');
                } else if (flag === '\\Draft') {
                    labels.push('draft');
                }
            }
        }
        // Map folder path to a label
        const folderLower = folder.toLowerCase();
        if (folderLower === 'inbox') {
            labels.push('inbox');
        } else if (folderLower.includes('spam') || folderLower.includes('junk')) {
            labels.push('spam');
        } else if (folderLower.includes('trash') || folderLower.includes('deleted')) {
            labels.push('trash');
        } else if (folderLower.includes('sent')) {
            labels.push('sent');
        } else {
            labels.push(folderLower);
        }
        return labels;
    }

    /**
     * Groups emails by their folder.
     *
     * @param {Email[]} emails The emails to group.
     * @returns {Map<string, Email[]>} Map of folder to emails.
     */
    _groupByFolder(emails) {
        const map = new Map();
        for (const email of emails) {
            const folder = email._folder || 'INBOX';
            if (!map.has(folder)) {
                map.set(folder, []);
            }
            map.get(folder).push(email);
        }
        return map;
    }

    /**
     * Creates a new ImapFlow client instance.
     *
     * @returns {ImapFlow} The IMAP client.
     */
    _createClient() {
        return new ImapFlow({
            ...this._connectionConfig,
            logger: false
        });
    }
}

/**
 * Factory for ImapClient objects.
 */
class ImapClientFactory extends EmailClientFactory {
    /**
     * Creates an instance of ImapClientFactory.
     *
     * @param {ConfigStore} configStore The configuration store.
     * @param {string} account The account name.
     */
    constructor(configStore, account) {
        super();
        this.configStore = configStore;
        const fileNames = getImapFileNames(account);
        this._credentialsFile = fileNames.credentialsFile;
    }

    /**
     * Creates an instance of ImapClient.
     *
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} _launch Not used for IMAP.
     * @returns {Promise<ImapClient>} The IMAP client.
     */
    async getInstance(reconfig, _launch) {
        let credentials;
        try {
            credentials = await this.configStore.getJson(this._credentialsFile);
        } catch {
            credentials = null;
        }

        if (reconfig || !credentials) {
            credentials = await this._promptCredentials();
            await this.configStore.putJson(this._credentialsFile, credentials);
        }

        const connectionConfig = {
            host: credentials.host,
            port: credentials.port || 993,
            secure: credentials.secure !== false,
            auth: {
                user: credentials.user,
                pass: credentials.password
            }
        };

        return new ImapClient(connectionConfig, credentials.archiveFolder);
    }

    /**
     * Prompts the user interactively for IMAP credentials.
     *
     * @returns {Promise<object>} The credentials object.
     */
    async _promptCredentials() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const ask = (question) => new Promise(resolve =>
            rl.question(question, resolve));

        try {
            const host = await ask('IMAP host (e.g., imap.gmail.com): ');
            const port = await ask('IMAP port (default: 993): ');
            const user = await ask('Email address: ');
            const password = await ask('App password: ');
            const archiveFolder = await ask('Archive folder (default: Archive): ');

            return {
                host,
                port: parseInt(port) || 993,
                user,
                password,
                archiveFolder: archiveFolder || undefined
            };
        } finally {
            rl.close();
        }
    }
}

export { ImapClient, ImapClientFactory };
