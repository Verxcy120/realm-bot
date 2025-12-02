const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getUser } = require('../database/db');
const { getAuthflow } = require('../auth/xboxAuth');
const { RealmAPI } = require('prismarine-realms');
const Emojis = require('../utils/emojis');
const { isConnected } = require('../utils/realmConnection');

// Bypass users who can run commands without being the owner
const BYPASS_USERS = ['1056287776863158312'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('connect')
        .setDescription('Connect the bot to a realm for logging and management'),

    async execute(interaction) {
        // Check if user has bypass or is server owner
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        const hasBypass = BYPASS_USERS.includes(interaction.user.id);
        
        if (!isOwner && !hasBypass) {
            const noPermEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Permission Denied`)
                .setDescription('Only the server owner can use this command.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
        }

        // Check if already connected
        if (isConnected(interaction.guild.id)) {
            const alreadyConnectedEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Already Connected`)
                .setDescription('The bot is already connected to a realm. Use `/disconnect` first.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [alreadyConnectedEmbed], ephemeral: true });
        }

        // Check if user has linked their account
        const userData = getUser(interaction.user.id, interaction.guild.id);
        
        if (!userData || !userData.xbox_gamertag) {
            const noAccountEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} No Account Linked`)
                .setDescription('You need to link your Microsoft account first.\nUse `/setup` to link your account.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [noAccountEmbed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Get user's realms
            const authflow = getAuthflow(interaction.user.id);
            const api = RealmAPI.from(authflow, 'bedrock');
            const realms = await api.getRealms();

            if (!realms || realms.length === 0) {
                const noRealmsEmbed = new EmbedBuilder()
                    .setTitle(`${Emojis.Error} No Realms Found`)
                    .setDescription('No Bedrock realms found on your account.')
                    .setColor(0xFF0000);
                return interaction.editReply({ embeds: [noRealmsEmbed] });
            }

            // Create dropdown menu
            const options = realms.slice(0, 25).map(realm => ({
                label: realm.name.slice(0, 100),
                description: `ID: ${realm.id} | ${realm.state || 'Unknown'}`.slice(0, 100),
                value: `connect_realm_${realm.id}`,
                emoji: realm.state === 'OPEN' ? Emojis.Online : Emojis.Offline
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('connect_realm_select')
                .setPlaceholder('Select a realm to connect to...')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const selectEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Realm} Connect to Realm`)
                .setDescription('Select a realm from the dropdown to connect the bot.\n\n**Note:** The bot will join the realm and relay events to configured channels.')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Found Realms', value: `${realms.length}`, inline: true },
                    { name: 'Account', value: userData.xbox_gamertag, inline: true }
                )
                .setFooter({ text: 'The bot will stay connected until you disconnect it.' });

            await interaction.editReply({
                embeds: [selectEmbed],
                components: [row]
            });

        } catch (error) {
            console.error('Error in connect command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Error`)
                .setDescription(`Failed to fetch realms: ${error.message}`)
                .setColor(0xFF0000);
            
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
