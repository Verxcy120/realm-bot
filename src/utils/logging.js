import { EmbedBuilder } from 'discord.js';
import { isXuidFlagged } from './database.js';
import { getGuildConfig } from './guildConfig.js';

const COLORS = {
    DETECTION: 0xED4245,  // Red for detections
    WARNING: 0xFEE75C,    // Yellow for warnings
    INFO: 0x5865F2,       // Blue for info
    SUCCESS: 0x57F287,    // Green for success
    BAN: 0xED4245,        // Red for bans
    KICK: 0xFFA500,       // Orange for kicks
    UNBAN: 0x57F287,      // Green for unbans
    JOIN: 0x57F287,       // Green for joins
    LEAVE: 0x95A5A6,      // Gray for leaves
    COMMAND: 0x9B84EE,    // Purple for commands
    CHAT: 0x3498DB,       // Light blue for chat
    DEATH: 0x2C3E50,      // Dark for deaths
    DEVICE: 0x9B59B6,     // Purple for device logs
    SESSION: 0xE91E63,    // Pink for session logs
    FIRST_JOIN: 0xFFD700  // Gold for first joins
};

// ═══════════════════════════════════════════════════════════════
// ADVANCED SESSION TRACKING
// ═══════════════════════════════════════════════════════════════

// Track player sessions per guild
const playerSessions = new Map(); // guildId -> Map(xuid -> sessionData)
const playerHistory = new Map();  // guildId -> Map(xuid -> playerData)

// Memory management settings
const MAX_HISTORY_ENTRIES = 1000; // Max player history entries per guild
const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // Max session age (24 hours)

/**
 * Get or create session tracker for a guild
 */
function getGuildSessions(guildId) {
    if (!playerSessions.has(guildId)) {
        playerSessions.set(guildId, new Map());
    }
    return playerSessions.get(guildId);
}

/**
 * Get or create player history for a guild
 */
function getGuildHistory(guildId) {
    if (!playerHistory.has(guildId)) {
        playerHistory.set(guildId, new Map());
    }
    return playerHistory.get(guildId);
}

/**
 * Start a player session
 */
export function startPlayerSession(guildId, player) {
    const sessions = getGuildSessions(guildId);
    const history = getGuildHistory(guildId);
    
    const sessionData = {
        gamertag: player.username,
        xuid: player.xuid,
        device: player.device || null,
        joinedAt: Date.now(),
        messageCount: 0,
        deathCount: 0,
        isFirstJoin: !history.has(player.xuid)
    };
    
    sessions.set(player.xuid, sessionData);
    
    // Update history
    if (!history.has(player.xuid)) {
        history.set(player.xuid, {
            gamertag: player.username,
            xuid: player.xuid,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            totalSessions: 1,
            totalPlaytime: 0,
            totalMessages: 0,
            totalDeaths: 0,
            devices: player.device ? [player.device] : []
        });
    } else {
        const playerData = history.get(player.xuid);
        playerData.lastSeen = Date.now();
        playerData.totalSessions++;
        playerData.gamertag = player.username; // Update in case they changed it
        if (player.device && !playerData.devices.includes(player.device)) {
            playerData.devices.push(player.device);
        }
    }
    
    return sessionData;
}

/**
 * End a player session and return stats
 */
export function endPlayerSession(guildId, xuid) {
    const sessions = getGuildSessions(guildId);
    const history = getGuildHistory(guildId);
    const session = sessions.get(xuid);
    
    if (!session) return null;
    
    const sessionDuration = Date.now() - session.joinedAt;
    
    // Update history with session stats
    if (history.has(xuid)) {
        const playerData = history.get(xuid);
        playerData.totalPlaytime += sessionDuration;
        playerData.totalMessages += session.messageCount;
        playerData.totalDeaths += session.deathCount;
        playerData.lastSeen = Date.now();
    }
    
    sessions.delete(xuid);
    
    return {
        ...session,
        duration: sessionDuration,
        durationFormatted: formatDuration(sessionDuration)
    };
}

/**
 * Increment message count for a player
 */
export function trackPlayerMessage(guildId, gamertag) {
    const sessions = getGuildSessions(guildId);
    for (const [xuid, session] of sessions) {
        if (session.gamertag === gamertag) {
            session.messageCount++;
            return session;
        }
    }
    return null;
}

/**
 * Increment death count for a player
 */
