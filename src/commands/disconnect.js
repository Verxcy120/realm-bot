const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser } = require('../database/db');
const { isConnected, disconnectFromRealm, getConnection } = require('../utils/realmConnection');
const Emojis = require('../utils/emojis');

// Bypass users who can run commands without being the owner
const BYPASS_USERS = ['1056287776863158312'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Disconnect the bot from the current realm'),

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

        // Check if connected
        if (!isConnected(interaction.guild.id)) {
            const notConnectedEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Not Connected`)
                .setDescription('The bot is not connected to any realm.\nUse `/connect` to connect to a realm.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [notConnectedEmbed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const connection = getConnection(interaction.guild.id);
            const realmName = connection?.realmName || 'Unknown Realm';
            
            await disconnectFromRealm(interaction.guild.id);

            const successEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Success} Disconnected`)
                .setDescription(`Successfully disconnected from **${realmName}**`)
                .setColor(0x00FF00)
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error in disconnect command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Error`)
                .setDescription(`Failed to disconnect: ${error.message}`)
                .setColor(0xFF0000);
            
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
