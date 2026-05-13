import readline from 'readline';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Email, EmailClient, EmailClientFactory } from './email-client.js';
import { retry } from '../utils/retry.js';
import type { ConfigStore } from '../store/config-store.js';

const DEFAULT_ARCHIVE_FOLDER = 'Archive';

interface ImapFileNames {
    credentialsFile: string;
}

interface ImapConnectionAuth {
    user: string;
    pass: string;
}

interface ImapConnectionConfig {
    host: string;
    port: number;
    auth: ImapConnectionAuth;
    secure: boolean;
}

interface ImapCredentials {
    host: string;
    port?: number;
    secure?: boolean;
    user: string;
    password: string;
    archiveFolder?: string;
}

interface ImapMessage {
    uid: number;
    flags: Set<string>;
    source: Buffer;
    envelope?: unknown;
}

interface ImapMailbox {
    path: string;
    flags?: Set<string>;
    specialUse?: string;
}

/**
 * Returns the credential file name for an account.
 * Default account uses the original file name for backward compatibility.
 */
function getImapFileNames(account: string): ImapFileNames {
    if (!account || account === 'default') {
        return { credentialsFile: 'imap.credentials.json' };
    }
    return { credentialsFile: `imap.credentials.${account}.json` };
}

/**
 * An IMAP client to get unread emails from mailbox.
 */
class ImapClient extends EmailClient {
    private _connectionConfig: ImapConnectionConfig;
    private _archiveFolder: string;

    /**
     * Constructs the {ImapClient} instance.
     */
    constructor(connectionConfig: ImapConnectionConfig, archiveFolder?: string) {
        super();
        this._connectionConfig = connectionConfig;
        this._archiveFolder = archiveFolder || DEFAULT_ARCHIVE_FOLDER;
    }

    /**
     * Gets the unread emails from the mailbox.
     */
    async getUnreadEmails(since?: Date): Promise<Email[]> {
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            const folders = await this._listFolders(client);
            const allEmails: Email[] = [];

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
     */
    private async _listFolders(client: ImapFlow): Promise<string[]> {
        const list: ImapMailbox[] = await client.list() as ImapMailbox[];
        const folders: string[] = [];
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
     */
    private async _getUnreadFromFolder(client: ImapFlow, folder: string, since?: Date): Promise<Email[]> {
        let lock: { release: () => void };
        try {
            lock = await client.getMailboxLock(folder);
        } catch {
            return [];
        }
        try {
            const searchCriteria: { seen: boolean; since?: Date } = { seen: false };
            if (since) {
                searchCriteria.since = since;
            }
            const uids = await client.search(searchCriteria, { uid: true });
            if (!uids || uids.length === 0) {
                return [];
            }

            const emails: Email[] = [];
            const fetchIterator = client.fetch({ uid: uids } as unknown as string, {
                envelope: true,
                source: true,
                uid: true
            });
            for await (const msg of fetchIterator as AsyncIterable<ImapMessage>) {
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
     */
    async deleteEmails(emails: Email[]): Promise<void> {
        const byFolder = this._groupByFolder(emails);
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            for (const [folder, folderEmails] of byFolder) {
                const uids = folderEmails.map(e => Number(e.id));
                const lock = await client.getMailboxLock(folder);
                try {
                    await retry(() => client.messageDelete(uids as unknown as string, { uid: true }));
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
     */
    async archiveEmails(emails: Email[]): Promise<void> {
        const byFolder = this._groupByFolder(emails);
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            for (const [folder, folderEmails] of byFolder) {
                const uids = folderEmails.map(e => Number(e.id));
                const lock = await client.getMailboxLock(folder);
                try {
                    await retry(() => client.messageMove(uids as unknown as string, this._archiveFolder, { uid: true }));
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
     */
    async markAsReadEmails(emails: Email[]): Promise<void> {
        const byFolder = this._groupByFolder(emails);
        const client = this._createClient();
        await retry(() => client.connect());
        try {
            for (const [folder, folderEmails] of byFolder) {
                const uids = folderEmails.map(e => Number(e.id));
                const lock = await client.getMailboxLock(folder);
                try {
                    await retry(() => client.messageFlagsAdd(uids as unknown as string, ['\\Seen'], { uid: true }));
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
     */
    async restoreEmails(_emailIds: string[]): Promise<void> {
        throw new Error(
            'Undo is not supported in IMAP mode. Deleted messages cannot be restored via IMAP. ' +
            'Use --service gmail or --service outlook for undo support.'
        );
    }

    /**
     * Extracts labels from IMAP message flags and folder name.
     */
    private _extractLabels(msg: ImapMessage, folder: string): string[] {
        const labels: string[] = [];
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
     */
    private _groupByFolder(emails: Email[]): Map<string, Email[]> {
        const map = new Map<string, Email[]>();
        for (const email of emails) {
            const folder = email._folder || 'INBOX';
            if (!map.has(folder)) {
                map.set(folder, []);
            }
            map.get(folder)!.push(email);
        }
        return map;
    }

    /**
     * Creates a new ImapFlow client instance.
     */
    private _createClient(): ImapFlow {
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
    configStore: ConfigStore;
    private _credentialsFile: string;

    /**
     * Creates an instance of ImapClientFactory.
     */
    constructor(configStore: ConfigStore, account: string) {
        super();
        this.configStore = configStore;
        const fileNames = getImapFileNames(account);
        this._credentialsFile = fileNames.credentialsFile;
    }

    /**
     * Creates an instance of ImapClient.
     */
    async getInstance(reconfig: boolean, _launch: boolean): Promise<ImapClient> {
        let credentials: ImapCredentials | null;
        try {
            credentials = await this.configStore.getJson(this._credentialsFile) as ImapCredentials | null;
        } catch {
            credentials = null;
        }

        if (reconfig || !credentials) {
            credentials = await this._promptCredentials();
            await this.configStore.putJson(this._credentialsFile, credentials);
        }

        const connectionConfig: ImapConnectionConfig = {
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
     */
    private async _promptCredentials(): Promise<ImapCredentials> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const ask = (question: string): Promise<string> => new Promise(resolve =>
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
