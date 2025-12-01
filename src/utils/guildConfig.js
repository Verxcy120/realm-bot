import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '../../data/guildConfig.json');

// Ensure data directory exists
const dataDir = path.dirname(CONFIG_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY CACHE
// ═══════════════════════════════════════════════════════════════

let configCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 seconds cache TTL

// Default config for new guilds
const DEFAULT_CONFIG = {
    // Channels
    logChannel: null,           // Channel ID for bot logs
    alertChannel: null,         // Channel ID for realm alerts (player join/leave)
    chatBridgeChannel: null,    // Channel for chat bridge
    databaseLogChannel: null,   // Channel for database entries
    detectionLogChannel: null,  // Channel for live detection logs
    
    // Permissions
    adminRole: null,            // Role ID that can use admin commands
    commandPermissions: {},     // Per-command role permissions
    
    // Features
    autoReconnect: true,        // Auto-reconnect bot if disconnected
    playerJoinAlerts: true,     // Alert when players join realm
    playerLeaveAlerts: true,    // Alert when players leave realm
    chatBridge: false,          // Bridge realm chat to Discord
    welcomeMessage: null,       // Message to send when bot joins realm
    liveDetection: false,       // Live detection of flagged players
    
    // Logs
    logs: {
        chatRelay: false,
        joinsLeaves: true,
        playerDeaths: false,
        automod: true,
        realmBans: true,
        realmUnbans: true,
        realmKicks: true,
        realmInvites: false,
        commandExecution: true,
        watchlistAlerts: true
    },
    
    // Automod
    automod: {
        antiSpoof: false,
        antiPrivateProfile: false,
        antiAlts: false,
        antiChatSpam: false,
        profanityFilter: false,
        antiUnfairSkins: false,
        antiDeviceSpoof: false,
        // New detections
        antiNewAccounts: false,        // Detection #10 - Account age check
        antiUnicodeExploit: false,     // Detection #15 - Unicode exploits
        antiCommandSpam: false,        // Detection #16 - Command spam
        antiChatFlood: false,          // Detection #17 - Chat flooding
        antiAdvertising: false,        // Detection #18 - Advertising
        antiInvalidPackets: false,     // Detection #20 - Invalid packets
        antiPacketFlood: false,        // Detection #21 - Packet rate limiting
        antiInventoryExploit: false,   // Detection #22 - Inventory manipulation
        antiAltsSettings: {
            minFriends: 0,
            minFollowers: 0,
            minGamerscore: 0
        },
        antiSpamSettings: {
            useAI: false,
            maxMessages: 5,
            timeWindow: 10
        },
        antiNewAccountsSettings: {
            minAccountAgeDays: 30
        },
        antiCommandSpamSettings: {
            maxCommands: 10,
            timeWindow: 5
        },
        antiChatFloodSettings: {
            maxMessages: 5,
            timeWindow: 10,
            duplicateThreshold: 3
        }
    },
    
    prefix: '!'                 // Command prefix for in-game commands
};

/**
 * Load all guild configs from file (with caching)
 * @returns {object} All guild configs
 */
function loadConfigs() {
    // Return cached if still valid
    if (configCache && Date.now() - cacheTimestamp < CACHE_TTL) {
        return configCache;
    }
    
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            cacheTimestamp = Date.now();
            return configCache;
        }
    } catch (error) {
        console.error('[Config] Error loading configs:', error);
    }
    
    configCache = {};
    cacheTimestamp = Date.now();
    return configCache;
}

/**
 * Save all guild configs to file (and invalidate cache)
 * @param {object} configs - All configs
 */
function saveConfigs(configs) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
        // Update cache
        configCache = configs;
        cacheTimestamp = Date.now();
    } catch (error) {
        console.error('[Config] Error saving configs:', error);
    }
}

/**
 * Invalidate the config cache (useful after external changes)
 */
export function invalidateConfigCache() {
    configCache = null;
    cacheTimestamp = 0;
}

/**
 * Get config for a guild
 * @param {string} guildId - Guild ID
 * @returns {object} Guild config with defaults
 */
export function getGuildConfig(guildId) {
    const configs = loadConfigs();
    return { ...DEFAULT_CONFIG, ...configs[guildId] };
}

/**
 * Update a specific config value for a guild
 * @param {string} guildId - Guild ID
 * @param {string} key - Config key
 * @param {any} value - Config value
 */
export function setGuildConfig(guildId, key, value) {
    const configs = loadConfigs();
    
    if (!configs[guildId]) {
        configs[guildId] = {};
    }
    
    configs[guildId][key] = value;
    saveConfigs(configs);
}

/**
 * Update multiple config values for a guild
 * @param {string} guildId - Guild ID
 * @param {object} updates - Object with key-value pairs to update
 */
export function updateGuildConfig(guildId, updates) {
    const configs = loadConfigs();
    
    if (!configs[guildId]) {
        configs[guildId] = {};
    }
    
    configs[guildId] = { ...configs[guildId], ...updates };
    saveConfigs(configs);
}

/**
 * Reset a guild's config to defaults
 * @param {string} guildId - Guild ID
 */
export function resetGuildConfig(guildId) {
    const configs = loadConfigs();
    delete configs[guildId];
    saveConfigs(configs);
}

/**
 * Get the default config template
 * @returns {object} Default config
 */
export function getDefaultConfig() {
    return { ...DEFAULT_CONFIG };
}
