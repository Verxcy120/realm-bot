import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, getRealmInfo } from '../utils/realmsApi.js';
import { getBotStatus } from '../utils/minecraftBot.js';
import { getConnectedRealm } from '../utils/realmStorage.js';

export const data = new SlashCommandBuilder()
    .setName('realm-players')
    .setDescription('List all players on your Realm')
    .addStringOption(option =>
        option.setName('realm')
            .setDescription('Select your Realm (leave empty for connected realm)')
            .setRequired(false)
            .setAutocomplete(true));

export async function autocomplete(interaction) {
    const guildId = interaction.guild.id;
    let choices = [];
    
    try {
        if (!isUserLinked(guildId)) {
            choices = [{ name: '⚠️ Server owner must use /setup first', value: 'not_linked' }];
        } else {
            const ownedRealms = await getOwnedRealms(guildId);
            
            if (ownedRealms.length === 0) {
                choices = [{ name: '❌ No Realms found', value: 'no_realms' }];
            } else {
                const focusedValue = interaction.options.getFocused().toLowerCase();
                const filtered = ownedRealms.filter(realm =>
                    realm.name.toLowerCase().includes(focusedValue)
                );
                
                choices = filtered.map(realm => ({
                    name: `🏰 ${realm.name}`,
                    value: JSON.stringify({ id: realm.id, name: realm.name })
                }));
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    } catch (error) {
        console.error('[RealmPlayers] Autocomplete error:', error);
        try {
            await interaction.respond([{ name: '❌ Error loading realms', value: 'error' }]);
        } catch {
            // Already responded
        }
    }
}

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    
    if (!isUserLinked(guildId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ Account Not Linked')
            .setDescription('This server needs to link a Microsoft account first!')
            .setFooter({ text: 'Server owner must use /setup to link an account' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    let realmData = interaction.options.getString('realm');
    
    // If no realm specified, try to use connected realm
    if (!realmData) {
        const connectedRealm = getConnectedRealm(guildId);
        if (connectedRealm) {
            realmData = JSON.stringify({ id: connectedRealm.id, name: connectedRealm.name });
        } else {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ No Realm Selected')
                .setDescription('Please select a Realm or connect the bot to one first.')
                .setFooter({ text: 'Use /connect to connect to a Realm' });
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    }
    
    if (realmData === 'not_linked' || realmData === 'no_realms' || realmData === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid Realm from the dropdown.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        const targetRealm = JSON.parse(realmData);
        
        // Get realm info which includes invited players
        const realmInfo = await getRealmInfo(guildId, targetRealm.id, true);
        const allPlayers = realmInfo.players || [];
        
        // Get online players from bot if connected
        const botStatus = getBotStatus(guildId);
        const onlinePlayers = botStatus?.players || [];
        const onlineUsernames = new Set(onlinePlayers.map(p => p.username?.toLowerCase()));
        
        // Categorize players
        const online = allPlayers.filter(p => 
            p.name && onlineUsernames.has(p.name.toLowerCase())
        );
        const offline = allPlayers.filter(p => 
            p.name && !onlineUsernames.has(p.name.toLowerCase())
        );
        
        // Build player lists
        let onlineList = online.map(p => `🟢 ${p.name}`).join('\n') || 'No players online';
        let offlineList = offline.slice(0, 20).map(p => `⚫ ${p.name}`).join('\n') || 'None';
        
        if (offline.length > 20) {
            offlineList += `\n... and ${offline.length - 20} more`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`👥 Players on ${targetRealm.name}`)
            .addFields(
                { name: `🟢 Online (${online.length})`, value: onlineList, inline: true },
                { name: `⚫ Offline (${offline.length})`, value: offlineList, inline: true },
                { name: '📊 Total Invited', value: `${allPlayers.length} players`, inline: false }
            )
            .setFooter({ text: botStatus?.status === 'connected' ? 'Bot is connected - showing live online status' : 'Bot not connected - showing invited players only' })
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('[RealmPlayers] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Get Player List')
            .setDescription('Could not retrieve player information.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