export function trackPlayerDeath(guildId, gamertag) {
    const sessions = getGuildSessions(guildId);
    for (const [xuid, session] of sessions) {
        if (session.gamertag === gamertag) {
            session.deathCount++;
            return session;
        }
    }
    return null;
}

/**
 * Get player stats from history
 */
export function getPlayerStats(guildId, xuid) {
    const history = getGuildHistory(guildId);
    return history.get(xuid) || null;
}

/**
 * Get current session for a player
 */
export function getPlayerSession(guildId, xuid) {
    const sessions = getGuildSessions(guildId);
    return sessions.get(xuid) || null;
}

/**
 * Get all online players for a guild
 */
export function getOnlinePlayers(guildId) {
    const sessions = getGuildSessions(guildId);
    return Array.from(sessions.values());
}

/**
 * Clean up old/stale sessions to prevent memory leaks
 * @param {number} maxAge - Maximum age in milliseconds (default 24 hours)
 */
export function cleanupOldSessions(maxAge = MAX_SESSION_AGE) {
    const now = Date.now();
    let cleanedSessions = 0;
    let cleanedHistory = 0;
    
    // Clean up stale sessions (players that disconnected without proper cleanup)
    for (const [guildId, sessions] of playerSessions) {
        for (const [xuid, session] of sessions) {
            if (now - session.joinedAt > maxAge) {
                sessions.delete(xuid);
                cleanedSessions++;
            }
        }
        
        // Remove empty guild session maps
        if (sessions.size === 0) {
            playerSessions.delete(guildId);
        }
    }
    
    // Trim history to prevent unbounded growth
    for (const [guildId, history] of playerHistory) {
        if (history.size > MAX_HISTORY_ENTRIES) {
            // Convert to array, sort by lastSeen, keep most recent
            const entries = Array.from(history.entries())
                .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
                .slice(0, MAX_HISTORY_ENTRIES);
            
            const trimmed = history.size - entries.length;
            cleanedHistory += trimmed;
            
            history.clear();
            for (const [xuid, data] of entries) {
                history.set(xuid, data);
            }
        }
    }
    
    if (cleanedSessions > 0 || cleanedHistory > 0) {
        console.log(`[Logging] Cleaned up ${cleanedSessions} stale sessions and ${cleanedHistory} old history entries`);
    }
}

/**
 * Clear all sessions for a guild (useful when bot disconnects)
 */
export function clearGuildSessions(guildId) {
    const sessions = playerSessions.get(guildId);
    if (sessions) {
        sessions.clear();
        console.log(`[Logging] Cleared all sessions for guild ${guildId}`);
    }
}

/**
 * Format duration in ms to readable string
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Get device emoji
 */
function getDeviceEmoji(device) {
    const deviceMap = {
        'Android': '📱',
        'iOS': '🍎',
        'Windows': '💻',
        'Xbox': '🎮',
        'PlayStation': '🎮',
        'Nintendo': '🕹️',
        'Unknown': '❓'
    };
    return deviceMap[device] || '❓';
}

/**
 * Get device name from build platform
 */
export function getDeviceFromPlatform(buildPlatform) {
    const platformMap = {
        0: 'Unknown',
        1: 'Android',
        2: 'iOS',
        3: 'macOS',
        4: 'FireOS',
        5: 'GearVR',
        6: 'Hololens',
        7: 'Windows',
        8: 'Windows',
        9: 'Dedicated',
        10: 'tvOS',
        11: 'PlayStation',
        12: 'Nintendo',
        13: 'Xbox',
        14: 'Windows Phone'
    };
    return platformMap[buildPlatform] || 'Unknown';
}

const LOG_ICONS = {
    detection: '🎯',
    join: '📥',
    leave: '📤',
    ban: '🔨',
    unban: '✅',
    kick: '👢',
    command: '⚡',
    chat: '💬',
    death: '💀',
    automod: '🛡️',
    invite: '📨',
    watchlist: '👁️',
    warning: '⚠️',
    info: 'ℹ️'
};

/**
 * Central logging function - sends logs to appropriate channels
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 * @param {string} type - Log type (detection, join, leave, ban, kick, etc.)
 * @param {object} data - Log data
 */
