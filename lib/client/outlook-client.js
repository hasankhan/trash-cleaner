const open = require('open');

const axios = require('axios');
const { ConfigStore } = require('../store/config-store');
const { PublicClientApplication, InteractionRequiredAuthError } = require('@azure/msal-node');
const { Email, EmailClient, EmailClientFactory } = require('./email-client');

// If modifying these scopes, delete token.json.
const SCOPES = ["mail.readwrite"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const FILE_TOKEN = 'outlook.token.json';
// The file credentials.json stores the google api credentials.
const FILE_CREDENTIALS = 'outlook.credentials.json';
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
     */
    constructor(configStore) {
        this._configStore = configStore;
    }

    async beforeCacheAccess(cacheContext) {
        let data = await this._configStore.get(FILE_TOKEN);
        if (data) {
            cacheContext.tokenCache.deserialize(data);
        }
        else {
            await this._configStore.put(FILE_TOKEN,
                cacheContext.tokenCache.serialize());
        }
    }

    async afterCacheAccess(cacheContext) {
        if (cacheContext.cacheHasChanged) {
            await this._configStore.put(FILE_TOKEN,
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
     * @returns {Email[]} A list of unread emails.
     */
    async getUnreadEmails() {
        const getFoldersPath = `${this._graphEndpoint}${API_PATH_GET_FOLDERS}`;
        let response = await this._callApi('get', getFoldersPath, this._accessToken);
        let folderMap = response.value.reduce((map, folder) => {
            map[folder.id] = folder.displayName;
            return map;
        }, {});

        const getEmailsPath = `${this._graphEndpoint}${API_PATH_GET_MESSAGES}`;
        response = await this._callApi('get', getEmailsPath, this._accessToken);
        let emails = response.value.map(message => this._parseMessage(message, folderMap));
        return emails;
    }

    /**
     * Deletes the emails.
     * 
     * @param {Email[]} emails A list of emails to delete.
     */
    async deleteEmails(emails) {
        try {
            for (let email of emails) {
                const deleteEmailPath = `${this._graphEndpoint}${API_PATH_GET_MESSAGE}/${email.id}`;
                await this._callApi('delete', deleteEmailPath, this._accessToken);
            }
        } catch (err) {
            throw new Error(`Failed to delete messages: ${err}`);
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
        email.labels = [folderMap[message.parentFolderId]] ?? '';
        email.snippet = message.bodyPreview;
        email.subject = message.subject;
        email.from = this._formatEmail(message.from.emailAddress.name,
            message.from.emailAddress.address);
        email.body = message.body.content;
        return email;
    }

    _formatEmail(name, email) {
        return `${name} <${email}>`;
    }

    /**
     * Calls the endpoint with authorization bearer token.
     * @param {string} endpoint
     * @param {string} accessToken
     */
    async _callApi(op, endpoint, accessToken) {

        const options = {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        };

        const response = await axios.default[op](endpoint, options);
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
     */
    constructor(configStore) {
        super();
        this.configStore = configStore;
    }

    /**
     * Creates an instance of OutlookClient.
     * @param {boolean} reconfig Reconfigure auth secrets.
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {GmailClient} The Gmail client. 
     */
    async getInstance(reconfig, launch) {
        var accessToken;
        let credentials;
        try {
            credentials = await this.configStore.getJson(FILE_CREDENTIALS);
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
     * @returns {string} The auth token.
     */
    async _authorize(credentials, reconfig, launch) {
        let pca = this._createPublicClientApp(credentials);
        let response = reconfig ?
            await this._getToken(pca, launch) :
            await this._getSilentToken(pca, launch);
        return response.accessToken;
    }

    /**
     * Aquires token silently using the cache.
     * 
     * @param {PublicClientApplication} pca An instance of PublicClientApplication. 
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {AuthenticationResult} The auth result.
     */
    async _getSilentToken(pca, launch) {
        const tokenCache = pca.getTokenCache();
        const accounts = await tokenCache.getAllAccounts();

        if (accounts.length == 0) {
            return await this._getToken(pca);
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
     * @param {boolean} launch Launch the auth url in the browser. 
     * @returns {AuthenticationResult} The auth result.
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
        let cachePlugin = new CachePlugin(this.configStore);

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

module.exports = { OutlookClient, OutlookClientFactory };