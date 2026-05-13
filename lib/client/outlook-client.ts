import open from 'open';

import axios, { type AxiosRequestConfig } from 'axios';
import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import type { AccountInfo, AuthenticationResult, ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { Email, EmailClient, EmailClientFactory } from './email-client.js';
import { retry } from '../utils/retry.js';
import type { ConfigStore } from '../store/config-store.js';

// If modifying these scopes, delete token.json.
const SCOPES = ["mail.readwrite"];

interface OutlookFileNames {
    tokenFile: string;
    credentialsFile: string;
}

interface OutlookCredentials {
    client_id: string;
    aad_endpoint: string;
    tenant_id: string;
    graph_endpoint: string;
}

interface OutlookFolder {
    id: string;
    displayName: string;
}

interface OutlookMessage {
    id: string;
    subject: string;
    body?: { content: string };
    bodyPreview: string;
    categories: string[];
    from?: { emailAddress?: { name?: string; address?: string } };
    parentFolderId: string;
    receivedDateTime?: string;
}

/**
 * Returns the credential and token file names for an account.
 * Default account uses the original file names for backward compatibility.
 */
function getOutlookFileNames(account: string): OutlookFileNames {
    if (!account || account === 'default') {
        return {
            tokenFile: 'outlook.token.json',
            credentialsFile: 'outlook.credentials.json'
        };
    }
    return {
        tokenFile: `outlook.token.${account}.json`,
        credentialsFile: `outlook.credentials.${account}.json`
    };
}

// The api path for getting folders.
const API_PATH_GET_FOLDERS = 'v1.0/me/mailFolders?$select=id,displayName';
// The api path for getting messages.
const API_PATH_GET_MESSAGES = 'v1.0/me/messages?$select=subject,body,bodyPreview,categories,from,parentFolderId&$filter=isRead eq false';
// The api path for getting a single message.
const API_PATH_GET_MESSAGE = 'v1.0/me/messages';

/**
 * A cache plugin for Msal Client.
 */
class CachePlugin implements ICachePlugin {
    private _configStore: ConfigStore;
    private _tokenFile: string;

    /**
     * Constructs the {CachePlugin} instance.
     */
    constructor(configStore: ConfigStore, tokenFile: string) {
        this._configStore = configStore;
        this._tokenFile = tokenFile;
    }

    async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
        const data = await this._configStore.get(this._tokenFile) as string | null;
        if (data) {
            cacheContext.tokenCache.deserialize(data);
        }
        else {
            await this._configStore.put(this._tokenFile,
                cacheContext.tokenCache.serialize());
        }
    }

    async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
        if (cacheContext.cacheHasChanged) {
            await this._configStore.put(this._tokenFile,
                cacheContext.tokenCache.serialize());
        }
    }
}

/**
 * An Outlook client to get unread emails from mailbox.
 */
class OutlookClient extends EmailClient {
    private _graphEndpoint: string;
    private _accessToken: string;

    /**
     * Constructs the {OutlookClient} instance.
     */
    constructor(graphEndpoint: string, accessToken: string) {
        super();
        this._graphEndpoint = graphEndpoint;
        this._accessToken = accessToken;
    }

    /**
     * Gets the unread emails from the mailbox.
     */
    async getUnreadEmails(since?: Date): Promise<Email[]> {
        const getFoldersPath = `${this._graphEndpoint}${API_PATH_GET_FOLDERS}`;
        let response = await this._callApi('get', getFoldersPath, this._accessToken);
        const folderMap = (response.value as OutlookFolder[]).reduce<Record<string, string>>((map, folder) => {
            map[folder.id] = folder.displayName;
            return map;
        }, {});

        let getEmailsPath = `${this._graphEndpoint}${API_PATH_GET_MESSAGES}`;
        if (since) {
            getEmailsPath += ` and receivedDateTime ge ${since.toISOString()}`;
        }
        response = await this._callApi('get', getEmailsPath, this._accessToken);
        const emails = (response.value as OutlookMessage[]).map(message => this._parseMessage(message, folderMap));
        return emails;
    }

    /**
     * Deletes the emails.
     */
    async deleteEmails(emails: Email[]): Promise<void> {
        try {
            for (const email of emails) {
                const deleteEmailPath = `${this._graphEndpoint}${API_PATH_GET_MESSAGE}/${email.id}`;
                await this._callApi('delete', deleteEmailPath, this._accessToken);
            }
        } catch (err) {
            throw new Error(`Failed to delete messages: ${err}`);
        }
    }

    /**
     * Archives emails by moving them to the Archive folder.
     */
    async archiveEmails(emails: Email[]): Promise<void> {
        try {
            for (const email of emails) {
                const movePath = `${this._graphEndpoint}${API_PATH_GET_MESSAGE}/${email.id}/move`;
                await this._callApi('post', movePath, this._accessToken,
                    { destinationId: 'archive' });
            }
        } catch (err) {
            throw new Error(`Failed to archive messages: ${err}`);
        }
    }

    /**
     * Marks emails as read.
     */
    async markAsReadEmails(emails: Email[]): Promise<void> {
        try {
            for (const email of emails) {
                const patchPath = `${this._graphEndpoint}${API_PATH_GET_MESSAGE}/${email.id}`;
                await this._callApi('patch', patchPath, this._accessToken,
                    { isRead: true });
            }
        } catch (err) {
            throw new Error(`Failed to mark messages as read: ${err}`);
        }
    }

