import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { addHacker, removeHacker, addDiscordUser, removeDiscordUser, getAllHackers, getAllDiscordUsers, getDatabaseStats } from '../utils/database.js';
import { getGuildConfig } from '../utils/guildConfig.js';

const COLORS = {
    SUCCESS: 0x57F287,
    DANGER: 0xED4245,
    PRIMARY: 0x5865F2,
    DARK: 0x2b2d31
};

export const data = new SlashCommandBuilder()
    .setName('database')
    .setDescription('Manage the hacker and user database')
    .addSubcommand(sub =>
        sub.setName('add')
            .setDescription('Add an entry to the database')
            .addStringOption(opt =>
                opt.setName('type')
                    .setDescription('Type of entry')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Realm Hacker', value: 'hacker' },
                        { name: 'Discord User', value: 'discord' }
                    ))
            .addStringOption(opt =>
                opt.setName('id')
                    .setDescription('XUID (for hackers) or Discord ID (for users)')
                    .setRequired(true))
            .addStringOption(opt =>
                opt.setName('reason')
                    .setDescription('Reason for adding')
                    .setRequired(true))
            .addStringOption(opt =>
                opt.setName('gamertag')
                    .setDescription('Gamertag (only for hackers)')
                    .setRequired(false))
    )
    .addSubcommand(sub =>
        sub.setName('remove')
            .setDescription('Remove an entry from the database')
            .addStringOption(opt =>
                opt.setName('type')
                    .setDescription('Type of entry')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Realm Hacker', value: 'hacker' },
                        { name: 'Discord User', value: 'discord' }
                    ))
            .addStringOption(opt =>
                opt.setName('id')
                    .setDescription('XUID (for hackers) or Discord ID (for users)')
                    .setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('List all entries')
            .addStringOption(opt =>
                opt.setName('type')
                    .setDescription('Type of entries to list')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Realm Hackers', value: 'hacker' },
                        { name: 'Discord Users', value: 'discord' }
                    ))
    )
    .addSubcommand(sub =>
        sub.setName('stats')
            .setDescription('View database statistics')
    );

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const config = getGuildConfig(guildId);
    
    // Check permissions
    const userId = interaction.user.id;
    const isOwner = interaction.guild.ownerId === userId;
    const hasPermRole = config.commandPermissions?.database && 
        interaction.member.roles.cache.has(config.commandPermissions.database);
    
    if (!isOwner && !hasPermRole) {
        const embed = new EmbedBuilder()
            .setColor(COLORS.DANGER)
            .setDescription('❌ You do not have permission to use this command.');
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    if (subcommand === 'add') {
        await handleAdd(interaction, config);
    } else if (subcommand === 'remove') {
        await handleRemove(interaction, config);
    } else if (subcommand === 'list') {
        await handleList(interaction);
    } else if (subcommand === 'stats') {
        await handleStats(interaction);
    }
}

