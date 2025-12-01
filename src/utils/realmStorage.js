import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to store connected realms
const DATA_DIR = join(__dirname, '..', '..', 'data');
const REALMS_FILE = join(DATA_DIR, 'connected_realms.json');

// Ensure data directory exists
function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Load all connected realms from file
function loadConnectedRealms() {
    ensureDataDir();
    
    if (!existsSync(REALMS_FILE)) {
        return {};
    }
    
    try {
        const data = readFileSync(REALMS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading connected realms:', error);
        return {};
    }
}

// Save all connected realms to file
function saveConnectedRealms(realms) {
    ensureDataDir();
    
    try {
        writeFileSync(REALMS_FILE, JSON.stringify(realms, null, 2));
    } catch (error) {
        console.error('Error saving connected realms:', error);
    }
}

/**
 * Set the connected realm for a Discord user
 * @param {string} discordUserId - Discord user ID
 * @param {object} realmData - Realm connection data
 */
export function setConnectedRealm(discordUserId, realmData) {
    const realms = loadConnectedRealms();
    
    realms[discordUserId] = {
        ...realmData,
        updatedAt: new Date().toISOString()
    };
    
    saveConnectedRealms(realms);
}

/**
 * Get the connected realm for a Discord user
 * @param {string} discordUserId - Discord user ID
 * @returns {object|null} Realm data or null if not connected
 */
export function getConnectedRealm(discordUserId) {
    const realms = loadConnectedRealms();
    return realms[discordUserId] || null;
}

/**
 * Remove the connected realm for a Discord user
 * @param {string} discordUserId - Discord user ID
 */
export function removeConnectedRealm(discordUserId) {
    const realms = loadConnectedRealms();
    delete realms[discordUserId];
    saveConnectedRealms(realms);
}

/**
 * Check if a user has a connected realm
 * @param {string} discordUserId - Discord user ID
 * @returns {boolean}
 */
export function hasConnectedRealm(discordUserId) {
    const realms = loadConnectedRealms();
    return discordUserId in realms;
}

/**
 * Get all users with connected realms
 * @returns {object} Map of userId -> realm data
 */
export function getAllConnectedRealms() {
    return loadConnectedRealms();
}
