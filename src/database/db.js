const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/realmshield.db');
let db;

function initDatabase() {
    db = new Database(dbPath);
    
    // Create users table to store linked Microsoft accounts (per guild)
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT,
            guild_id TEXT,
            xbox_gamertag TEXT,
            xbox_xuid TEXT,
            access_token TEXT,
            refresh_token TEXT,
            token_expires_at INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(discord_id, guild_id)
        )
    `);

    // Migration: Ensure users table has proper schema with guild_id and UNIQUE constraint
    try {
        const tableInfo = db.prepare("PRAGMA table_info(users)").all();
        const hasGuildId = tableInfo.some(col => col.name === 'guild_id');
        
        // Check if UNIQUE constraint exists
        const indexInfo = db.prepare("PRAGMA index_list(users)").all();
        const hasUniqueConstraint = indexInfo.some(idx => idx.unique === 1 && idx.name.includes('discord_id'));
        
        if (!hasGuildId || !hasUniqueConstraint) {
            console.log('🔄 Migrating database: Recreating users table with proper schema...');
            
            // Backup existing data
            const existingUsers = db.prepare('SELECT * FROM users').all();
            
            // Drop old table and create new one with proper schema
            db.exec(`DROP TABLE IF EXISTS users`);
            db.exec(`
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    discord_id TEXT,
                    guild_id TEXT,
                    xbox_gamertag TEXT,
                    xbox_xuid TEXT,
                    access_token TEXT,
                    refresh_token TEXT,
                    token_expires_at INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                    UNIQUE(discord_id, guild_id)
                )
            `);
            
            // Restore data (guild_id will be NULL for old records)
            if (existingUsers.length > 0) {
                const insertStmt = db.prepare(`
                    INSERT INTO users (discord_id, guild_id, xbox_gamertag, xbox_xuid, access_token, refresh_token, token_expires_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                for (const user of existingUsers) {
                    insertStmt.run(
                        user.discord_id,
                        user.guild_id || null,
                        user.xbox_gamertag,
                        user.xbox_xuid,
                        user.access_token,
                        user.refresh_token,
                        user.token_expires_at,
                        user.created_at,
                        user.updated_at
                    );
                }
            }
            
            console.log('✅ Migration complete: users table recreated with proper schema');
        }
    } catch (migrationError) {
        console.error('Migration error:', migrationError);
    }

    // Create TOS acceptance table
    db.exec(`
        CREATE TABLE IF NOT EXISTS tos_accepted (
            discord_id TEXT PRIMARY KEY,
            accepted_at INTEGER DEFAULT (strftime('%s', 'now')),
            tos_version TEXT DEFAULT '1.0'
        )
    `);

    // Create blacklist table
    db.exec(`
        CREATE TABLE IF NOT EXISTS blacklist (
            discord_id TEXT PRIMARY KEY,
            reason TEXT,
            blacklisted_by TEXT,
            blacklisted_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // Create guild settings table for permissions and logging
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            realm_id TEXT,
            realm_name TEXT,
            chat_relay_channel TEXT,
            join_leave_channel TEXT,
            death_log_channel TEXT,
            ban_log_channel TEXT,
            unban_log_channel TEXT,
            kick_log_channel TEXT,
            connect_role TEXT,
            disconnect_role TEXT,
            kick_role TEXT,
            ban_role TEXT,
            unban_role TEXT,
            backup_role TEXT,
            open_role TEXT,
            close_role TEXT,
            settings_role TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // Create active connections table
    db.exec(`
        CREATE TABLE IF NOT EXISTS active_connections (
            guild_id TEXT PRIMARY KEY,
            realm_id TEXT,
            realm_name TEXT,
            connected_at INTEGER DEFAULT (strftime('%s', 'now')),
            connected_by TEXT
        )
    `);

    console.log('📦 Database tables created/verified');
    return db;
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

// User functions
function saveUser(discordId, guildId, xboxData, tokens) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO users (discord_id, guild_id, xbox_gamertag, xbox_xuid, access_token, refresh_token, token_expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(discord_id, guild_id) DO UPDATE SET
            xbox_gamertag = excluded.xbox_gamertag,
            xbox_xuid = excluded.xbox_xuid,
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            token_expires_at = excluded.token_expires_at,
            updated_at = strftime('%s', 'now')
    `);
    
    stmt.run(
        discordId,
        guildId,
        xboxData.gamertag,
        xboxData.xuid,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresAt
    );
}

function getUser(discordId, guildId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM users WHERE discord_id = ? AND guild_id = ?');
    return stmt.get(discordId, guildId);
}

function getUserByGuild(guildId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM users WHERE guild_id = ?');
    return stmt.get(guildId);
}

function deleteUser(discordId, guildId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM users WHERE discord_id = ? AND guild_id = ?');
    return stmt.run(discordId, guildId);
}

// TOS functions
function hasAcceptedTOS(discordId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM tos_accepted WHERE discord_id = ?');
    return stmt.get(discordId);
}