async function handleAdd(interaction, config) {
    const type = interaction.options.getString('type');
    const id = interaction.options.getString('id');
    const reason = interaction.options.getString('reason');
    const gamertag = interaction.options.getString('gamertag');
    
    let result;
    let embed;
    
    if (type === 'hacker') {
        if (!gamertag) {
            embed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setDescription('❌ Gamertag is required for Realm Hackers.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        result = addHacker(id, gamertag, reason, interaction.user.id);
        
        if (result.success) {
            embed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setAuthor({ name: 'Hacker Database Entry Added', iconURL: 'https://cdn.discordapp.com/emojis/1234567890.png' })
                .addFields(
                    { name: '🎮 Gamertag', value: `\`${gamertag}\``, inline: true },
                    { name: '🔢 XUID', value: `\`${id}\``, inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: '📝 Reason', value: reason, inline: false },
                    { name: '👤 Added By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📅 Added', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: `Entry ID: ${id}` })
                .setTimestamp();
            
            // Log to database channel if configured
            await logToChannel(interaction.client, config.databaseLogChannel, embed);
        } else {
            embed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setDescription(`❌ ${result.message}`);
        }
    } else {
        // Discord user
        let discordTag = 'Unknown';
        try {
            const user = await interaction.client.users.fetch(id);
            discordTag = user.tag;
        } catch {
            // User not found, use ID
            discordTag = id;
        }
        
        result = addDiscordUser(id, discordTag, reason, interaction.user.id);
        
        if (result.success) {
            embed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setAuthor({ name: 'Discord Database Entry Added', iconURL: 'https://cdn.discordapp.com/emojis/1234567890.png' })
                .addFields(
                    { name: '🏷️ Discord Tag', value: `\`${discordTag}\``, inline: true },
                    { name: '🔢 Discord ID', value: `\`${id}\``, inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: '📝 Reason', value: reason, inline: false },
                    { name: '👤 Added By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📅 Added', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: `Entry ID: ${id}` })
                .setTimestamp();
            
            // Log to database channel if configured
            await logToChannel(interaction.client, config.databaseLogChannel, embed);
        } else {
            embed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setDescription(`❌ ${result.message}`);
        }
    }
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleRemove(interaction, config) {
    const type = interaction.options.getString('type');
    const id = interaction.options.getString('id');
    
    let result;
    let embed;
    
    if (type === 'hacker') {
        result = removeHacker(id);
        
        if (result.success) {
            embed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setDescription(`✅ Removed **${result.entry.gamertag}** (\`${id}\`) from the hacker database.`);
            
            // Log removal
            const logEmbed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setAuthor({ name: 'Hacker Database Entry Removed' })
                .addFields(
                    { name: '🎮 Gamertag', value: `\`${result.entry.gamertag}\``, inline: true },
                    { name: '🔢 XUID', value: `\`${id}\``, inline: true },
                    { name: '👤 Removed By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();
            
            await logToChannel(interaction.client, config.databaseLogChannel, logEmbed);
        } else {
            embed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setDescription(`❌ ${result.message}`);
        }
    } else {
        result = removeDiscordUser(id);
        
        if (result.success) {
            embed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setDescription(`✅ Removed **${result.entry.discordTag}** (\`${id}\`) from the Discord database.`);
            
            // Log removal
            const logEmbed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setAuthor({ name: 'Discord Database Entry Removed' })
                .addFields(
                    { name: '🏷️ Discord Tag', value: `\`${result.entry.discordTag}\``, inline: true },
                    { name: '🔢 Discord ID', value: `\`${id}\``, inline: true },
                    { name: '👤 Removed By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();
            
            await logToChannel(interaction.client, config.databaseLogChannel, logEmbed);
        } else {
            embed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setDescription(`❌ ${result.message}`);
        }
    }
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleList(interaction) {
    const type = interaction.options.getString('type');
    
    if (type === 'hacker') {
        const hackers = getAllHackers();
        
        if (hackers.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(COLORS.DARK)
                .setDescription('📋 No hackers in the database.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const entries = hackers.slice(0, 10).map((h, i) => 
            `**${i + 1}.** \`${h.gamertag}\`\n└ XUID: \`${h.xuid}\`\n└ Reason: ${h.reason}`
        ).join('\n\n');
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.PRIMARY)
            .setAuthor({ name: '🎮 Hacker Database' })
            .setDescription(entries)
            .setFooter({ text: `Showing ${Math.min(10, hackers.length)} of ${hackers.length} entries` });
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
        const users = getAllDiscordUsers();
        
        if (users.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(COLORS.DARK)
                .setDescription('📋 No Discord users in the database.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const entries = users.slice(0, 10).map((u, i) => 
            `**${i + 1}.** \`${u.discordTag}\`\n└ ID: \`${u.discordId}\`\n└ Reason: ${u.reason}`
        ).join('\n\n');
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.PRIMARY)
            .setAuthor({ name: '👤 Discord Users Database' })
            .setDescription(entries)
            .setFooter({ text: `Showing ${Math.min(10, users.length)} of ${users.length} entries` });
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}

async function handleStats(interaction) {
    const stats = getDatabaseStats();
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setAuthor({ name: '📊 Database Statistics', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .addFields(
            { name: '🎮 Hackers', value: `\`${stats.hackers}\``, inline: true },
            { name: '👤 Discord Users', value: `\`${stats.discordUsers}\``, inline: true },
            { name: '📋 Total Entries', value: `\`${stats.total}\``, inline: true }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function logToChannel(client, channelId, embed) {
    if (!channelId) return;
    
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Failed to log to database channel:', error);
    }
}
