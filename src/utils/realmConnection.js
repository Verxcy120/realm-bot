const bedrock = require('bedrock-protocol');
const { getAuthflow } = require('../auth/xboxAuth');
const { RealmAPI } = require('prismarine-realms');
const { saveActiveConnection, deleteActiveConnection, getGuildSettings } = require('../database/db');
const { EmbedBuilder } = require('discord.js');
const Emojis = require('../utils/emojis');

// Store active connections: Map<guildId, { client, realmId, realmName }>
const activeConnections = new Map();

// Discord client reference (set from index.js)
let discordClient = null;

function setDiscordClient(client) {
    discordClient = client;
}

async function connectToRealm(guildId, realmId, userData, connectedBy) {
    // Check if already connected
    if (activeConnections.has(guildId)) {
        throw new Error('Already connected to a realm. Use /disconnect first.');
    }

    try {
        const authflow = getAuthflow(userData.discord_id);
        const api = RealmAPI.from(authflow, 'bedrock');
        
        // Get realm info
        const realm = await api.getRealm(realmId);
        const realmName = realm.name;
        
        // Get realm address
        const address = await realm.getAddress();
        
        // Create bedrock client
        const client = bedrock.createClient({
            host: address.host,
            port: address.port,
            username: userData.xbox_gamertag,
            offline: false,
            authFlow: authflow
        });

        // Store connection info
        const connectionInfo = {
            client,
            realmId,
            realmName,
            guildId,
            connectedBy,
            connectedAt: Date.now()
        };

        // Set up event handlers
        setupEventHandlers(client, guildId, realmName);

        // Wait for spawn event to confirm connection
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                client.close();
                reject(new Error('Connection timed out'));
            }, 30000);

            client.once('spawn', () => {
                clearTimeout(timeout);
                activeConnections.set(guildId, connectionInfo);
                saveActiveConnection(guildId, realmId, realmName, connectedBy);
                console.log(`✅ Connected to realm: ${realmName} for guild: ${guildId}`);
                resolve({ realmName, realmId });
            });

            client.once('error', (err) => {
                clearTimeout(timeout);
                console.error('Connection error:', err);
                reject(err);
            });

            client.once('close', () => {
                clearTimeout(timeout);
                if (!activeConnections.has(guildId)) {
                    reject(new Error('Connection closed unexpectedly'));
                }
            });
        });

    } catch (error) {
        console.error('Failed to connect to realm:', error);
        throw error;
    }
}

async function disconnectFromRealm(guildId) {
    const connection = activeConnections.get(guildId);
    
    if (!connection) {
        throw new Error('Not connected to any realm.');
    }

    try {
        connection.client.close();
        activeConnections.delete(guildId);
        deleteActiveConnection(guildId);
        console.log(`🔌 Disconnected from realm for guild: ${guildId}`);
        return { realmName: connection.realmName };
    } catch (error) {
        console.error('Failed to disconnect:', error);
        // Still remove from map even if close fails
        activeConnections.delete(guildId);
        deleteActiveConnection(guildId);
        throw error;
    }
}

function setupEventHandlers(client, guildId, realmName) {
    const settings = getGuildSettings(guildId);

    // Handle chat messages
    client.on('text', async (packet) => {
        if (!discordClient || !settings?.chat_relay_channel) return;
        
        // Ignore system messages from bot
        if (packet.source_name === client.username) return;
        
        try {
            const channel = await discordClient.channels.fetch(settings.chat_relay_channel);
            if (channel) {
                // Filter different message types
                if (packet.type === 'chat' || packet.type === 'whisper' || packet.type === 'announcement') {
                    const embed = new EmbedBuilder()
                        .setDescription(`**${packet.source_name}**: ${packet.message}`)
                        .setColor(0x5865F2)
                        .setTimestamp();
                    
                    await channel.send({ embeds: [embed] });
                }
            }
        } catch (err) {
            console.error('Error sending chat relay:', err);
        }
    });

    // Handle player join/leave
    client.on('player_list', async (packet) => {
        if (!discordClient || !settings?.join_leave_channel) return;
        
        try {
            const channel = await discordClient.channels.fetch(settings.join_leave_channel);
            if (!channel) return;

            for (const record of packet.records.records || []) {
                if (packet.records.type === 'add') {
                    const embed = new EmbedBuilder()
                        .setTitle(`${Emojis.Online} Player Joined`)
                        .setDescription(`**${record.username}** joined **${realmName}**`)
                        .setColor(0x00FF00)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                } else if (packet.records.type === 'remove') {
                    const embed = new EmbedBuilder()
                        .setTitle(`${Emojis.Offline} Player Left`)
                        .setDescription(`**${record.username}** left **${realmName}**`)
                        .setColor(0xFF0000)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                }
            }
        } catch (err) {
            console.error('Error sending join/leave log:', err);
        }
    });

    // Handle deaths
    client.on('death_info', async (packet) => {
        if (!discordClient || !settings?.death_log_channel) return;
        
        try {
            const channel = await discordClient.channels.fetch(settings.death_log_channel);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('☠️ Player Death')
                    .setDescription(packet.message || 'A player died')
                    .setColor(0x000000)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            console.error('Error sending death log:', err);
        }
    });

    // Handle disconnect
    client.on('close', () => {
        console.log(`Connection closed for guild: ${guildId}`);
        activeConnections.delete(guildId);
        deleteActiveConnection(guildId);
    });

    client.on('error', (err) => {
        console.error(`Connection error for guild ${guildId}:`, err);
    });
}

function getConnection(guildId) {
    return activeConnections.get(guildId);
}

function isConnected(guildId) {
    return activeConnections.has(guildId);
}

// Kick a player from the realm (requires being connected)
async function kickPlayer(guildId, playerName) {
    const connection = activeConnections.get(guildId);
    
    if (!connection) {
        throw new Error('Not connected to any realm. Use /connect first.');
    }

    try {
        // Send kick command through chat
        connection.client.queue('command_request', {
            command: `kick "${playerName}"`,
            origin: {
                type: 'player',
                uuid: '',
                request_id: ''
            },
            internal: false,
            version: 52
        });
        
        return { playerName, realmName: connection.realmName };
    } catch (error) {
        console.error('Failed to kick player:', error);
        throw error;
    }
}

// Send a command to the realm
async function sendCommand(guildId, command) {
    const connection = activeConnections.get(guildId);
    
    if (!connection) {
        throw new Error('Not connected to any realm.');
    }

    connection.client.queue('command_request', {
        command: command,
        origin: {
            type: 'player',
            uuid: '',
            request_id: ''
        },
        internal: false,
        version: 52
    });
}

module.exports = {
    setDiscordClient,
    connectToRealm,
    disconnectFromRealm,
    getConnection,
    isConnected,
    kickPlayer,
    sendCommand,
    activeConnections
};