function acceptTOS(discordId, version = '1.0') {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO tos_accepted (discord_id, tos_version)
        VALUES (?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            accepted_at = strftime('%s', 'now'),
            tos_version = excluded.tos_version
    `);
    return stmt.run(discordId, version);
}

function revokeTOS(discordId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM tos_accepted WHERE discord_id = ?');
    return stmt.run(discordId);
}

// Blacklist functions
function addToBlacklist(discordId, reason, blacklistedBy) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO blacklist (discord_id, reason, blacklisted_by)
        VALUES (?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            reason = excluded.reason,
            blacklisted_by = excluded.blacklisted_by,
            blacklisted_at = strftime('%s', 'now')
    `);
    return stmt.run(discordId, reason, blacklistedBy);
}

function removeFromBlacklist(discordId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM blacklist WHERE discord_id = ?');
    return stmt.run(discordId);
}

function isBlacklisted(discordId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM blacklist WHERE discord_id = ?');
    return stmt.get(discordId);
}

function getAllBlacklisted() {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM blacklist ORDER BY blacklisted_at DESC');
    return stmt.all();
}

// Guild Settings functions
function getGuildSettings(guildId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
    return stmt.get(guildId);
}

function saveGuildSettings(guildId, settings) {
    const db = getDb();
    const existing = getGuildSettings(guildId);
    
    if (existing) {
        const stmt = db.prepare(`
            UPDATE guild_settings SET
                realm_id = COALESCE(?, realm_id),
                realm_name = COALESCE(?, realm_name),
                chat_relay_channel = COALESCE(?, chat_relay_channel),
                join_leave_channel = COALESCE(?, join_leave_channel),
                death_log_channel = COALESCE(?, death_log_channel),
                ban_log_channel = COALESCE(?, ban_log_channel),
                unban_log_channel = COALESCE(?, unban_log_channel),
                kick_log_channel = COALESCE(?, kick_log_channel),
                connect_role = COALESCE(?, connect_role),
                disconnect_role = COALESCE(?, disconnect_role),
                kick_role = COALESCE(?, kick_role),
                ban_role = COALESCE(?, ban_role),
                unban_role = COALESCE(?, unban_role),
                backup_role = COALESCE(?, backup_role),
                open_role = COALESCE(?, open_role),
                close_role = COALESCE(?, close_role),
                settings_role = COALESCE(?, settings_role),
                updated_at = strftime('%s', 'now')
            WHERE guild_id = ?
        `);
        stmt.run(
            settings.realm_id, settings.realm_name,
            settings.chat_relay_channel, settings.join_leave_channel,
            settings.death_log_channel, settings.ban_log_channel,
            settings.unban_log_channel, settings.kick_log_channel,
            settings.connect_role, settings.disconnect_role,
            settings.kick_role, settings.ban_role,
            settings.unban_role, settings.backup_role,
            settings.open_role, settings.close_role,
            settings.settings_role, guildId
        );
    } else {
        const stmt = db.prepare(`
            INSERT INTO guild_settings (guild_id, realm_id, realm_name, chat_relay_channel, join_leave_channel, death_log_channel, ban_log_channel, unban_log_channel, kick_log_channel, connect_role, disconnect_role, kick_role, ban_role, unban_role, backup_role, open_role, close_role, settings_role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            guildId, settings.realm_id, settings.realm_name,
            settings.chat_relay_channel, settings.join_leave_channel,
            settings.death_log_channel, settings.ban_log_channel,
            settings.unban_log_channel, settings.kick_log_channel,
            settings.connect_role, settings.disconnect_role,
            settings.kick_role, settings.ban_role,
            settings.unban_role, settings.backup_role,
            settings.open_role, settings.close_role,
            settings.settings_role
        );
    }
}

function clearGuildSettingField(guildId, field) {
    const db = getDb();
    const allowedFields = [
        'chat_relay_channel', 'join_leave_channel', 'death_log_channel',
        'ban_log_channel', 'unban_log_channel', 'kick_log_channel',
        'connect_role', 'disconnect_role', 'kick_role', 'ban_role',
        'unban_role', 'backup_role', 'open_role', 'close_role', 'settings_role'
    ];
    if (!allowedFields.includes(field)) return false;
    
    const stmt = db.prepare(`UPDATE guild_settings SET ${field} = NULL, updated_at = strftime('%s', 'now') WHERE guild_id = ?`);
    return stmt.run(guildId);
}

// Active Connections functions
function getActiveConnection(guildId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM active_connections WHERE guild_id = ?');
    return stmt.get(guildId);
}

function saveActiveConnection(guildId, realmId, realmName, connectedBy) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO active_connections (guild_id, realm_id, realm_name, connected_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            realm_id = excluded.realm_id,
            realm_name = excluded.realm_name,
            connected_at = strftime('%s', 'now'),
            connected_by = excluded.connected_by
    `);
    return stmt.run(guildId, realmId, realmName, connectedBy);
}

function deleteActiveConnection(guildId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM active_connections WHERE guild_id = ?');
    return stmt.run(guildId);
}

function getAllActiveConnections() {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM active_connections');
    return stmt.all();
}

module.exports = {
    initDatabase,
    getDb,
    saveUser,
    getUser,
    getUserByGuild,
    deleteUser,
    hasAcceptedTOS,
    acceptTOS,
    revokeTOS,
    addToBlacklist,
    removeFromBlacklist,
    isBlacklisted,
    getAllBlacklisted,
    getGuildSettings,
    saveGuildSettings,
    clearGuildSettingField,
    getActiveConnection,
    saveActiveConnection,
    deleteActiveConnection,
    getAllActiveConnections
};
