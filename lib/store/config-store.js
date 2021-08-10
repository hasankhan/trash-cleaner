/**
 * A class to store and retrieve configuration objects.
 */
class ConfigStore {
    /**
     * Reads the configuration object from the store.
     * 
     * @param {string} key The key to configuration.
     */
    async getJson(key) {
    }

    /**
     * Reads the configuration string from the store.
     * 
     * @param {string} key The key to configuration.
     */
    async get(key) {
    }

    /**
     * Writes the configuration object to the store.
     * 
     * @param {string} key The key to configuration.
     * @param {object} value The configuration object.
     */
    async putJson(key, value) {
    }

    /**
     * Writes the configuration string to the store.
     * 
     * @param {string} key The key to configuration.
     * @param {string} value The configuration object.
     */
    async put(key, value) {
    }
}

module.exports = { ConfigStore };