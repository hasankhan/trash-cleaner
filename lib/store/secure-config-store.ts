import * as keychain from 'cross-keychain';
import { ConfigStore } from './config-store.js';

const SERVICE_NAME = 'trash-cleaner';

// Keys that contain sensitive credentials and should use keychain
const SENSITIVE_PATTERNS = ['.credentials.', '.token.'];

interface KeychainProvider {
    getPassword(service: string, account: string): Promise<string | null>;
    setPassword(service: string, account: string, password: string): Promise<void>;
    deletePassword(service: string, account: string): Promise<boolean | void>;
}

const defaultKeychain: KeychainProvider = {
    getPassword: keychain.getPassword,
    setPassword: keychain.setPassword,
    deletePassword: keychain.deletePassword
};

/**
 * A ConfigStore that stores sensitive data (credentials, tokens) in the
 * OS keychain and falls back to a file-based store for everything else.
 */
class SecureConfigStore extends ConfigStore {
    private readonly _fileStore: ConfigStore;
    private readonly _keychain: KeychainProvider;

    /**
     * Creates an instance of SecureConfigStore.
     */
    constructor(fileStore: ConfigStore, keychainProvider?: KeychainProvider) {
        super();
        this._fileStore = fileStore;
        this._keychain = keychainProvider || defaultKeychain;
    }

    /**
     * Reads JSON config. Tries keychain first for sensitive keys, then file.
     */
    async getJson(key: string): Promise<unknown> {
        // For sensitive keys, try keychain first
        if (this._isSensitive(key)) {
            try {
                const value = await this._keychain.getPassword(SERVICE_NAME, key);
                if (value) {
                    return JSON.parse(value);
                }
            } catch {
                // Keychain not available, fall through to file store
            }
        }
        // Delegate to file store's getJson which handles YAML/JSON fallback
        return this._fileStore.getJson(key);
    }

    /**
     * Reads config string. Tries keychain first for sensitive keys, then file.
     */
    async get(key: string): Promise<string | null> {
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
        const result = await this._fileStore.get(key);
        return result !== null ? result.toString() : null;
    }

    /**
     * Writes JSON config. Saves to keychain for sensitive keys, file otherwise.
     */
    async putJson(key: string, value: object): Promise<void> {
        return this.put(key, JSON.stringify(value));
    }

    /**
     * Writes config string. Saves to keychain for sensitive keys, file otherwise.
     */
    async put(key: string, value: string): Promise<void> {
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
     */
    async remove(key: string): Promise<boolean> {
        try {
            await this._keychain.deletePassword(SERVICE_NAME, key);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Checks whether a key contains sensitive data.
     */
    _isSensitive(key: string): boolean {
        return SENSITIVE_PATTERNS.some(p => key.includes(p));
    }
}

export { SecureConfigStore, SERVICE_NAME };
export type { KeychainProvider };
