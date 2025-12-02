const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getAuthflow } = require('../auth/xboxAuth');
const { getUserByGuild } = require('../database/db');
const { RealmAPI } = require('prismarine-realms');
const Emojis = require('../utils/emojis');

// Users who can bypass the owner check
const BYPASS_USERS = ['1056287776863158312'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('realmopen')
        .setDescription('Open your Realm to allow players to join'),
    
    async execute(interaction) {
        // Check if in a guild
        if (!interaction.guild) {
            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Server Only`)
                .setDescription('This command can only be used in a server.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Check if user is the guild owner or has bypass
        if (interaction.user.id !== interaction.guild.ownerId && !BYPASS_USERS.includes(interaction.user.id)) {
            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Locked} Owner Only`)
                .setDescription('Only the server owner can use Realm management commands.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Lunar • Contact your server owner' });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Check if guild has a linked account
        const userData = getUserByGuild(interaction.guild.id);
        if (!userData) {
            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} No Account Linked`)
                .setDescription('No Microsoft account is linked to this server. Use `/setup` first.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Lunar • Setup required' });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const authflow = getAuthflow(userData.discord_id);
            const api = RealmAPI.from(authflow, 'bedrock');

            // Fetch user's realms
            const realms = await api.getRealms();
            const ownedRealms = realms.filter(realm => realm.ownerUUID === userData.xbox_xuid);

            if (ownedRealms.length === 0) {
                const noRealmsEmbed = new EmbedBuilder()
                    .setTitle(`${Emojis.Error} No Realms Found`)
                    .setDescription('You don\'t own any Realms to manage.')
                    .setColor(0xFF0000)
                    .setFooter({ text: 'Lunar • No realms available' });
                return interaction.editReply({ embeds: [noRealmsEmbed] });
            }

            // Create realm selection dropdown
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('realm_open')
                .setPlaceholder('Select a Realm to open')
                .addOptions(
                    ownedRealms.map(realm => ({
                        label: realm.name.substring(0, 100),
                        description: `State: ${realm.state} • ID: ${realm.id}`,
                        value: realm.id.toString(),
                        emoji: realm.state === 'OPEN' ? '🟢' : '🔴'
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const selectEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Realms} Open Realm`)
                .setDescription('Select which Realm you want to **open**.\n\nOpening a Realm allows players to join.')
                .setColor(0x00FF00)
                .setFooter({ text: 'Lunar • Select a realm below' });

            await interaction.editReply({ embeds: [selectEmbed], components: [row] });

        } catch (error) {
            console.error('Realm open error:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Command Failed`)
                .setDescription(error.message || 'Failed to fetch your Realms.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Lunar • Please try again' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
