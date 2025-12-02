const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { hasAcceptedTOS, acceptTOS, revokeTOS, deleteUser, isBlacklisted, getUserByGuild } = require('../database/db');
const { getAuthflow } = require('../auth/xboxAuth');
const { RealmAPI } = require('prismarine-realms');
const Emojis = require('../utils/emojis');

const TOS_URL = 'https://github.com/Verxcy120/Lunar-Automod-TOS';
const OWNER_ID = process.env.OWNER_ID;

// Helper function to ban a player from a realm using direct API call
async function banPlayerFromRealm(authflow, realmId, xuid) {
    const token = await authflow.getXboxToken('https://pocket.realms.minecraft.net/');
    
    const response = await fetch(`https://pocket.realms.minecraft.net/worlds/${realmId}/blocklist/${xuid}`, {
        method: 'POST',
        headers: {
            'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
            'Client-Version': '1.17.41',
            'User-Agent': 'MCPE/UWP',
            'Accept': '*/*',
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to ban player: ${response.status} ${errorText}`);
    }
    
    return true;
}

// Helper function to unban a player from a realm using direct API call
async function unbanPlayerFromRealm(authflow, realmId, xuid) {
    const token = await authflow.getXboxToken('https://pocket.realms.minecraft.net/');
    
    const response = await fetch(`https://pocket.realms.minecraft.net/worlds/${realmId}/blocklist/${xuid}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
            'Client-Version': '1.17.41',
            'User-Agent': 'MCPE/UWP',
            'Accept': '*/*'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to unban player: ${response.status} ${errorText}`);
    }
    
    return true;
}

// Commands that don't require TOS acceptance
const TOS_EXEMPT_COMMANDS = [];

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            // Check if user is the owner
            if (OWNER_ID && interaction.user.id !== OWNER_ID) {
                const embed = new EmbedBuilder()
                    .setTitle(`${Emojis.Locked} Access Restricted`)
                    .setDescription('This bot is currently in development and restricted to the owner only.')
                    .setColor(0xFF0000)
                    .setFooter({ text: 'Lunar • Coming Soon' });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Check if user is blacklisted
            const blacklisted = isBlacklisted(interaction.user.id);
            if (blacklisted) {
                const embed = new EmbedBuilder()
                    .setTitle(`${Emojis.Error} You Are Blacklisted`)
                    .setDescription('You have been blacklisted from using this bot.')
                    .setColor(0xFF0000)
                    .addFields(
                        { name: 'Reason', value: blacklisted.reason || 'No reason provided', inline: false }
                    )
                    .setFooter({ text: 'Lunar • Contact support if you believe this is a mistake' });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Check TOS acceptance (except for exempt commands)
            if (!TOS_EXEMPT_COMMANDS.includes(interaction.commandName)) {
                const accepted = hasAcceptedTOS(interaction.user.id);
                
                if (!accepted) {
                    const embed = new EmbedBuilder()
                        .setTitle(`${Emojis.TOS} Terms of Service Required`)
                        .setDescription('You must accept our Terms of Service before using Lunar.\n\nPlease read and accept the TOS to continue.')
                        .setColor(0xFF6B6B)
                        .addFields(
                            { name: `${Emojis.Link} Full Terms`, value: `[Click here to read the TOS](${TOS_URL})` }
                        )
                        .setFooter({ text: 'Lunar • Accept TOS to continue' });

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('tos_accept')
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

                    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                }
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}:`, error);
                
                const errorMessage = {
                    content: `${Emojis.Error} There was an error while executing this command!`,
                    ephemeral: true
                };

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            }
        }
        
        // Handle button interactions
        if (interaction.isButton()) {
            const customId = interaction.customId;
            
            // TOS Accept button (from /tos command)
            if (customId === 'tos_accept') {
                acceptTOS(interaction.user.id);
                
                const embed = new EmbedBuilder()
                    .setTitle(`${Emojis.Success} Terms of Service Accepted`)
                    .setDescription('Thank you for accepting our Terms of Service!\n\nYou can now use all Lunar commands. Get started with `/setup` to link your Microsoft account.')
                    .setColor(0x00FF00)
                    .setFooter({ text: 'Lunar • Welcome!' });

                await interaction.update({ embeds: [embed], components: [] });
                return;
            }

            // TOS Accept button (from /setup command - continues to setup)
            if (customId === 'tos_accept_setup') {
                acceptTOS(interaction.user.id);
                
                const embed = new EmbedBuilder()
                    .setTitle(`${Emojis.Success} Terms of Service Accepted`)
                    .setDescription('Thank you for accepting our Terms of Service!\n\nNow run `/setup` again to link your Microsoft account.')
                    .setColor(0x00FF00)
                    .setFooter({ text: 'Lunar • Run /setup to continue' });

                await interaction.update({ embeds: [embed], components: [] });
                return;
            }
            
            // TOS Decline button
            if (customId === 'tos_decline') {
                const embed = new EmbedBuilder()
                    .setTitle(`${Emojis.Error} Terms of Service Declined`)
                    .setDescription('You have declined the Terms of Service.\n\nYou will not be able to use Lunar until you accept the TOS. Use `/setup` when you\'re ready to accept.')
                    .setColor(0xFF0000)
                    .setFooter({ text: 'Lunar' });

                await interaction.update({ embeds: [embed], components: [] });
                return;
            }
            
            // TOS Revoke button
            if (customId === 'tos_revoke') {
                revokeTOS(interaction.user.id);
                deleteUser(interaction.user.id); // Also unlink their account
                
                const embed = new EmbedBuilder()
                    .setTitle(`${Emojis.Unlocked} TOS Acceptance Revoked`)
                    .setDescription('Your TOS acceptance has been revoked and your linked account has been removed.\n\nYou will need to accept the TOS again and re-link your account to use Lunar.')
                    .setColor(0xFFA500)
                    .setFooter({ text: 'Lunar' });

                await interaction.update({ embeds: [embed], components: [] });
                return;
            }
            
            // Unlink account button
            if (customId === 'unlink' || customId.startsWith('unlink_')) {
                const guildId = customId.includes('_') ? customId.split('_')[1] : interaction.guildId;
                
                // Check if user is guild owner
                if (interaction.guild && interaction.user.id !== interaction.guild.ownerId) {
                    return interaction.reply({
                        content: `${Emojis.Error} Only the server owner can unlink the account.`,
                        ephemeral: true
                    });
                }
                
                deleteUser(interaction.user.id, guildId);
                await interaction.reply({
                    content: `${Emojis.Success} The Microsoft account has been unlinked from this server.`,
                    ephemeral: true
                });
                return;
            }
        }

        // Handle select menu interactions
        if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;

            // Realm Ban select menu
            if (customId.startsWith('realmban_')) {
                const parts = customId.split('_');
                const xuid = parts[1];
                const gamertag = parts.slice(2).join('_'); // Handle gamertags with underscores
                const realmId = interaction.values[0];

                await interaction.deferUpdate();

                try {
                    const userData = getUserByGuild(interaction.guild.id);
                    if (!userData) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Account Linked`)
                            .setDescription('No Microsoft account is linked to this server.')
                            .setColor(0xFF0000);
                        return interaction.editReply({ embeds: [errorEmbed], components: [] });
                    }

                    const authflow = getAuthflow(userData.discord_id);

                    // Ban the player using direct API call
                    await banPlayerFromRealm(authflow, realmId, xuid);

                    const successEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Success} Player Banned`)
                        .setDescription(`**${gamertag}** has been successfully banned from the Realm.`)
                        .setColor(0x00FF00)
                        .addFields(
                            { name: `${Emojis.Crown} Player`, value: `\`${gamertag}\``, inline: true },
                            { name: `${Emojis.Link} XUID`, value: `\`${xuid}\``, inline: true },
                            { name: `${Emojis.Realms} Realm ID`, value: `\`${realmId}\``, inline: true }
                        )
                        .setFooter({ text: 'Lunar • Player banned successfully' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [successEmbed], components: [] });

                } catch (error) {
                    console.error('Realm ban error:', error);

                    const errorEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Error} Ban Failed`)
                        .setDescription(`Failed to ban **${gamertag}** from the Realm.`)
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'Error', value: `\`\`\`${error.message || 'Unknown error'}\`\`\``, inline: false }
                        )
                        .setFooter({ text: 'Lunar • Please try again' });

                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
                return;
            }

            // Realm Unban select menu
            if (customId.startsWith('realmunban_')) {
                const parts = customId.split('_');
                const xuid = parts[1];
                const gamertag = parts.slice(2).join('_'); // Handle gamertags with underscores
                const realmId = interaction.values[0];

                await interaction.deferUpdate();

                try {
                    const userData = getUserByGuild(interaction.guild.id);
                    if (!userData) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Account Linked`)
                            .setDescription('No Microsoft account is linked to this server.')
                            .setColor(0xFF0000);
                        return interaction.editReply({ embeds: [errorEmbed], components: [] });
                    }

                    const authflow = getAuthflow(userData.discord_id);

                    // Unban the player using direct API call
                    await unbanPlayerFromRealm(authflow, realmId, xuid);

                    const successEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Success} Player Unbanned`)
                        .setDescription(`**${gamertag}** has been successfully unbanned from the Realm.`)
                        .setColor(0x00FF00)
                        .addFields(
                            { name: `${Emojis.Crown} Player`, value: `\`${gamertag}\``, inline: true },
                            { name: `${Emojis.Link} XUID`, value: `\`${xuid}\``, inline: true },
                            { name: `${Emojis.Realms} Realm ID`, value: `\`${realmId}\``, inline: true }
                        )
                        .setFooter({ text: 'Lunar • Player unbanned successfully' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [successEmbed], components: [] });

                } catch (error) {
                    console.error('Realm unban error:', error);

                    const errorEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Error} Unban Failed`)
                        .setDescription(`Failed to unban **${gamertag}** from the Realm.`)
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'Error', value: `\`\`\`${error.message || 'Unknown error'}\`\`\``, inline: false }
                        )
                        .setFooter({ text: 'Lunar • Please try again' });

                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
                return;
            }

            // Realm Open select menu
            if (customId === 'realm_open') {
                const realmId = interaction.values[0];

                await interaction.deferUpdate();

                try {
                    const userData = getUserByGuild(interaction.guild.id);
                    if (!userData) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Account Linked`)
                            .setDescription('No Microsoft account is linked to this server.')
                            .setColor(0xFF0000);
                        return interaction.editReply({ embeds: [errorEmbed], components: [] });
                    }

                    const authflow = getAuthflow(userData.discord_id);
                    const api = RealmAPI.from(authflow, 'bedrock');
                    
                    // Get the realm and open it
                    const realm = await api.getRealm(realmId);
                    await realm.open();

                    const successEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Success} Realm Opened`)
                        .setDescription(`**${realm.name}** has been successfully opened!`)
                        .setColor(0x00FF00)
                        .addFields(
                            { name: `${Emojis.Realms} Realm`, value: `\`${realm.name}\``, inline: true },
                            { name: `${Emojis.Online} Status`, value: '`OPEN`', inline: true }
                        )
                        .setFooter({ text: 'Lunar • Realm opened successfully' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [successEmbed], components: [] });

                } catch (error) {
                    console.error('Realm open error:', error);

                    const errorEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Error} Open Failed`)
                        .setDescription('Failed to open the Realm.')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'Error', value: `\`\`\`${error.message || 'Unknown error'}\`\`\``, inline: false }
                        )
                        .setFooter({ text: 'Lunar • Please try again' });

                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
                return;
            }

            // Realm Close select menu
            if (customId === 'realm_close') {
                const realmId = interaction.values[0];

                await interaction.deferUpdate();

                try {
                    const userData = getUserByGuild(interaction.guild.id);
                    if (!userData) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Account Linked`)
                            .setDescription('No Microsoft account is linked to this server.')
                            .setColor(0xFF0000);
                        return interaction.editReply({ embeds: [errorEmbed], components: [] });
                    }

                    const authflow = getAuthflow(userData.discord_id);
                    const api = RealmAPI.from(authflow, 'bedrock');
                    
                    // Get the realm and close it
                    const realm = await api.getRealm(realmId);
                    await realm.close();

                    const successEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Success} Realm Closed`)
                        .setDescription(`**${realm.name}** has been successfully closed!`)
                        .setColor(0xFF0000)
                        .addFields(
                            { name: `${Emojis.Realms} Realm`, value: `\`${realm.name}\``, inline: true },
                            { name: `${Emojis.Offline} Status`, value: '`CLOSED`', inline: true }
                        )
                        .setFooter({ text: 'Lunar • Realm closed successfully' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [successEmbed], components: [] });

                } catch (error) {
                    console.error('Realm close error:', error);

                    const errorEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Error} Close Failed`)
                        .setDescription('Failed to close the Realm.')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'Error', value: `\`\`\`${error.message || 'Unknown error'}\`\`\``, inline: false }
                        )
                        .setFooter({ text: 'Lunar • Please try again' });

                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
                return;
            }

            // Realm Backup Select menu (select realm to view backups)
            if (customId === 'realm_backup_select') {
                const realmId = interaction.values[0];

                await interaction.deferUpdate();

                try {
                    const userData = getUserByGuild(interaction.guild.id);
                    if (!userData) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Account Linked`)
                            .setDescription('No Microsoft account is linked to this server.')
                            .setColor(0xFF0000);
                        return interaction.editReply({ embeds: [errorEmbed], components: [] });
                    }

                    const authflow = getAuthflow(userData.discord_id);
                    const api = RealmAPI.from(authflow, 'bedrock');
                    
                    // Get the realm and its backups
                    const realm = await api.getRealm(realmId);
                    const backups = await realm.getBackups();

                    if (!backups || backups.length === 0) {
                        const noBackupsEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Backups Found`)
                            .setDescription(`**${realm.name}** has no available backups.`)
                            .setColor(0xFF0000)
                            .setFooter({ text: 'Lunar • No backups available' });
                        return interaction.editReply({ embeds: [noBackupsEmbed], components: [] });
                    }

                    // Create backup selection dropdown (max 25 options)
                    const backupOptions = backups.slice(0, 25).map((backup, index) => {
                        const date = new Date(backup.lastModifiedDate);
                        const dateStr = date.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric', 
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        return {
                            label: `Backup ${index + 1} - ${dateStr}`,
                            description: `Size: ${backup.size ? Math.round(backup.size / 1024 / 1024) + 'MB' : 'Unknown'}`,
                            value: `${realmId}_${backup.backupId}_${backup.lastModifiedDate}`
                        };
                    });

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('realm_backup_restore')
                        .setPlaceholder('Select a backup to restore')
                        .addOptions(backupOptions);

                    const row = new ActionRowBuilder().addComponents(selectMenu);

                    const backupEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Realms} Backups for ${realm.name}`)
                        .setDescription(`Found **${backups.length}** backup(s).\n\nSelect a backup to restore your Realm to that point in time.\n\n⚠️ **Warning:** Restoring a backup will overwrite your current world!`)
                        .setColor(0x5865F2)
                        .setFooter({ text: 'Lunar • Select a backup to restore' });

                    await interaction.editReply({ embeds: [backupEmbed], components: [row] });

                } catch (error) {
                    console.error('Realm backup error:', error);

                    const errorEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Error} Backup Failed`)
                        .setDescription('Failed to fetch backups for the Realm.')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'Error', value: `\`\`\`${error.message || 'Unknown error'}\`\`\``, inline: false }
                        )
                        .setFooter({ text: 'Lunar • Please try again' });

                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
                return;
            }

            // Realm Backup Restore menu (restore selected backup)
            if (customId === 'realm_backup_restore') {
                const [realmId, backupId, lastModifiedDate] = interaction.values[0].split('_');

                await interaction.deferUpdate();

                try {
                    const userData = getUserByGuild(interaction.guild.id);
                    if (!userData) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${Emojis.Error} No Account Linked`)
                            .setDescription('No Microsoft account is linked to this server.')
                            .setColor(0xFF0000);
                        return interaction.editReply({ embeds: [errorEmbed], components: [] });
                    }

                    const authflow = getAuthflow(userData.discord_id);
                    const api = RealmAPI.from(authflow, 'bedrock');
                    
                    // Restore the backup
                    await api.restoreRealmFromBackup(realmId, backupId, lastModifiedDate);

                    const date = new Date(lastModifiedDate);
                    const dateStr = date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    const successEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Success} Backup Restored`)
                        .setDescription('The Realm has been successfully restored to the selected backup!')
                        .setColor(0x00FF00)
                        .addFields(
                            { name: `${Emojis.Realms} Realm ID`, value: `\`${realmId}\``, inline: true },
                            { name: `${Emojis.Timer} Backup Date`, value: `\`${dateStr}\``, inline: true }
                        )
                        .setFooter({ text: 'Lunar • Backup restored successfully' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [successEmbed], components: [] });

                } catch (error) {
                    console.error('Realm restore error:', error);

                    const errorEmbed = new EmbedBuilder()
                        .setTitle(`${Emojis.Error} Restore Failed`)
                        .setDescription('Failed to restore the backup.')
                        .setColor(0xFF0000)
                        .addFields(
                            { name: 'Error', value: `\`\`\`${error.message || 'Unknown error'}\`\`\``, inline: false }
                        )
                        .setFooter({ text: 'Lunar • Please try again' });

                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
                return;
            }
        }
    }
};