export async function sendLog(client, guildId, type, data) {
    const config = getGuildConfig(guildId);
    const logs = config.logs || {};
    const logChannels = config.logChannels || {};
    
    // Map log types to their config keys
    const typeToConfigKey = {
        'detection': 'watchlistAlerts',
        'watchlist': 'watchlistAlerts',
        'join': 'joinsLeaves',
        'leave': 'joinsLeaves',
        'ban': 'realmBans',
        'unban': 'realmUnbans',
        'kick': 'realmKicks',
        'invite': 'realmInvites',
        'command': 'commandExecution',
        'chat': 'chatRelay',
        'death': 'playerDeaths',
        'automod': 'automod'
    };
    
    const configKey = typeToConfigKey[type] || type;
    const isEnabled = logs[configKey];
    
    // First check per-log-type channel, then fall back to legacy channels
    let channelId = logChannels[configKey];
    
    // Fallback to legacy channel settings if per-type not set
    if (!channelId) {
        if (type === 'detection' || type === 'watchlist') {
            channelId = config.detectionLogChannel;
        } else if (type === 'join' || type === 'leave' || type === 'chat' || type === 'death') {
            channelId = config.alertChannel || config.logChannel;
        } else {
            channelId = config.logChannel;
        }
    }
    
    if (!isEnabled || !channelId) return;
    
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;
        
        const embed = buildLogEmbed(type, data, client);
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error(`Failed to send ${type} log:`, error.message);
    }
}

/**
 * Build a formatted embed for a log entry
 */
function buildLogEmbed(type, data, client) {
    const color = getLogColor(type);
    
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTimestamp();
    
    switch (type) {
        case 'detection':
            embed.setTitle('🎯 Live Detection')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **XUID:** \`${data.xuid}\`\n` +
                    `> **Device:** ${getDeviceEmoji(data.device)} ${data.device || 'Unknown'}\n\n` +
                    `**Reason:** ${data.reason}`
                );
            break;
            
        case 'join':
            embed.setTitle(`📥 Player Joined${data.realmName ? ` (${data.realmName})` : ''}`)
                .setDescription(
                    `> **Gamertag:** \`${data.gamertag}\`\n` +
                    `> **Gamerscore:** ${data.gamerscore || 'N/A'}\n` +
                    `> **XUID:** \`${data.xuid || 'N/A'}\`` +
                    (data.device ? `\n> **Device:** ${getDeviceEmoji(data.device)} ${data.device}` : '')
                );
            if (data.isFirstJoin) {
                embed.setColor(COLORS.FIRST_JOIN)
                    .setTitle(`🆕 New Player Joined${data.realmName ? ` (${data.realmName})` : ''}`);
            }
            break;
            
        case 'leave':
            embed.setTitle(`📤 Player Left${data.realmName ? ` (${data.realmName})` : ''}`)
                .setDescription(
                    `> **Gamertag:** \`${data.gamertag}\`\n` +
                    `> **Gamerscore:** ${data.gamerscore || 'N/A'}\n` +
                    `> **XUID:** \`${data.xuid || 'N/A'}\`\n` +
                    `> **Playtime:** ${data.sessionDuration || 'N/A'}` +
                    (data.messageCount > 0 ? `\n> **Messages:** ${data.messageCount}` : '') +
                    (data.deathCount > 0 ? `\n> **Deaths:** ${data.deathCount}` : '')
                );
            break;
            
        case 'ban':
            embed.setTitle('🔨 Player Banned')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **XUID:** \`${data.xuid}\`\n` +
                    `> **By:** ${data.moderator ? `<@${data.moderator}>` : 'System'}` +
                    (data.reason ? `\n\n**Reason:** ${data.reason}` : '')
                );
            break;
            
        case 'unban':
            embed.setTitle('✅ Player Unbanned')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **XUID:** \`${data.xuid}\`\n` +
                    `> **By:** ${data.moderator ? `<@${data.moderator}>` : 'System'}`
                );
            break;
            
        case 'kick':
            embed.setTitle('👢 Player Kicked')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **By:** ${data.moderator ? `<@${data.moderator}>` : 'System'}` +
                    (data.reason ? `\n\n**Reason:** ${data.reason}` : '')
                );
            break;
            
        case 'invite':
            embed.setTitle('📨 Player Invited')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **Realm:** ${data.realm || 'Unknown'}\n` +
                    `> **By:** ${data.moderator ? `<@${data.moderator}>` : 'System'}`
                );
            break;
            
        case 'command':
            embed.setDescription(
                `⚡ <@${data.userId}> used \`/${data.command}\`` +
                (data.target ? `\n> **Target:** \`${data.target}\`` : '')
            )
            .setFooter({ text: `User ID: ${data.userId}` });
            break;
            
        case 'chat':
            // Check if there's a rank/tag in the message
            if (data.rank) {
                embed.setDescription(`**[${data.rank}] ${data.gamertag}:** ${data.message}`);
            } else {
                embed.setDescription(`**${data.gamertag}:** ${data.message}`);
            }
            break;
            
        case 'death':
            let deathDesc = `💀 **${data.gamertag}** died`;
            if (data.deathMessage && data.deathMessage !== data.gamertag) {
                // Parse death message for cause
                deathDesc = `💀 **${data.gamertag}** ${data.deathMessage}`;
            }
            if (data.deathCount) {
                deathDesc += `\n> Deaths this session: **${data.deathCount}**`;
            }
            embed.setDescription(deathDesc);
            break;
            
        case 'automod':
            embed.setTitle('🛡️ Automod Action')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **Action:** ${data.action.toUpperCase()}\n` +
                    `> **Rule:** ${data.rule}` +
                    (data.device ? `\n> **Device:** ${getDeviceEmoji(data.device)} ${data.device}` : '')
                );
            break;
            
        case 'watchlist':
            embed.setTitle('👁️ Watchlist Alert')
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **XUID:** \`${data.xuid}\`\n` +
                    (data.device ? `> **Device:** ${getDeviceEmoji(data.device)} ${data.device}\n` : '') +
                    `\n**Note:** ${data.note || 'No note provided'}`
                );
            break;
            
        case 'deviceChange':
            embed.setTitle('📱 Device Change Detected')
                .setColor(COLORS.DEVICE)
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **XUID:** \`${data.xuid}\`\n` +
                    `> **Old Device:** ${getDeviceEmoji(data.oldDevice)} ${data.oldDevice}\n` +
                    `> **New Device:** ${getDeviceEmoji(data.newDevice)} ${data.newDevice}`
                );
            break;
            
        case 'sessionSummary':
            embed.setTitle('📊 Session Summary')
                .setColor(COLORS.SESSION)
                .setDescription(
                    `> **Player:** \`${data.gamertag}\`\n` +
                    `> **Playtime:** ${data.playtime}\n` +
                    `> **Messages:** ${data.messageCount}\n` +
                    `> **Deaths:** ${data.deathCount}`
                );
            break;
            
        default:
            embed.setDescription(data.message || 'No details provided');
    }
    
    return embed;
}

