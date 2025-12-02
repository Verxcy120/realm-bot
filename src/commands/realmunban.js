const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getAuthflow } = require('../auth/xboxAuth');
const { getUserByGuild } = require('../database/db');
const { RealmAPI } = require('prismarine-realms');
const Emojis = require('../utils/emojis');

// Helper function to get XUID from gamertag
async function getXuidFromGamertag(authflow, gamertag) {
    try {
        const token = await authflow.getXboxToken();
        const response = await fetch(`https://profile.xboxlive.com/users/gt(${encodeURIComponent(gamertag)})/profile/settings`, {
            headers: {
                'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
                'x-xbl-contract-version': '2',
                'Accept-Language': 'en-US'
            }
        });
        
        if (!response.ok) {
            throw new Error('Player not found');
        }
        
        const data = await response.json();
        return data.profileUsers[0].id;
    } catch (error) {
        console.error('Error fetching XUID:', error);
        throw new Error(`Could not find player "${gamertag}". Make sure the gamertag is correct.`);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('realmunban')
        .setDescription('Unban a player from your Realm')
        .addStringOption(option =>
            option.setName('gamertag')
                .setDescription('The Xbox Gamertag of the player to unban')
                .setRequired(true)),
    
    async execute(interaction) {
        // Check if in a guild
        if (!interaction.guild) {
            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Server Only`)
                .setDescription('This command can only be used in a server.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Check if user is the guild owner
        if (interaction.user.id !== interaction.guild.ownerId) {
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

        const gamertag = interaction.options.getString('gamertag');

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

            // Get XUID from gamertag
            const xuid = await getXuidFromGamertag(authflow, gamertag);

            // Create realm selection dropdown
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`realmunban_${xuid}_${gamertag}`)
                .setPlaceholder('Select a Realm to unban the player from')
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
                .setTitle(`${Emojis.Realms} Select Realm`)
                .setDescription(`Select which Realm to unban **${gamertag}** from.`)
                .setColor(0x5865F2)
                .addFields(
                    { name: `${Emojis.Crown} Player`, value: `\`${gamertag}\``, inline: true },
                    { name: `${Emojis.Link} XUID`, value: `\`${xuid}\``, inline: true }
                )
                .setFooter({ text: 'Lunar • Select a realm below' });

            await interaction.editReply({ embeds: [selectEmbed], components: [row] });

        } catch (error) {
            console.error('Realm unban error:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Unban Failed`)
                .setDescription(error.message || 'Failed to process the unban request.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Lunar • Please try again' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
