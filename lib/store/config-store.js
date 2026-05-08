/**
 * A class to store and retrieve configuration objects.
 */
class ConfigStore {
    /**
     * Reads the configuration object from the store.
     * 
     * @param {string} _key The key to configuration.
     * @returns {Promise<any>}
     */
    async getJson(_key) {
    }

    /**
     * Reads the configuration string from the store.
     * 
     * @param {string} _key The key to configuration.
     * @returns {Promise<any>}
     */
    async get(_key) {
    }

    /**
     * Writes the configuration object to the store.
     * 
     * @param {string} _key The key to configuration.
     * @param {object} _value The configuration object.
     */
    async putJson(_key, _value) {
    }

    /**
     * Writes the configuration string to the store.
     * 
     * @param {string} _key The key to configuration.
     * @param {string} _value The configuration object.
     */
    async put(_key, _value) {
    }
}

module.exports = { ConfigStore };