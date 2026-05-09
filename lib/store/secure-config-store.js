import * as keychain from 'cross-keychain';
import { ConfigStore } from './config-store.js';

const SERVICE_NAME = 'trash-cleaner';

// Keys that contain sensitive credentials and should use keychain
const SENSITIVE_PATTERNS = ['.credentials.', '.token.'];

/**
 * @typedef {object} KeychainProvider
 * @property {(service: string, account: string) => Promise<string|null>} getPassword
 * @property {(service: string, account: string, password: string) => Promise<void>} setPassword
 * @property {(service: string, account: string) => Promise<boolean|void>} deletePassword
 */

/** @type {KeychainProvider} */
const defaultKeychain = {
    getPassword: keychain.getPassword,
    setPassword: keychain.setPassword,
    deletePassword: keychain.deletePassword
};

/**
 * A ConfigStore that stores sensitive data (credentials, tokens) in the
 * OS keychain and falls back to a file-based store for everything else.
 */
class SecureConfigStore extends ConfigStore {
    /**
     * Creates an instance of SecureConfigStore.
     *
     * @param {ConfigStore} fileStore The file-based config store to use as fallback.
     * @param {KeychainProvider} [keychainProvider] Optional keychain implementation for testing.
     */
    constructor(fileStore, keychainProvider) {
        super();
        this._fileStore = fileStore;
        this._keychain = keychainProvider || defaultKeychain;
    }

    /**
     * Reads JSON config. Tries keychain first for sensitive keys, then file.
     *
     * @param {string} key The config key.
     * @returns {Promise<any>} The parsed JSON value.
     */
    async getJson(key) {
        const value = await this.get(key);
        if (value === null || value === undefined) {
            return null;
        }
        return JSON.parse(value);
    }

    /**
     * Reads config string. Tries keychain first for sensitive keys, then file.
     *
     * @param {string} key The config key.
     * @returns {Promise<string|null>} The config value.
     */
    async get(key) {
        if (this._isSensitive(key)) {
            try {
                const value = await this._keychain.getPassword(SERVICE_NAME, key);
                if (value) {
                    return value;
                }
            } catch {
                // Keychain not available, fall through to file
            }
        }
        return this._fileStore.get(key);
    }

    /**
     * Writes JSON config. Saves to keychain for sensitive keys, file otherwise.
     *
     * @param {string} key The config key.
     * @param {object} value The config object.
     */
    async putJson(key, value) {
        return this.put(key, JSON.stringify(value));
    }

    /**
     * Writes config string. Saves to keychain for sensitive keys, file otherwise.
     *
     * @param {string} key The config key.
     * @param {string} value The config string.
     */
    async put(key, value) {
        if (this._isSensitive(key)) {
            try {
                await this._keychain.setPassword(SERVICE_NAME, key, value);
                return;
            } catch {
                // Keychain not available, fall through to file
            }
        }
        return this._fileStore.put(key, value);
    }

    /**
     * Removes a credential from the keychain.
     *
     * @param {string} key The config key to remove.
     * @returns {Promise<boolean>} True if removed, false if not found.
     */
    async remove(key) {
        try {
            await this._keychain.deletePassword(SERVICE_NAME, key);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Checks whether a key contains sensitive data.
     *
     * @param {string} key The config key.
     * @returns {boolean} True if the key is for credentials or tokens.
     */
    _isSensitive(key) {
        return SENSITIVE_PATTERNS.some(p => key.includes(p));
    }
}

export { SecureConfigStore, SERVICE_NAME };
