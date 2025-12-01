import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getBotStatus, runCommand } from '../utils/minecraftBot.js';
import { getConnectedRealm } from '../utils/realmStorage.js';
import { sendLog } from '../utils/logging.js';

export const data = new SlashCommandBuilder()
    .setName('realm-kick')
    .setDescription('Kick a player from the Realm (requires bot to be connected and OP)')
    .addStringOption(option =>
        option.setName('player')
            .setDescription('The player to kick (gamertag)')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for the kick')
            .setRequired(false));

export async function autocomplete(interaction) {
    const guildId = interaction.guild.id;
    let choices = [];
    
    try {
        if (!isUserLinked(guildId)) {
            choices = [{ name: '⚠️ Server owner must use /setup first', value: 'not_linked' }];
        } else {
            const botStatus = getBotStatus(guildId);
            
            if (!botStatus || botStatus.status !== 'connected') {
                choices = [{ name: '⚠️ Bot not connected to realm', value: 'not_connected' }];
            } else if (botStatus.players && botStatus.players.length > 0) {
                const focusedValue = interaction.options.getFocused().toLowerCase();
                const filtered = botStatus.players
                    .filter(p => p.username && p.username.toLowerCase().includes(focusedValue))
                    .slice(0, 25);
                
                choices = filtered.map(p => ({
                    name: `🎮 ${p.username}`,
                    value: p.username
                }));
                
                if (choices.length === 0) {
                    choices = [{ name: '❌ No matching players', value: 'no_match' }];
                }
            } else {
                choices = [{ name: '❌ No players online', value: 'no_players' }];
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    } catch (error) {
        console.error('[RealmKick] Autocomplete error:', error);
        try {
            await interaction.respond([{ name: '❌ Error loading players', value: 'error' }]);
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
    
    const connectedRealm = getConnectedRealm(guildId);
    if (!connectedRealm) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Bot Not Connected')
            .setDescription('The bot is not connected to any Realm!')
            .setFooter({ text: 'Use /connect to connect the bot to a Realm first' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const botStatus = getBotStatus(guildId);
    if (!botStatus || botStatus.status !== 'connected') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Bot Not Online')
            .setDescription('The bot is not currently online on the Realm!')
            .addFields({ name: 'Status', value: botStatus?.status || 'disconnected' })
            .setFooter({ text: 'Use /connect to reconnect the bot' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const player = interaction.options.getString('player');
    const reason = interaction.options.getString('reason') || 'Kicked by admin';
    
    if (player === 'not_linked' || player === 'not_connected' || player === 'no_players' || player === 'no_match' || player === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid player from the dropdown.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    try {
        // Use Minecraft kick command
        const kickCommand = `kick "${player}" ${reason}`;
        const success = runCommand(guildId, kickCommand);
        
        if (success) {
            // Log the kick action (fire and forget)
            sendLog(interaction.client, guildId, 'kick', {
                gamertag: player,
                xuid: 'N/A',
                moderator: interaction.user.id,
                reason: reason
            }).catch(() => {});
            
            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('👢 Player Kicked!')
                .setDescription(`**${player}** has been kicked from **${connectedRealm.name}**!`)
                .addFields(
                    { name: '🎮 Player', value: player, inline: true },
                    { name: '📝 Reason', value: reason, inline: true }
                )
                .setFooter({ text: 'Player can rejoin unless banned' })
                .setTimestamp();
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
            throw new Error('Failed to send kick command to bot');
        }
        
    } catch (error) {
        console.error('[RealmKick] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Kick Player')
            .setDescription('Could not kick the player from the Realm.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}
