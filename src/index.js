import { Client, GatewayIntentBits, Collection, MessageFlags, REST, Routes, ActivityType } from 'discord.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import { handleConfigInteraction, handleConfigModal } from './commands/config.js';
import { logCommandExecution, sendLog, startPlayerSession, endPlayerSession, trackPlayerMessage, trackPlayerDeath, getDeviceFromPlatform, cleanupOldSessions } from './utils/logging.js';
import { getXboxProfile } from './utils/realmsApi.js';
import { botEvents, getActiveBots, disconnectFromRealm, automodConfig } from './utils/minecraftBot.js';
import { getConnectedRealm } from './utils/realmStorage.js';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Don't exit - try to keep running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - try to keep running
});

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

// Collection to store commands
client.commands = new Collection();

// Load commands and return array for registration
async function loadCommands() {
    const commandsPath = join(__dirname, 'commands');
    const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    const commandsJson = [];

    for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const command = await import(`file://${filePath}`);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commandsJson.push(command.data.toJSON());
            console.log(`✅ Loaded command: ${command.data.name}`);
        } else {
            console.log(`⚠️ Command at ${filePath} is missing "data" or "execute" property`);
        }
    }
    
    return commandsJson;
}

// Register slash commands with Discord
async function registerCommands(commands) {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log(`🔄 Registering ${commands.length} slash commands...`);
        
        if (process.env.DISCORD_GUILD_ID) {
            // Register to specific guild (instant)
            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.DISCORD_CLIENT_ID,
                    process.env.DISCORD_GUILD_ID
                ),
                { body: commands }
            );
            console.log(`✅ Commands registered to guild!`);
        } else {
            // Register globally (can take up to 1 hour)
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: commands }
            );
            console.log(`✅ Commands registered globally!`);
        }
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// Handle interactions
client.on('interactionCreate', async interaction => {
    // Handle autocomplete
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        
        if (!command || !command.autocomplete) {
            return;
        }
        
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(`Error in autocomplete for ${interaction.commandName}:`, error);
        }
        return;
    }
    
    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        try {
            if (interaction.customId.startsWith('config_')) {
                await handleConfigModal(interaction);
            }
        } catch (error) {
            console.error('Error handling modal:', error);
        }
        return;
    }
    
    // Handle button and select menu interactions
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
        try {
            if (interaction.customId.startsWith('config_')) {
                await handleConfigInteraction(interaction);
            }
            // Add other component handlers here
        } catch (error) {
            console.error('Error handling component:', error);
        }
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
        
        // Log command execution if in a guild
        if (interaction.guild) {
            const target = interaction.options?.getString('gamertag') || 
                          interaction.options?.getString('xuid') || 
                          interaction.options?.getUser('user')?.tag ||
                          null;
            await logCommandExecution(client, interaction.guild.id, interaction.commandName, interaction.user, target);
        }
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        
        const errorMessage = { 
            content: '❌ There was an error executing this command!', 
            flags: MessageFlags.Ephemeral 
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

// Bot ready event
client.once('clientReady', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`📡 Serving ${client.guilds.cache.size} servers`);
    
    // Set bot status
    updateBotPresence();
    
    // Set up Minecraft bot event listeners for logging
    setupMinecraftBotLogging();
    
    // Clean up old sessions periodically (every hour)
    setInterval(() => {
        cleanupOldSessions(24 * 60 * 60 * 1000); // Clean sessions older than 24 hours
    }, 60 * 60 * 1000);
});

// ═══════════════════════════════════════════════════════════════
// BOT PRESENCE AND STATUS
// ═══════════════════════════════════════════════════════════════

function updateBotPresence() {
    const activeBots = getActiveBots();
    const connectedCount = Array.from(activeBots.values()).filter(b => b.status === 'connected').length;
    
    client.user.setPresence({
        activities: [{
            name: connectedCount > 0 ? `${connectedCount} realm${connectedCount > 1 ? 's' : ''}` : 'for realms',
            type: connectedCount > 0 ? ActivityType.Watching : ActivityType.Listening
        }],
        status: 'online'
    });
}

// ═══════════════════════════════════════════════════════════════
// MINECRAFT BOT EVENT LOGGING
// ═══════════════════════════════════════════════════════════════

// Track connected realm names per guild
const connectedRealmNames = new Map();

