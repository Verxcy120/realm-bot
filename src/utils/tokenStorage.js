import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to store user tokens
const DATA_DIR = join(__dirname, '..', '..', 'data');
const TOKENS_FILE = join(DATA_DIR, 'tokens.json');

// Ensure data directory exists
function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Load all tokens from file
function loadTokens() {
    ensureDataDir();
    
    if (!existsSync(TOKENS_FILE)) {
        return {};
    }
    
    try {
        const data = readFileSync(TOKENS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading tokens:', error);
        return {};
    }
}

// Save all tokens to file
function saveTokens(tokens) {
    ensureDataDir();
    
    try {
        writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    } catch (error) {
        console.error('Error saving tokens:', error);
    }
}

/**
 * Store authentication data for a Discord guild
 * @param {string} guildId - Discord guild ID
 * @param {object} authData - Authentication data from prismarine-auth
 */
export function storeUserAuth(guildId, authData) {
    const tokens = loadTokens();
    
    tokens[guildId] = {
        ...authData,
        linkedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    saveTokens(tokens);
}

/**
 * Get authentication data for a Discord guild
 * @param {string} guildId - Discord guild ID
 * @returns {object|null} Authentication data or null if not found
 */
export function getUserAuth(guildId) {
    const tokens = loadTokens();
    return tokens[guildId] || null;
}

/**
 * Remove authentication data for a Discord guild
 * @param {string} guildId - Discord guild ID
 */
export function removeUserAuth(guildId) {
    const tokens = loadTokens();
    delete tokens[guildId];
    saveTokens(tokens);
}

/**
 * Check if a guild has linked their account
 * @param {string} guildId - Discord guild ID
 * @returns {boolean}
 */
export function isUserLinked(guildId) {
    const tokens = loadTokens();
    return guildId in tokens;
}

/**
 * Get all linked guilds
 * @returns {string[]} Array of Discord guild IDs
 */
export function getAllLinkedUsers() {
    const tokens = loadTokens();
    return Object.keys(tokens);
}