/**
 * Get color for log type
 */
function getLogColor(type) {
    const colorMap = {
        detection: COLORS.DETECTION,
        join: COLORS.JOIN,
        leave: COLORS.LEAVE,
        ban: COLORS.BAN,
        unban: COLORS.UNBAN,
        kick: COLORS.KICK,
        command: COLORS.COMMAND,
        chat: COLORS.CHAT,
        death: COLORS.DEATH,
        automod: COLORS.WARNING,
        watchlist: COLORS.WARNING,
        invite: COLORS.INFO
    };
    return colorMap[type] || COLORS.INFO;
}

// ═══════════════════════════════════════════════════════════════
// LEGACY FUNCTIONS (kept for backwards compatibility)
// ═══════════════════════════════════════════════════════════════

/**
 * Log a live detection when a flagged player joins
 */
export async function logLiveDetection(client, guildId, player, reason) {
    await sendLog(client, guildId, 'detection', {
        gamertag: player.gamertag,
        xuid: player.xuid,
        device: player.device,
        reason
    });
}

/**
 * Check if a player is flagged and log if enabled
 */
export async function checkAndLogPlayer(client, guildId, player) {
    const check = isXuidFlagged(player.xuid);
    
    if (check.flagged) {
        await logLiveDetection(client, guildId, player, check.data.reason);
    }
    
    return check;
}

/**
 * Log an automod action
 */
export async function logAutomodAction(client, guildId, action, player, rule) {
    await sendLog(client, guildId, 'automod', {
        action,
        gamertag: player.gamertag,
        xuid: player.xuid,
        rule
    });
}

/**
 * Log a player join/leave
 */
export async function logPlayerActivity(client, guildId, player, type) {
    await sendLog(client, guildId, type, {
        gamertag: player.gamertag,
        xuid: player.xuid
    });
}

/**
 * Log command execution
 */
export async function logCommandExecution(client, guildId, command, user, target = null) {
    await sendLog(client, guildId, 'command', {
        command,
        userId: user.id,
        target
    });
}
