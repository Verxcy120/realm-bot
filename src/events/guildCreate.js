const { Events, EmbedBuilder, WebhookClient } = require('discord.js');
const Emojis = require('../utils/emojis');

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1445164932172877996/t76YTseWH_O6hoeV7m2cKARlxpNLeHjiXugFKZEjhMEpFYH_euiNYfDppk-Hx43dmm25';
const webhookClient = new WebhookClient({ url: WEBHOOK_URL });

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        console.log(`✅ Joined new server: ${guild.name} (${guild.id})`);

        try {
            // Try to create an invite link
            let inviteLink = 'Could not generate invite';
            try {
                const channels = guild.channels.cache.filter(c => c.type === 0); // Text channels
                const channel = channels.first();
                if (channel) {
                    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 });
                    inviteLink = invite.url;
                }
            } catch (e) {
                console.log('Could not create invite:', e.message);
            }

            // Get owner info
            let ownerTag = 'Unknown';
            try {
                const owner = await guild.fetchOwner();
                ownerTag = `${owner.user.tag} (${owner.user.id})`;
            } catch (e) {
                console.log('Could not fetch owner:', e.message);
            }

            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Success} Joined New Server`)
                .setColor(0x00FF00)
                .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || null)
                .addFields(
                    { name: 'Server Name', value: guild.name, inline: true },
                    { name: 'Server ID', value: guild.id, inline: true },
                    { name: 'Owner', value: ownerTag, inline: false },
                    { name: 'Members', value: `${guild.memberCount}`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Invite Link', value: inviteLink, inline: false }
                )
                .setFooter({ text: `Total Servers: ${guild.client.guilds.cache.size}` })
                .setTimestamp();

            await webhookClient.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error sending guild join webhook:', error);
        }
    }
};
