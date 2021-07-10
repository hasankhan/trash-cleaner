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
    async get(key) {
        let configPath = path.join(this.configDirPath, key);
        if (!await fsExists(configPath)) {
            return null;
        }

        let serializedValue = await fsReadFile(configPath);
        return JSON.parse(serializedValue);
    }

    /**
     * Writes the configuration object to the store.
     *
     * @param {string} key The key to configuration.
     * @param {object} value The configuration object.
     */
    async put(key, value) {
        let configPath = path.join(this.configDirPath, key);
        let serializedValue = JSON.stringify(value);
        await fsWriteFile(configPath, serializedValue);
    }
}

module.exports = { FileSystemConfigStore };