    /**
     * Restores emails by moving them back to inbox.
     */
    async restoreEmails(emailIds: string[]): Promise<void> {
        try {
            for (const id of emailIds) {
                const movePath = `${this._graphEndpoint}${API_PATH_GET_MESSAGE}/${id}/move`;
                await this._callApi('post', movePath, this._accessToken,
                    { destinationId: 'inbox' });
            }
        } catch (err) {
            throw new Error(`Failed to restore emails: ${err}`);
        }
    }

    /**
     * Converts the message object to email object.
     */
    private _parseMessage(message: OutlookMessage, folderMap: Record<string, string>): Email {
        const email = new Email();
        email.id = message.id;
        email.labels = [folderMap[message.parentFolderId]].filter(Boolean) as string[];
        email.snippet = message.bodyPreview;
        email.subject = message.subject;
        email.from = this._formatEmail(message?.from?.emailAddress?.name,
            message?.from?.emailAddress?.address);
        email.body = message?.body?.content ?? '';
        email.date = message.receivedDateTime ? new Date(message.receivedDateTime) : null;
        return email;
    }

    private _formatEmail(name: string | undefined, emailAddr: string | undefined): string {
        return `${name} <${emailAddr}>`;
    }

    /**
     * Calls the endpoint with authorization bearer token.
     */
    private async _callApi(op: string, endpoint: string, accessToken: string, data?: object): Promise<{ value: unknown[] }> {
        const options: AxiosRequestConfig = {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        };

        const response = await retry(async () => {
            if (data && (op === 'post' || op === 'patch')) {
                return (axios as unknown as Record<string, Function>)[op]!(endpoint, data, options);
            }
            return (axios as unknown as Record<string, Function>)[op]!(endpoint, options);
        });
        return response.data;
    }
}

/**
 * Factory for OutlookClient objects.
 */
class OutlookClientFactory extends EmailClientFactory {
    configStore: ConfigStore;
    private _tokenFile: string;
    private _credentialsFile: string;

    /**
     * Creates an instance of OutlookClientFactory.
     */
    constructor(configStore: ConfigStore, account: string) {
        super();
        this.configStore = configStore;
        const fileNames = getOutlookFileNames(account);
        this._tokenFile = fileNames.tokenFile;
        this._credentialsFile = fileNames.credentialsFile;
    }

    /**
     * Creates an instance of OutlookClient.
     */
    async getInstance(reconfig: boolean, launch: boolean): Promise<OutlookClient> {
        let accessToken: string;
        let credentials: OutlookCredentials;
        try {
            credentials = await this.configStore.getJson(this._credentialsFile) as OutlookCredentials;
            // Authorize a client with credentials, then call the Outlook API.
            accessToken = await this._authorize(credentials, reconfig, launch);
        } catch (err) {
            throw new Error(`Error creating client instance: ${err}`);
        }

        return new OutlookClient(credentials.graph_endpoint, accessToken);
    }

    /**
     * Create an OAuth2 client with the given credentials.
     */
    private async _authorize(credentials: OutlookCredentials, reconfig: boolean, launch: boolean): Promise<string> {
        const pca = this._createPublicClientApp(credentials);
        const response = reconfig ?
            await this._getToken(pca, launch) :
            await this._getSilentToken(pca, launch);
        return response!.accessToken;
    }

    /**
     * Acquires token silently using the cache.
     */
    private async _getSilentToken(pca: PublicClientApplication, launch: boolean): Promise<AuthenticationResult | null> {
        const tokenCache = pca.getTokenCache();
        const accounts: AccountInfo[] = await tokenCache.getAllAccounts();

        if (accounts.length === 0) {
            return await this._getToken(pca, launch);
        }

        const silentRequest = {
            scopes: SCOPES,
            account: accounts[0]!
        };

        return pca.acquireTokenSilent(silentRequest)
            .catch((err: unknown) => {
                if (err instanceof InteractionRequiredAuthError) {
                    return this._getToken(pca, launch);
                }
                else {
                    throw err;
                }
            });
    }

    /**
     * Acquires token with device code flow.
     */
    private _getToken(pca: PublicClientApplication, launch?: boolean): Promise<AuthenticationResult | null> {
        const deviceCodeRequest = {
            scopes: SCOPES,
            deviceCodeCallback: (response: { userCode: string; verificationUri: string; message: string }) => {
                if (launch) {
                    console.log(`Please authorize this app by entering '${response.userCode}' in the newly opened window`);
                    open(response.verificationUri);
                }
                else {
                    console.log(response.message);
                }
            }
        };

        return pca.acquireTokenByDeviceCode(deviceCodeRequest);
    }

    /**
     * Creates an instance of {PublicClientApplication}.
     */
    private _createPublicClientApp(credentials: OutlookCredentials): PublicClientApplication {
        const cachePlugin = new CachePlugin(this.configStore, this._tokenFile);

        /**
        * Configuration object to be passed to MSAL instance on creation.
        * For a full list of MSAL Node configuration parameters, visit:
        * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/configuration.md
        */
        const msalConfig = {
            auth: {
                clientId: credentials.client_id,
                authority: credentials.aad_endpoint + credentials.tenant_id,
            },
            cache: {
                cachePlugin: {
                    beforeCacheAccess: (ctx: TokenCacheContext) => cachePlugin.beforeCacheAccess(ctx),
                    afterCacheAccess: (ctx: TokenCacheContext) => cachePlugin.afterCacheAccess(ctx)
                }
            },
        };

        return new PublicClientApplication(msalConfig);
    }
}

export { OutlookClient, OutlookClientFactory };
