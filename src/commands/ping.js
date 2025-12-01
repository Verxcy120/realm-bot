import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getDatabaseStats } from '../utils/database.js';

export const data = new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency and connection status');

export async function execute(interaction) {
    const start = Date.now();
    const wsLatency = interaction.client.ws.ping;
    
    // Check database latency
    const dbStart = Date.now();
    try {
        getDatabaseStats();
    } catch {}
    const dbLatency = Date.now() - dbStart;
    
    // Calculate response time after initial processing
    const responseTime = Date.now() - start;
    
    // Overall status based on worst metric
    const worstPing = Math.max(wsLatency, responseTime);
    const overallColor = worstPing < 100 ? 0x57F287 : worstPing < 200 ? 0xFEE75C : 0xED4245;
    
    // Get status emoji
    const getStatusEmoji = (ms) => {
        if (ms < 100) return '🟢';
        if (ms < 200) return '🟡';
        return '🔴';
    };
    
    const embed = new EmbedBuilder()
        .setColor(overallColor)
        .setAuthor({ 
            name: '🏓 Pong!', 
            iconURL: interaction.client.user.displayAvatarURL() 
        })
        .setDescription(
            `**WebSocket:** ${getStatusEmoji(wsLatency)} \`${wsLatency}ms\`\n` +
            `**API Response:** ${getStatusEmoji(responseTime)} \`${responseTime}ms\`\n` +
            `**Database:** ${getStatusEmoji(dbLatency)} \`${dbLatency}ms\``
        )
        .setFooter({ 
            text: `${interaction.guild?.name || 'Direct Message'}`,
            iconURL: interaction.guild?.iconURL() || undefined
        })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}
