const { Events, EmbedBuilder, WebhookClient } = require('discord.js');
const Emojis = require('../utils/emojis');

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1445164932172877996/t76YTseWH_O6hoeV7m2cKARlxpNLeHjiXugFKZEjhMEpFYH_euiNYfDppk-Hx43dmm25';
const webhookClient = new WebhookClient({ url: WEBHOOK_URL });

module.exports = {
    name: Events.GuildDelete,
    async execute(guild) {
        console.log(`❌ Left server: ${guild.name} (${guild.id})`);

        try {
            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Left Server`)
                .setColor(0xFF0000)
                .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || null)
                .addFields(
                    { name: 'Server Name', value: guild.name || 'Unknown', inline: true },
                    { name: 'Server ID', value: guild.id, inline: true },
                    { name: 'Members', value: `${guild.memberCount || 'Unknown'}`, inline: true }
                )
                .setFooter({ text: `Total Servers: ${guild.client.guilds.cache.size}` })
                .setTimestamp();

            await webhookClient.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error sending guild leave webhook:', error);
        }
    }
};
