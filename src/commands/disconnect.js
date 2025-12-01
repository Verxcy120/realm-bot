import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { disconnectFromRealm, getBotStatus } from '../utils/minecraftBot.js';
import { getConnectedRealm, removeConnectedRealm } from '../utils/realmStorage.js';

export const data = new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from your Realm');

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    
    const connectedRealm = getConnectedRealm(guildId);
    const botStatus = getBotStatus(guildId);
    
    if (!connectedRealm && !botStatus) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ Not Connected')
            .setDescription('The bot is not connected to any Realm.')
            .setFooter({ text: 'Use /connect to join a Realm' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const realmName = connectedRealm?.name || botStatus?.realmName || 'Unknown';
    
    // Disconnect immediately (this is fast, no need to defer)
    const disconnected = disconnectFromRealm(guildId);
    
    // Remove stored connection
    removeConnectedRealm(guildId);
    
    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🔌 Disconnected')
        .setDescription(`Bot has left **${realmName}**`)
        .addFields(
            { name: '📡 Status', value: disconnected ? '✅ Disconnected instantly' : '✅ Connection cleared', inline: true }
        )
        .setFooter({ text: 'Use /connect to join again' })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
