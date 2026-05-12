import open from 'open';

import axios from 'axios';
import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import { Email, EmailClient, EmailClientFactory } from './email-client.js';
import { retry } from '../utils/retry.js';

/** @typedef {import('../store/config-store.js').ConfigStore} ConfigStore */

// If modifying these scopes, delete token.json.
const SCOPES = ["mail.readwrite"];

/**
 * Returns the credential and token file names for an account.
 * Default account uses the original file names for backward compatibility.
 * 
 * @param {string} account The account name.
 * @returns {{ tokenFile: string, credentialsFile: string }}
 */
function getOutlookFileNames(account) {
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
class CachePlugin {

    /**
     * Constructs the {CachePlugin} instance.
     * 
     * @param {ConfigStore} configStore The configuration store.
     * @param {string} tokenFile The token file name.
     */
    constructor(configStore, tokenFile) {
        this._configStore = configStore;
        this._tokenFile = tokenFile;
    }

    async beforeCacheAccess(cacheContext) {
        const data = await this._configStore.get(this._tokenFile);
        if (data) {
            cacheContext.tokenCache.deserialize(data);
        }
        else {
            await this._configStore.put(this._tokenFile,
                cacheContext.tokenCache.serialize());
        }
    }

    async afterCacheAccess(cacheContext) {
        if (cacheContext.cacheHasChanged) {
            await this._configStore.put(this._tokenFile,
                cacheContext.tokenCache.serialize());
        }
    };
}

/**
 * An Outlook client to get unread emails from mailbox.
 */
class OutlookClient extends EmailClient {
    /**
     * Constructs the {OutlookClient} instance.
     * 
     * @param {string} graphEndpoint The graph endpoint to use. 
     * @param {string} accessToken The accessToken to use.
     */
    constructor(graphEndpoint, accessToken) {
        super();
        this._graphEndpoint = graphEndpoint;
        this._accessToken = accessToken;
    }

    /**
     * Gets the unread emails from the mailbox.
     * 
     * @returns {Promise<Email[]>} A list of unread emails.
     */
    /**
     * Gets the unread emails from the mailbox.
     *
     * @param {Date} [since] Optional date to only fetch emails received after.
     * @returns {Promise<Email[]>} A list of unread emails.
     */
    async getUnreadEmails(since) {
        const getFoldersPath = `${this._graphEndpoint}${API_PATH_GET_FOLDERS}`;
        let response = await this._callApi('get', getFoldersPath, this._accessToken);
        const folderMap = response.value.reduce((map, folder) => {
            map[folder.id] = folder.displayName;
            return map;
        }, {});

        let getEmailsPath = `${this._graphEndpoint}${API_PATH_GET_MESSAGES}`;
        if (since) {
            getEmailsPath += ` and receivedDateTime ge ${since.toISOString()}`;
        }
        response = await this._callApi('get', getEmailsPath, this._accessToken);
        const emails = response.value.map(message => this._parseMessage(message, folderMap));
        return emails;
    }

    /**
     * Deletes the emails.
     * 
     * @param {Email[]} emails A list of emails to delete.
     */
    async deleteEmails(emails) {
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
     * 
     * @param {Email[]} emails A list of emails to archive.
     */
    async archiveEmails(emails) {
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
     * 
     * @param {Email[]} emails A list of emails to mark as read.
     */
    async markAsReadEmails(emails) {
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
     *
     * @param {string[]} emailIds The list of email IDs to restore.
     */
    async restoreEmails(emailIds) {
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
     *
     * @param {object} message The message object.
     * @param {object} folderMap The map of folder id to display name. 
     * @returns {Email} The parsed email. 
     */
    _parseMessage(message, folderMap) {
        var email = new Email();
        email.id = message.id;
        email.labels = [folderMap[message.parentFolderId]].filter(Boolean);
        email.snippet = message.bodyPreview;
        email.subject = message.subject;
        email.from = this._formatEmail(message?.from?.emailAddress?.name,
            message?.from?.emailAddress?.address);
        email.body = message?.body?.content;
        email.date = message.receivedDateTime ? new Date(message.receivedDateTime) : null;
        return email;
    }

    _formatEmail(name, email) {
        return `${name} <${email}>`;
    }

    /**
     * Calls the endpoint with authorization bearer token.
     * @param {string} op The HTTP method.
     * @param {string} endpoint The API endpoint.
     * @param {string} accessToken The access token.
     * @param {object} data Optional request body for POST/PATCH.
     */
    async _callApi(op, endpoint, accessToken, data) {

        const options = {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        };

        const response = await retry(async () => {
            if (data && (op === 'post' || op === 'patch')) {
                return axios[op](endpoint, data, options);
            }
            return axios[op](endpoint, options);
        });
        return response.data;
    };
}

/**
 * Factory for OutlookClient objects.
 */
class OutlookClientFactory extends EmailClientFactory {
    /**
     * Creates an instance of OutlookClientFactory
     * 
     * @param {ConfigStore} configStore The configuration store.
     * @param {string} account The account name.
     */
    constructor(configStore, account) {
        super();
        this.configStore = configStore;
        const fileNames = getOutlookFileNames(account);
        this._tokenFile = fileNames.tokenFile;
        this._credentialsFile = fileNames.credentialsFile;
    }

    /**
     * Creates an instance of OutlookClient.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {Promise<OutlookClient>} The Outlook client. 
     */
    async getInstance(reconfig, launch) {
        var accessToken;
        let credentials;
        try {
            credentials = await this.configStore.getJson(this._credentialsFile);
            // Authorize a client with credentials, then call the Gmail API.
            accessToken = await this._authorize(credentials, reconfig, launch);
        } catch (err) {
            throw new Error(`Error creating client instance: ${err}`);
        }

        return new OutlookClient(credentials.graph_endpoint, accessToken);
    }

    /**
     * Create an OAuth2 client with the given credentials.
     *
     * @param {Object} credentials The authorization client credentials.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {Promise<string>} The auth token.
     */
    async _authorize(credentials, reconfig, launch) {
        const pca = this._createPublicClientApp(credentials);
        const response = reconfig ?
            await this._getToken(pca, launch) :
            await this._getSilentToken(pca, launch);
        return response.accessToken;
    }

    /**
     * Aquires token silently using the cache.
     * 
     * @param {PublicClientApplication} pca An instance of PublicClientApplication. 
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {Promise<object>} The auth result.
     */
    async _getSilentToken(pca, launch) {
        const tokenCache = pca.getTokenCache();
        const accounts = await tokenCache.getAllAccounts();

        if (accounts.length === 0) {
            return await this._getToken(pca, launch);
        }

        const silentRequest = {
            scopes: SCOPES,
            account: accounts[0]
        };

        return pca.acquireTokenSilent(silentRequest)
            .catch(err => {
                if (err instanceof InteractionRequiredAuthError) {
                    return this._getToken(pca, launch);
                }
                else {
                    throw err;
                }
            });
    }

    /**
     * Acquires token with client credentials.
     * 
     * @param {PublicClientApplication} pca An instance of PublicClientApplication. 
     * @param {boolean} [launch] Launch the auth url in the browser. 
     * @returns {Promise<object>} The auth result.
     */
    _getToken(pca, launch) {
        const deviceCodeRequest = {
            scopes: SCOPES,
            deviceCodeCallback: (response) => {
                /*
                    {
                        "userCode":"<code here>",
                        "deviceCode":"<long code here>",
                        "verificationUri":"https://www.microsoft.com/link",
                        "expiresIn":900,
                        "interval":5,
                        "message":"To sign in, use a web browser to open the page https://www.microsoft.com/link and enter the code SGPWMMAK to authenticate."
                    }
                */
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
     * 
     * @param {Object} credentials The authorization client credentials.
     * @returns {PublicClientApplication} An instance of PublicClientApplication. 
     */
    _createPublicClientApp(credentials) {
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
                    beforeCacheAccess: ctx => cachePlugin.beforeCacheAccess(ctx),
                    afterCacheAccess: ctx => cachePlugin.afterCacheAccess(ctx)
                }
            },
        };

        return new PublicClientApplication(msalConfig);
    }
}

export { OutlookClient, OutlookClientFactory };