import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = `${__dirname}/../../data`;
const HACKERS_FILE = `${DATA_DIR}/hackers.json`;
const DISCORD_USERS_FILE = `${DATA_DIR}/discordUsers.json`;

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY CACHE
// ═══════════════════════════════════════════════════════════════

let hackersCache = null;
let hackersCacheTime = 0;
let discordUsersCache = null;
let discordUsersCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds cache

// ═══════════════════════════════════════════════════════════════
// HACKERS DATABASE (Realm Hackers)
// ═══════════════════════════════════════════════════════════════

function loadHackers() {
    // Return cached if valid
    if (hackersCache && Date.now() - hackersCacheTime < CACHE_TTL) {
        return hackersCache;
    }
    
    if (!existsSync(HACKERS_FILE)) {
        hackersCache = [];
        hackersCacheTime = Date.now();
        return hackersCache;
    }
    try {
        hackersCache = JSON.parse(readFileSync(HACKERS_FILE, 'utf8'));
        hackersCacheTime = Date.now();
        return hackersCache;
    } catch {
        hackersCache = [];
        hackersCacheTime = Date.now();
        return hackersCache;
    }
}

function saveHackers(data) {
    writeFileSync(HACKERS_FILE, JSON.stringify(data, null, 2));
    // Update cache
    hackersCache = data;
    hackersCacheTime = Date.now();
}

export function addHacker(xuid, gamertag, reason, addedBy, discordId = null) {
    const hackers = loadHackers();
    
    // Check if already exists
    const existing = hackers.find(h => h.xuid === xuid);
    if (existing) {
        return { success: false, message: 'This XUID is already in the database.' };
    }
    
    const entry = {
        xuid,
        gamertag,
        reason,
        addedBy,
        discordId,
        addedAt: Date.now()
    };
    
    hackers.push(entry);
    saveHackers(hackers);
    
    return { success: true, entry };
}

export function removeHacker(xuid) {
    const hackers = loadHackers();
    const index = hackers.findIndex(h => h.xuid === xuid);
    
    if (index === -1) {
        return { success: false, message: 'This XUID is not in the database.' };
    }
    
    const removed = hackers.splice(index, 1)[0];
    saveHackers(hackers);
    
    return { success: true, entry: removed };
}

export function getHacker(xuid) {
    const hackers = loadHackers();
    return hackers.find(h => h.xuid === xuid);
}

export function getAllHackers() {
    return loadHackers();
}

export function searchHackers(query) {
    const hackers = loadHackers();
    const lowerQuery = query.toLowerCase();
    
    return hackers.filter(h => 
        h.xuid.includes(query) || 
        h.gamertag.toLowerCase().includes(lowerQuery)
    );
}

// ═══════════════════════════════════════════════════════════════
// DISCORD USERS DATABASE
// ═══════════════════════════════════════════════════════════════

function loadDiscordUsers() {
    // Return cached if valid
    if (discordUsersCache && Date.now() - discordUsersCacheTime < CACHE_TTL) {
        return discordUsersCache;
    }
    
    if (!existsSync(DISCORD_USERS_FILE)) {
        discordUsersCache = [];
        discordUsersCacheTime = Date.now();
        return discordUsersCache;
    }
    try {
        discordUsersCache = JSON.parse(readFileSync(DISCORD_USERS_FILE, 'utf8'));
        discordUsersCacheTime = Date.now();
        return discordUsersCache;
    } catch {
        discordUsersCache = [];
        discordUsersCacheTime = Date.now();
        return discordUsersCache;
    }
}

function saveDiscordUsers(data) {
    writeFileSync(DISCORD_USERS_FILE, JSON.stringify(data, null, 2));
    // Update cache
    discordUsersCache = data;
    discordUsersCacheTime = Date.now();
}

export function addDiscordUser(discordId, discordTag, reason, addedBy) {
    const users = loadDiscordUsers();
    
    // Check if already exists
    const existing = users.find(u => u.discordId === discordId);
    if (existing) {
        return { success: false, message: 'This Discord ID is already in the database.' };
    }
    
    const entry = {
        discordId,
        discordTag,
        reason,
        addedBy,
        addedAt: Date.now()
    };
    
    users.push(entry);
    saveDiscordUsers(users);
    
    return { success: true, entry };
}

export function removeDiscordUser(discordId) {
    const users = loadDiscordUsers();
    const index = users.findIndex(u => u.discordId === discordId);
    
    if (index === -1) {
        return { success: false, message: 'This Discord ID is not in the database.' };
    }
    
    const removed = users.splice(index, 1)[0];
    saveDiscordUsers(users);
    
    return { success: true, entry: removed };
}

export function getDiscordUser(discordId) {
    const users = loadDiscordUsers();
    return users.find(u => u.discordId === discordId);
}

export function getAllDiscordUsers() {
    return loadDiscordUsers();
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

export function getDatabaseStats() {
    const hackers = loadHackers();
    const discordUsers = loadDiscordUsers();
    
    return {
        hackers: hackers.length,
        discordUsers: discordUsers.length,
        total: hackers.length + discordUsers.length
    };
}

// ═══════════════════════════════════════════════════════════════
// CHECK IF USER IS FLAGGED
// ═══════════════════════════════════════════════════════════════

export function isXuidFlagged(xuid) {
    const hacker = getHacker(xuid);
    return hacker ? { flagged: true, data: hacker, type: 'hacker' } : { flagged: false };
}

export function isDiscordFlagged(discordId) {
    const user = getDiscordUser(discordId);
    return user ? { flagged: true, data: user, type: 'discord' } : { flagged: false };
}
