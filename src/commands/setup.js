const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { startDeviceCodeAuth, getAuthflow } = require('../auth/xboxAuth');
const { getUser, getUserByGuild, saveUser, hasAcceptedTOS } = require('../database/db');
const { RealmAPI } = require('prismarine-realms');
const Emojis = require('../utils/emojis');

const TOS_URL = 'https://github.com/Verxcy120/Lunar-Automod-TOS';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Link your Microsoft account to access Realm features'),
    
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
                .setDescription('Only the server owner can link a Microsoft account for this server.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Lunar • Contact your server owner' });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Check TOS acceptance first
        const tosAccepted = hasAcceptedTOS(interaction.user.id);
        
        if (!tosAccepted) {
            const tosEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.TOS} Terms of Service Required`)
                .setDescription('Before linking your Microsoft account, you must accept our Terms of Service.')
                .setColor(0x5865F2)
                .addFields(
                    { 
                        name: 'Main Points', 
                        value: [
                            '• You must have authorization to manage the Realm',
                            '• Use the bot lawfully and responsibly',
                            '• We collect data needed for bot functionality (gamertags, XUIDs, logs)',
                            '• No data is sold to third parties',
                            
                        ].join('\n')
                    },
                    { 
                        name: `${Emojis.Link} Full Terms`, 
                        value: `[Click here to read the full TOS](${TOS_URL})` 
                    }
                )
                .setFooter({ text: 'Lunar • Accept TOS to continue setup' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('tos_accept_setup')
                        .setLabel('I Agree to the TOS')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('tos_decline')
                        .setLabel('I Decline')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setLabel('Read Full TOS')
                        .setStyle(ButtonStyle.Link)
                        .setURL(TOS_URL)
                );

            return interaction.reply({ embeds: [tosEmbed], components: [row], ephemeral: true });
        }

        // Check if this guild already has a linked account
        const existingGuildUser = getUserByGuild(interaction.guild.id);
        const existingUser = getUser(interaction.user.id, interaction.guild.id);
        
        if (existingGuildUser || existingUser) {
            // Guild already has linked account - fetch their owned realms
            await interaction.deferReply({ ephemeral: true });
            
            const userData = existingUser || existingGuildUser;
            let ownedRealms = [];
            try {
                const authflow = getAuthflow(userData.discord_id);
                const api = RealmAPI.from(authflow, 'bedrock');
                const realms = await api.getRealms();
                ownedRealms = realms.filter(realm => realm.ownerUUID === userData.xbox_xuid);
            } catch (realmError) {
                console.error('Error fetching realms:', realmError);
            }

            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Link} Account Already Linked`)
                .setDescription('This server already has a Microsoft account linked!')
                .setColor(0x00FF00)
                .addFields(
                    { name: `${Emojis.Crown} Server`, value: interaction.guild.name, inline: true },
                    { name: 'Server ID', value: `\`${interaction.guild.id}\``, inline: true }
                );

            if (ownedRealms.length > 0) {
                const realmList = ownedRealms.map(r => `${Emojis.Realms} **${r.name}** (${r.state === 'OPEN' ? Emojis.Online : Emojis.Offline})`).join('\n');
                embed.addFields(
                    { name: `${Emojis.Crown} Your Realms (${ownedRealms.length})`, value: realmList, inline: false }
                );
            } else {
                embed.addFields(
                    { name: `${Emojis.Crown} Your Realms`, value: 'You don\'t own any Realms.', inline: false }
                );
            }

            embed.addFields(
                { name: `${Emojis.Timer} Linked`, value: `<t:${userData.created_at}:R>`, inline: true }
            );
            embed.setFooter({ text: 'Click the button below to unlink your account' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`unlink_${interaction.guild.id}`)
                        .setLabel('Unlink Account')
                        .setStyle(ButtonStyle.Danger)
                );

            return interaction.editReply({ embeds: [embed], components: [row] });
        }

        // Show initial message
        const loadingEmbed = new EmbedBuilder()
            .setTitle(`${Emojis.Locked} Link Your Microsoft Account`)
            .setDescription('Generating your login code...')
            .setColor(0x5865F2);

        await interaction.reply({ embeds: [loadingEmbed], ephemeral: true });

        try {
            // Start device code auth flow
            const token = await startDeviceCodeAuth(interaction.user.id, async (code) => {
                console.log('Device code received:', code); // Debug log
                
                // prismarine-auth uses: code.user_code, code.verification_uri, code.expires_in
                // or sometimes: code.userCode, code.verificationUri
                const userCode = code.user_code || code.userCode;
                const verificationUri = code.verification_uri || code.verificationUri || 'microsoft.com/link';
                const expiresIn = code.expires_in || code.expiresIn || 900;

                // Send the device code to user
                const codeEmbed = new EmbedBuilder()
                    .setTitle(`${Emojis.Locked} Link Your Microsoft Account`)
                    .setDescription(`**Step 1:** Go to **[microsoft.com/link](https://microsoft.com/link)**\n\n**Step 2:** Enter this code:\n# \`${userCode}\`\n\n**Step 3:** Sign in with your Microsoft account`)
                    .setColor(0x5865F2)
                    .addFields(
                        { name: `${Emojis.Timer} Expires`, value: `<t:${Math.floor(Date.now() / 1000) + expiresIn}:R>`, inline: true },
                        { name: `${Emojis.Locked} Privacy`, value: 'We only store your Xbox gamertag and tokens for Realm access.', inline: false }
                    )
                    .setFooter({ text: 'Lunar • Waiting for authentication...' });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('Open Microsoft Login')
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://microsoft.com/link')
                    );

                await interaction.editReply({ embeds: [codeEmbed], components: [row] });
            });

            // Auth successful - save user with guild ID
            saveUser(interaction.user.id, interaction.guild.id, {
                gamertag: token.userHash || 'Unknown',
                xuid: token.userXUID || 'Unknown'
            }, {
                accessToken: token.XSTSToken,
                refreshToken: '',
                expiresAt: Date.now() + (24 * 60 * 60 * 1000)
            });

            // Fetch owned realms
            let ownedRealms = [];
            try {
                const authflow = getAuthflow(interaction.user.id);
                const api = RealmAPI.from(authflow, 'bedrock');
                const realms = await api.getRealms();
                
                // Filter to only realms the user owns
                ownedRealms = realms.filter(realm => realm.ownerUUID === token.userXUID);
            } catch (realmError) {
                console.error('Error fetching realms:', realmError);
            }

            const successEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Success} Account Linked Successfully!`)
                .setDescription('Your Microsoft account has been linked to this server!')
                .setColor(0x00FF00)
                .addFields(
                    { name: `${Emojis.Crown} Server`, value: interaction.guild.name, inline: true },
                    { name: 'Server ID', value: `\`${interaction.guild.id}\``, inline: true }
                );

            if (ownedRealms.length > 0) {
                const realmList = ownedRealms.map(r => `${Emojis.Realms} **${r.name}** (${r.state === 'OPEN' ? Emojis.Online : Emojis.Offline})`).join('\n');
                successEmbed.addFields(
                    { name: `${Emojis.Crown} Your Realms (${ownedRealms.length})`, value: realmList, inline: false }
                );
            } else {
                successEmbed.addFields(
                    { name: `${Emojis.Crown} Your Realms`, value: 'You don\'t own any Realms.', inline: false }
                );
            }

            successEmbed.setFooter({ text: 'Lunar • Account linked successfully' });

            await interaction.editReply({ embeds: [successEmbed], components: [] });

        } catch (error) {
            console.error('Setup error:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} Authentication Failed`)
                .setDescription('Failed to link your Microsoft account. Please try again.\n\nMake sure you completed the sign-in before the code expired.')
                .setColor(0xFF0000);

            await interaction.editReply({ embeds: [errorEmbed], components: [] });
        }
    }
};
