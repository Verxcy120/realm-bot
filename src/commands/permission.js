import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, setPlayerPermissionByGamertag, setPlayerPermissionByXuid, getRealmInfo } from '../utils/realmsApi.js';

export const data = new SlashCommandBuilder()
    .setName('realm-permission')
    .setDescription('Set a player\'s permission level on your Realm')
    .addStringOption(option =>
        option.setName('realm')
            .setDescription('Select your Realm')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('gamertag')
            .setDescription('The Xbox gamertag of the player')
            .setRequired(true)
            .setAutocomplete(true))
            .addStringOption(option =>
                option.setName('permission')
                    .setDescription('The permission level to set')
                    .setRequired(true)
                    .addChoices(
                        { name: '⚡ Operator', value: 'OPERATOR' },
                        { name: '👤 Member', value: 'MEMBER' },
                        { name: '👁️ Visitor', value: 'VISITOR' }
            ));// Cache realm players to speed up autocomplete (cache for 30 seconds)
const playerCache = new Map();
const CACHE_TTL = 30000;

// Handle autocomplete for realm and gamertag options
export async function autocomplete(interaction) {
    const guildId = interaction.guild.id;
    const focusedOption = interaction.options.getFocused(true);
    
    // Single response array - we'll build it and respond once at the end
    let choices = [];
    
    try {
        if (focusedOption.name === 'realm') {
            // Check if guild is linked
            if (!isUserLinked(guildId)) {
                choices = [{ name: '⚠️ Server owner must use /setup first', value: 'not_linked' }];
            } else {
                const ownedRealms = await getOwnedRealms(guildId);
                
                if (ownedRealms.length === 0) {
                    choices = [{ name: '❌ No Realms found', value: 'no_realms' }];
                } else {
                    // Filter based on what user has typed
                    const filtered = ownedRealms.filter(realm =>
                        realm.name.toLowerCase().includes(focusedOption.value.toLowerCase())
                    );
                    
                    choices = filtered.map(realm => ({
                        name: `🏰 ${realm.name}`,
                        value: JSON.stringify({ id: realm.id, name: realm.name })
                    }));
                }
            }
        } else if (focusedOption.name === 'gamertag') {
            // Check if guild is linked
            if (!isUserLinked(guildId)) {
                choices = [{ name: '⚠️ Server not linked', value: 'not_linked' }];
            } else {
                // Get the selected realm from the options
                const realmDataStr = interaction.options.getString('realm');
                
                if (!realmDataStr || realmDataStr === 'not_linked' || realmDataStr === 'no_realms' || realmDataStr === 'error') {
                    choices = [{ name: '⚠️ Select a Realm first', value: 'no_realm_selected' }];
                } else {
                    let realmData;
                    try {
                        realmData = JSON.parse(realmDataStr);
                    } catch {
                        choices = [{ name: '⚠️ Select a valid Realm first', value: 'invalid_realm' }];
                        return await interaction.respond(choices);
                    }
                    
                    // Check cache first
                    const cacheKey = `${guildId}-${realmData.id}`;
                    const cached = playerCache.get(cacheKey);
                    let players;
                    
                    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
                        players = cached.players;
                    } else {
                        // Fetch with timeout to prevent Discord timeout
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Timeout')), 2500)
                        );
                        
                        try {
                            // Request gamertags with the realm info
                            const realmInfo = await Promise.race([
                                getRealmInfo(guildId, realmData.id, true),
                                timeoutPromise
                            ]);
                            players = realmInfo.players || [];
                            
                            // Cache the result
                            playerCache.set(cacheKey, { players, timestamp: Date.now() });
                        } catch (timeoutError) {
                            // If timeout, return hint to type manually
                            choices = [{ name: '⏳ Loading... type gamertag manually', value: focusedOption.value || 'loading' }];
                            return await interaction.respond(choices);
                        }
                    }
                    
                    if (players.length === 0) {
                        choices = [{ name: '❌ No players found on this realm', value: 'no_players' }];
                    } else {
                        // Filter based on what user has typed (search by name or XUID)
                        const searchTerm = focusedOption.value.toLowerCase();
                        const filtered = players.filter(player => {
                            const name = player.name || '';
                            const xuid = player.xuid || player.uuid || '';
                            return name.toLowerCase().includes(searchTerm) || xuid.includes(searchTerm);
                        });
                        
                        // Map permission levels to emojis
                        const permissionEmoji = {
                            'VISITOR': '👁️',
                            'MEMBER': '👤',
                            'OPERATOR': '⚡'
                        };
                        
                        // Show gamertag if available, otherwise show XUID
                        choices = filtered.slice(0, 25).map(player => {
                            const xuid = player.xuid || player.uuid;
                            const displayName = player.name || `Player ${xuid.slice(-6)}`;
                            return {
                                name: `${permissionEmoji[player.permission] || '👤'} ${displayName}`,
                                // Store both XUID and name in value for the command to use
                                value: JSON.stringify({ xuid, name: player.name })
                            };
                        });
                        
                        // If no matches but user is typing, let them use what they typed as gamertag
                        if (choices.length === 0 && focusedOption.value) {
                            choices = [{ name: `Search for: ${focusedOption.value}`, value: JSON.stringify({ gamertag: focusedOption.value }) }];
                        }
                    }
                }
            }
        }
        
        // Single respond call
        await interaction.respond(choices);
    } catch (error) {
        console.error('[Permission] Autocomplete error:', error);
        // Only respond if we haven't already
        try {
            await interaction.respond([{ name: '❌ Error loading data', value: 'error' }]);
        } catch {
            // Already responded, ignore
        }
    }
}

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    
    // Check if guild is linked
    if (!isUserLinked(guildId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ Account Not Linked')
            .setDescription('This server needs to link a Microsoft account first!')
            .setFooter({ text: 'Server owner must use /setup to link an account' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const gamertagRaw = interaction.options.getString('gamertag');
    const permission = interaction.options.getString('permission');
    const realmData = interaction.options.getString('realm');
    
    // Check for invalid realm selections
    if (realmData === 'not_linked' || realmData === 'no_realms' || realmData === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid Realm from the dropdown.')
            .setFooter({ text: 'Make sure you have linked your account with /setup' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // Check for invalid gamertag selections
    const invalidGamertags = ['not_linked', 'no_realm_selected', 'invalid_realm', 'no_players', 'error', 'loading'];
    if (invalidGamertags.includes(gamertagRaw)) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Gamertag')
            .setDescription('Please enter a valid player gamertag.')
            .setFooter({ text: 'Select a player from the dropdown or type their gamertag' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        const targetRealm = JSON.parse(realmData);
        
        // Parse the gamertag value - could be JSON with xuid or plain gamertag
        let playerXuid = null;
        let playerName = gamertagRaw;
        
        try {
            const parsed = JSON.parse(gamertagRaw);
            if (parsed.xuid) {
                playerXuid = parsed.xuid;
                playerName = parsed.name || `Player ${parsed.xuid.slice(-6)}`;
            } else if (parsed.gamertag) {
                playerName = parsed.gamertag;
            }
        } catch {
            // Not JSON, treat as plain gamertag
            playerName = gamertagRaw;
        }
        
        // Set the permission - use XUID if available, otherwise look up by gamertag
        if (playerXuid) {
            await setPlayerPermissionByXuid(guildId, targetRealm.id, playerXuid, permission);
        } else {
            await setPlayerPermissionByGamertag(guildId, targetRealm.id, playerName, permission);
        }
        
        const permissionEmoji = {
            'OPERATOR': '⚡',
            'MEMBER': '👤',
            'VISITOR': '👁️'
        };
        
        const permissionText = {
            'OPERATOR': 'Operator',
            'MEMBER': 'Member',
            'VISITOR': 'Visitor'
        };
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Permission Updated')
            .setDescription(`Successfully updated permission for **${playerName}**`)
            .addFields(
                { name: '🏰 Realm', value: targetRealm.name, inline: true },
                { name: `${permissionEmoji[permission] || '👤'} Permission`, value: permissionText[permission] || permission, inline: true },
                { name: '🎮 Player', value: playerName, inline: true }
            )
            .setFooter({ text: 'Permission change applied' })
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('[Permission] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Set Permission')
            .setDescription('Could not update the player\'s permission.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            })
            .setFooter({ text: 'Make sure the gamertag is correct and they\'ve joined the realm' });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