function setupMinecraftBotLogging() {
    // Chat messages from the realm
    botEvents.on('chat', async ({ discordUserId, sender, message, rank, type }) => {
        try {
            const guildId = discordUserId;
            console.log(`[Logging] Chat event - Guild: ${guildId}, Sender: ${sender}, Rank: ${rank || 'None'}, Message: ${message}`);
            
            // Track message for session stats
            trackPlayerMessage(guildId, sender);
            
            await sendLog(client, guildId, 'chat', {
                gamertag: sender,
                message: message,
                rank: rank || null,
                xuid: 'N/A'
            });
        } catch (error) {
            console.error('[Logging] Chat log error:', error.message);
        }
    });
    
    // Player joined the realm
    botEvents.on('playerJoin', async ({ discordUserId, player }) => {
        try {
            const guildId = discordUserId;
            const realmName = connectedRealmNames.get(guildId) || null;
            console.log(`[Logging] Join event - Guild: ${guildId}, Player: ${player.username}, Device: ${player.device || 'Unknown'}`);
            
            // Start session tracking
            const session = startPlayerSession(guildId, player);
            
            // Fetch gamerscore from Xbox API
            let gamerscore = 'N/A';
            if (player.xuid && player.xuid !== 'N/A') {
                try {
                    const profile = await getXboxProfile(guildId, player.xuid);
                    gamerscore = profile?.gamerscore || 'N/A';
                } catch (e) {
                    console.log(`[Logging] Could not fetch gamerscore: ${e.message}`);
                }
            }
            
            await sendLog(client, guildId, 'join', {
                gamertag: player.username,
                xuid: player.xuid || 'N/A',
                gamerscore: gamerscore,
                device: player.device || null,
                isFirstJoin: session.isFirstJoin,
                realmName: realmName
            });
        } catch (error) {
            console.error('[Logging] Join log error:', error.message);
        }
    });
    
    // Player left the realm
    botEvents.on('playerLeave', async ({ discordUserId, player }) => {
        try {
            const guildId = discordUserId;
            const realmName = connectedRealmNames.get(guildId) || null;
            console.log(`[Logging] Leave event - Guild: ${guildId}, Player: ${player.username}`);
            
            // End session and get stats
            const sessionStats = endPlayerSession(guildId, player.xuid);
            
            // Fetch gamerscore from Xbox API
            let gamerscore = 'N/A';
            if (player.xuid && player.xuid !== 'N/A') {
                try {
                    const profile = await getXboxProfile(guildId, player.xuid);
                    gamerscore = profile?.gamerscore || 'N/A';
                } catch (e) {
                    console.log(`[Logging] Could not fetch gamerscore: ${e.message}`);
                }
            }
            
            await sendLog(client, guildId, 'leave', {
                gamertag: player.username,
                xuid: player.xuid || 'N/A',
                gamerscore: gamerscore,
                sessionDuration: sessionStats?.durationFormatted || 'N/A',
                messageCount: sessionStats?.messageCount || 0,
                deathCount: sessionStats?.deathCount || 0,
                realmName: realmName
            });
        } catch (error) {
            console.error('[Logging] Leave log error:', error.message);
        }
    });
    
    // Bot connected to realm - store realm name
    botEvents.on('connected', async ({ discordUserId, realmInfo }) => {
        console.log(`[Logging] Bot connected to ${realmInfo.name} for guild ${discordUserId}`);
        connectedRealmNames.set(discordUserId, realmInfo.name);
        updateBotPresence();
    });
    
    // Bot disconnected from realm
    botEvents.on('disconnected', async ({ discordUserId, realmInfo }) => {
        console.log(`[Logging] Bot disconnected from ${realmInfo?.name || 'realm'} for guild ${discordUserId}`);
        connectedRealmNames.delete(discordUserId);
        updateBotPresence();
    });
    
    // Bot was kicked
    botEvents.on('kicked', async ({ discordUserId, reason }) => {
        console.log(`[Logging] Bot kicked from realm for guild ${discordUserId}: ${reason}`);
        connectedRealmNames.delete(discordUserId);
        updateBotPresence();
    });
    
    // Bot error
    botEvents.on('error', async ({ discordUserId, error }) => {
        console.error(`[Logging] Bot error for guild ${discordUserId}:`, error?.message || error);
        updateBotPresence();
    });
    
    // Player deaths
    botEvents.on('death', async ({ discordUserId, player, message, cause }) => {
        try {
            const guildId = discordUserId;
            console.log(`[Logging] Death event - Guild: ${guildId}, Player: ${player}, Cause: ${cause}`);
            
            // Track death for session stats
            const session = trackPlayerDeath(guildId, player);
            
            await sendLog(client, guildId, 'death', {
                gamertag: player,
                deathMessage: cause,
                deathCount: session?.deathCount || 1
            });
        } catch (error) {
            console.error('[Logging] Death log error:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════════════
    // AUTOMOD - Log ban actions (ban is done directly in minecraftBot.js)
    // ═══════════════════════════════════════════════════════════════
    botEvents.on('automodBan', async ({ discordUserId, realmInfo, player, reason, trigger, success, error }) => {
        try {
            const guildId = discordUserId;
            
            if (success) {
                console.log(`[Logging] Automod ban successful: ${player.username} - ${reason}`);
                
                // Log the automod action
                await sendLog(client, guildId, 'automod', {
                    gamertag: player.username,
                    xuid: player.xuid,
                    action: 'ban',
                    rule: reason,
                    device: player.device || 'Unknown'
                });
                
                // Also log as a ban
                await sendLog(client, guildId, 'ban', {
                    gamertag: player.username,
                    xuid: player.xuid,
                    moderator: null,  // System ban
                    reason: `[Automod] ${reason} (${trigger})`
                });
            } else {
                console.error(`[Logging] Automod ban failed: ${player.username} - ${error}`);
            }
            
        } catch (err) {
            console.error(`[Logging] Failed to log automod action:`, err.message);
        }
    });
    
    // Automod actions (skin checks, anti-alts, etc.)
    botEvents.on('automodAction', async ({ discordUserId, realmInfo, player, action, reason, rule, success, error }) => {
        try {
            const guildId = discordUserId;
            
            if (success) {
                console.log(`[Logging] Automod ${action} successful: ${player.username} - ${rule}: ${reason}`);
                
                // Log the automod action
                await sendLog(client, guildId, 'automod', {
                    gamertag: player.username,
                    xuid: player.xuid,
                    action: action,
                    rule: `${rule}: ${reason}`,
                    device: player.device || 'Unknown'
                });
                
                // Also log as ban if it was a ban action
                if (action === 'ban') {
                    await sendLog(client, guildId, 'ban', {
                        gamertag: player.username,
                        xuid: player.xuid,
                        moderator: null,
                        reason: `[Automod] ${rule}: ${reason}`
                    });
                }
            } else {
                console.error(`[Logging] Automod ${action} failed: ${player.username} - ${error}`);
            }
            
        } catch (err) {
            console.error(`[Logging] Failed to log automod action:`, err.message);
        }
    });
    
    // Realm crashed event
    botEvents.on('realmCrashed', async ({ discordUserId, realmInfo, reason, lastPlayer }) => {
        console.log(`[Logging] Realm ${realmInfo.name} CRASHED for guild ${discordUserId}. Reason: ${reason}`);
        if (lastPlayer) {
            console.log(`[Logging] Last player to join before crash: ${lastPlayer.username} (${lastPlayer.xuid})`);
        }
        connectedRealmNames.delete(discordUserId);
        updateBotPresence();
    });
    
    // Realm closed event  
    botEvents.on('realmClosed', async ({ discordUserId, realmInfo, reason, lastPlayer }) => {
        console.log(`[Logging] Realm ${realmInfo.name} CLOSED for guild ${discordUserId}. Reason: ${reason}`);
        if (lastPlayer) {
            console.log(`[Logging] Last player to join before close: ${lastPlayer.username} (${lastPlayer.xuid})`);
        }
        connectedRealmNames.delete(discordUserId);
        updateBotPresence();
    });
    
    console.log('📋 Minecraft bot logging initialized');
    console.log(`🛡️ Automod Config: Type=${automodConfig.type}, Message=${automodConfig.message}, BanOnCrash=${automodConfig.banOnCrash}`);
}

// Start the bot
async function main() {
    const commands = await loadCommands();
    await registerCommands(commands);
    await client.login(process.env.DISCORD_TOKEN);
}

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════

async function gracefulShutdown(signal) {
    console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);
    
    // Disconnect all Minecraft bots
    const activeBots = getActiveBots();
    for (const [discordUserId, botData] of activeBots) {
        console.log(`🔌 Disconnecting bot for guild ${discordUserId}...`);
        try {
            disconnectFromRealm(discordUserId);
        } catch (error) {
            console.error(`Failed to disconnect bot for ${discordUserId}:`, error.message);
        }
    }
    
    // Destroy Discord client
    console.log('🔌 Disconnecting Discord client...');
    client.destroy();
    
    console.log('✅ Shutdown complete');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().catch(console.error);
