const path = require('path');
const fs = require('fs');
const util = require('util');
const { ConfigStore } = require('./config-store');

const fsExists = util.promisify(fs.exists);
const fsReadFile = util.promisify(fs.readFile);
const fsWriteFile = util.promisify(fs.writeFile);

/**
 * A class to store and retrieve configuration objects in the file system.
 */
class FileSystemConfigStore extends ConfigStore {
    /**
     * Creates an instance of ConfigStore.
     *
     * @param {string} configDirPath Path to configuration directory.
     */
    constructor(configDirPath) {
        super();
        this.configDirPath = configDirPath;
        if (!fs.existsSync(configDirPath)) {
            throw new Error(`Invalid config directory path: ${configDirPath}`);
        }
    }

    /**
     * Reads the configuration object from the store.
     *
     * @param {string} key The key to configuration.
     */
    async getJson(key) {
        let value = await this.get(key);
        return JSON.parse(value);
    }

    /**
     * Reads the configuration string from the store.
     * 
     * @param {string} key The key to configuration.
     */
    async get(key) {
        let configPath = path.join(this.configDirPath, key);
        if (!await fsExists(configPath)) {
            return null;
        }

        return await fsReadFile(configPath);
    }

    /**
     * Writes the configuration object to the store.
     *
     * @param {string} key The key to configuration.
     * @param {object} value The configuration object.
     */
    putJson(key, value) {
        return this.put(key, JSON.stringify(value));
    }

    /**
     * Writes the configuration string to the store.
     * 
     * @param {string} key The key to configuration.
     * @param {string} value The configuration object.
     */
    async put(key, value) {
        let configPath = path.join(this.configDirPath, key);
        await fsWriteFile(configPath, value);
    }
}

module.exports = { FileSystemConfigStore };