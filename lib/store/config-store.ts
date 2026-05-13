/**
 * A class to store and retrieve configuration objects.
 */
class ConfigStore {
    /**
     * Reads the configuration object from the store.
     */
    async getJson(_key: string): Promise<unknown> {
        return undefined;
    }

    /**
     * Reads the configuration string from the store.
     */
    async get(_key: string): Promise<string | Buffer | null> {
        return null;
    }

    /**
     * Writes the configuration object to the store.
     */
    async putJson(_key: string, _value: object): Promise<void> {
    }

    /**
     * Writes the configuration string to the store.
     */
    async put(_key: string, _value: string): Promise<void> {
    }
}

export { ConfigStore };
