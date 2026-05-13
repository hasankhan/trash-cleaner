import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import yaml from 'js-yaml';
import { ConfigStore } from './config-store.js';

const fsExists = promisify(fs.exists);
const fsReadFile = promisify(fs.readFile);
const fsWriteFile = promisify(fs.writeFile);

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
            throw new Error(`Config directory not found: ${configDirPath}\nRun 'trash-cleaner init' to create it with sample configuration files.`);
        }
    }

    /**
     * Reads the configuration object from the store.
     * For .yaml/.yml keys, parses as YAML.
     * For .json keys, tries .yaml first (backward compat), then falls back to .json.
     *
     * @param {string} key The key to configuration.
     * @returns {Promise<any>}
     */
    async getJson(key) {
        if (key.endsWith('.yaml') || key.endsWith('.yml')) {
            const value = await this.get(key);
            if (value === null) return null;
            return yaml.load(value.toString());
        }

        // For .json keys: try .yaml equivalent first, fall back to .json
        const yamlKey = key.replace(/\.json$/, '.yaml');
        const yamlPath = path.join(this.configDirPath, yamlKey);
        if (await fsExists(yamlPath)) {
            const value = await fsReadFile(yamlPath);
            return yaml.load(value.toString());
        }

        const value = await this.get(key);
        if (value === null) return null;
        return JSON.parse(value);
    }

    /**
     * Reads the configuration string from the store.
     * 
     * @param {string} key The key to configuration.
     * @returns {Promise<any>}
     */
    async get(key) {
        const configPath = path.join(this.configDirPath, key);
        if (!await fsExists(configPath)) {
            return null;
        }

        return await fsReadFile(configPath);
    }

    /**
     * Writes the configuration object to the store as JSON.
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
        const configPath = path.join(this.configDirPath, key);
        await fsWriteFile(configPath, value);
    }
}

export { FileSystemConfigStore };