import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getGuildConfig, setGuildConfig, resetGuildConfig } from '../utils/guildConfig.js';
import { checkPremium } from '../utils/premiumStorage.js';
import { sendLog } from '../utils/logging.js';

// Color palette
const COLORS = {
    PRIMARY: 0x5865F2,
    SUCCESS: 0x57F287,
    DANGER: 0xED4245,
    WARNING: 0xFEE75C,
    DARK: 0x2b2d31,
    PREMIUM: 0xF1C40F,
    GREEN: 0x2ECC71
};

export const data = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings for this server');

export async function execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    
    if (interaction.guild.ownerId !== userId) {
        const embed = new EmbedBuilder()
            .setColor(COLORS.DANGER)
            .setDescription('❌ Only the **server owner** can configure bot settings.');
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    await showMainMenu(interaction, guildId);
}

// ═══════════════════════════════════════════════════════════════
// MAIN MENU
// ═══════════════════════════════════════════════════════════════

async function showMainMenu(interaction, guildId, isUpdate = false) {
    const config = getGuildConfig(guildId);
    const premium = checkPremium(guildId);
    const guild = interaction.guild;
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ 
            name: `${guild.name} | Configuration Panel`, 
            iconURL: guild.iconURL({ dynamic: true }) 
        })
        .setDescription(
            `Welcome to the configuration panel! Select a category below.\n\n` +
            `**Categories**\n` +
            `*Logs & Channels, Automod, Permissions, Features*\n\n` +
            `💡 **TIP:** Use the buttons below to navigate through settings.`
        )
        .setFooter({ text: premium.active ? '⭐ Premium Active' : '💎 Upgrade to Premium for more features' })
        .setTimestamp();
    
    // Row 1: Main category buttons
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_cat_logs')
            .setLabel('Logs & Channels')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📋'),
        new ButtonBuilder()
            .setCustomId('config_cat_automod')
            .setLabel('Automod')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🛡️'),
        new ButtonBuilder()
            .setCustomId('config_cat_permissions')
            .setLabel('Permissions')
            .setStyle(ButtonStyle.Success)
            .setEmoji('👑')
    );
    
    // Row 2: Secondary category buttons
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_cat_features')
            .setLabel('Features')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚡'),
        new ButtonBuilder()
            .setCustomId('config_cat_database')
            .setLabel('Database')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🗄️')
    );
    
    // Row 3: Utility buttons
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_reset_all')
            .setLabel('Reset All')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
        new ButtonBuilder()
            .setLabel('Support Server')
            .setStyle(ButtonStyle.Link)
            .setURL('https://discord.gg/realmbot')
            .setEmoji('🔗')
    );
    
    if (isUpdate) {
        await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row1, row2, row3], flags: MessageFlags.Ephemeral });
    }
}

// ═══════════════════════════════════════════════════════════════
// LOGS CATEGORY
// ═══════════════════════════════════════════════════════════════

async function showLogsMenu(interaction, guildId) {
    const config = getGuildConfig(guildId);
    const logs = config.logs || {};
    const logChannels = config.logChannels || {};
    
    const getStatus = (type) => {
        const enabled = logs[type];
        const channel = logChannels[type];
        if (enabled && channel) return `🟢 <#${channel}>`;
        if (enabled && !channel) return `🟡 No channel`;
        return `🔴 Off`;
    };
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '📋 Logs & Channels', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Click a button to **configure** that log type.\nEach log can have its own channel!\n\n` +
            `**🎮 Realm Activity**\n` +
            `💬 Chat Relay → ${getStatus('chatRelay')}\n` +
            `📥 Joins/Leaves → ${getStatus('joinsLeaves')}\n` +
            `💀 Deaths → ${getStatus('playerDeaths')}\n\n` +
            `**🛡️ Moderation**\n` +
            `🛡️ Automod → ${getStatus('automod')}\n` +
            `🔨 Bans → ${getStatus('realmBans')}\n` +
            `✅ Unbans → ${getStatus('realmUnbans')}\n` +
            `👢 Kicks → ${getStatus('realmKicks')}\n\n` +
            `**📊 Other**\n` +
            `📨 Invites → ${getStatus('realmInvites')}\n` +
            `⚡ Commands → ${getStatus('commandExecution')}\n` +
            `👁️ Watchlist → ${getStatus('watchlistAlerts')}`
        )
        .setFooter({ text: '🟢 = Active | 🟡 = On but no channel | 🔴 = Off' });
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_logsetup_chatRelay')
            .setLabel('Chat')
            .setStyle(logs.chatRelay ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('💬'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_joinsLeaves')
            .setLabel('Joins')
            .setStyle(logs.joinsLeaves ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('📥'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_playerDeaths')
            .setLabel('Deaths')
            .setStyle(logs.playerDeaths ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('💀'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_automod')
            .setLabel('Automod')
            .setStyle(logs.automod ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🛡️')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_logsetup_realmBans')
            .setLabel('Bans')
            .setStyle(logs.realmBans ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔨'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_realmUnbans')
            .setLabel('Unbans')
            .setStyle(logs.realmUnbans ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_realmKicks')
            .setLabel('Kicks')
            .setStyle(logs.realmKicks ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('👢'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_realmInvites')
            .setLabel('Invites')
            .setStyle(logs.realmInvites ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('📨')
    );
    
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_logsetup_commandExecution')
            .setLabel('Commands')
            .setStyle(logs.commandExecution ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('⚡'),
        new ButtonBuilder()
            .setCustomId('config_logsetup_watchlistAlerts')
            .setLabel('Watchlist')
            .setStyle(logs.watchlistAlerts ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('👁️')
    );
    
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_log_enableAll')
            .setLabel('All On')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('config_log_disableAll')
            .setLabel('All Off')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
        new ButtonBuilder()
            .setCustomId('config_log_testLog')
            .setLabel('Test')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🧪'),
        new ButtonBuilder()
            .setCustomId('config_back_main')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2, row3, row4] });
}

// ═══════════════════════════════════════════════════════════════
// LOG SETUP SUB-MENU (with channel select dropdown)
// ═══════════════════════════════════════════════════════════════

const LOG_TYPE_NAMES = {
    chatRelay: 'Chat Relay',
    joinsLeaves: 'Joins & Leaves',
    playerDeaths: 'Player Deaths',
    automod: 'Automod Actions',
    realmBans: 'Realm Bans',
    realmUnbans: 'Realm Unbans',
    realmKicks: 'Realm Kicks',
    realmInvites: 'Realm Invites',
    commandExecution: 'Command Execution',
    watchlistAlerts: 'Watchlist Alerts'
};

const LOG_TYPE_ICONS = {
    chatRelay: '💬',
    joinsLeaves: '📥',
    playerDeaths: '💀',
    automod: '🛡️',
    realmBans: '🔨',
    realmUnbans: '✅',
    realmKicks: '👢',
    realmInvites: '📨',
    commandExecution: '⚡',
    watchlistAlerts: '👁️'
};

async function showLogSetupMenu(interaction, guildId, logType) {
    const config = getGuildConfig(guildId);
    const logs = config.logs || {};
    const logChannels = config.logChannels || {};
    
    const isEnabled = logs[logType] || false;
    const currentChannel = logChannels[logType];
    const typeName = LOG_TYPE_NAMES[logType] || logType;
    const typeIcon = LOG_TYPE_ICONS[logType] || '📋';
    
    const embed = new EmbedBuilder()
        .setColor(isEnabled ? COLORS.SUCCESS : COLORS.DARK)
        .setAuthor({ name: `${typeIcon} ${typeName}`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `**Status:** ${isEnabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
            `**Channel:** ${currentChannel ? `<#${currentChannel}>` : '`None`'}\n\n` +
            `Select a channel from the dropdown below.`
        );
    
    const channelSelect = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(`config_logchannel_${logType}`)
            .setPlaceholder('📺 Select channel...')
            .setChannelTypes(ChannelType.GuildText)
    );
    
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`config_logtoggle_${logType}`)
            .setLabel(isEnabled ? 'Turn Off' : 'Turn On')
            .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(isEnabled ? '🔴' : '🟢'),
        new ButtonBuilder()
            .setCustomId(`config_logclear_${logType}`)
            .setLabel('Clear Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🗑️')
            .setDisabled(!currentChannel),
        new ButtonBuilder()
            .setCustomId('config_cat_logs')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [channelSelect, buttons] });
}

// ═══════════════════════════════════════════════════════════════
// AUTOMOD CATEGORY
// ═══════════════════════════════════════════════════════════════

async function showAutomodMenu(interaction, guildId, page = 1) {
    const config = getGuildConfig(guildId);
    const automod = config.automod || {};
    
    const status = (enabled) => enabled ? '✅' : '❌';
    
    if (page === 1) {
        // PAGE 1: Basic protections
        const embed = new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setAuthor({ name: '🛡️ Automod Settings (Page 1/2)', iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setDescription(
                `**Basic Protections**\n\n` +
                `${status(automod.antiSpoof)} Anti-Spoof • *Prevents spoofed accounts*\n` +
                `${status(automod.antiPrivateProfile)} Anti-Private Profile • *Kicks private profiles*\n` +
                `${status(automod.antiAlts)} Anti-Alts • *Blocks alt accounts*\n` +
                `${status(automod.antiUnfairSkins)} Anti-Unfair Skins • *Blocks exploit skins*\n` +
                `${status(automod.antiDeviceSpoof)} Anti-Device Spoof • *Detects spoofed devices*\n` +
                `${status(automod.antiNewAccounts)} Anti-New Accounts • *Blocks new Xbox accounts*`
            )
            .setFooter({ text: 'Page 1/2 • Click Next for more options' });
        
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_automod_antiSpoof')
                .setLabel('Anti-Spoof')
                .setStyle(automod.antiSpoof ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🎭'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiPrivateProfile')
                .setLabel('Anti-Private')
                .setStyle(automod.antiPrivateProfile ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🔒'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiAlts')
                .setLabel('Anti-Alts')
                .setStyle(automod.antiAlts ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('👥')
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_automod_antiUnfairSkins')
                .setLabel('Anti-Skins')
                .setStyle(automod.antiUnfairSkins ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('👤'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiDeviceSpoof')
                .setLabel('Anti-Device')
                .setStyle(automod.antiDeviceSpoof ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('📱'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiNewAccounts')
                .setLabel('Anti-New Accts')
                .setStyle(automod.antiNewAccounts ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🆕')
        );
        
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_back_main')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config_automod_page2')
                .setLabel('Next Page →')
                .setStyle(ButtonStyle.Primary)
        );
        
        await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
    } else {
        // PAGE 2: Advanced protections
        const embed = new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setAuthor({ name: '🛡️ Automod Settings (Page 2/2)', iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setDescription(
                `**Chat & Packet Protections**\n\n` +
                `${status(automod.antiUnicodeExploit)} Anti-Unicode • *Blocks crash characters*\n` +
                `${status(automod.antiCommandSpam)} Anti-Command Spam • *Blocks command flooding*\n` +
                `${status(automod.antiChatFlood)} Anti-Chat Flood • *Blocks message spam*\n` +
                `${status(automod.antiAdvertising)} Anti-Advertising • *Blocks ads/Discord links*\n` +
                `${status(automod.antiInvalidPackets)} Anti-Invalid Packets • *Blocks malformed packets*\n` +
                `${status(automod.antiPacketFlood)} Anti-Packet Flood • *Blocks packet spam*\n` +
                `${status(automod.antiInventoryExploit)} Anti-Inventory Exploit • *Blocks item hacks*`
            )
            .setFooter({ text: 'Page 2/2 • Click Back for basic options' });
        
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_automod_antiUnicodeExploit')
                .setLabel('Anti-Unicode')
                .setStyle(automod.antiUnicodeExploit ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🔣'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiCommandSpam')
                .setLabel('Anti-Cmd Spam')
                .setStyle(automod.antiCommandSpam ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('⌨️'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiChatFlood')
                .setLabel('Anti-Flood')
                .setStyle(automod.antiChatFlood ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🌊')
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_automod_antiAdvertising')
                .setLabel('Anti-Ads')
                .setStyle(automod.antiAdvertising ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('📢'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiInvalidPackets')
                .setLabel('Anti-Packets')
                .setStyle(automod.antiInvalidPackets ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('📦'),
            new ButtonBuilder()
                .setCustomId('config_automod_antiPacketFlood')
                .setLabel('Anti-Pkt Flood')
                .setStyle(automod.antiPacketFlood ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🚿')
        );
        
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_automod_antiInventoryExploit')
                .setLabel('Anti-Inv Exploit')
                .setStyle(automod.antiInventoryExploit ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🎒'),
            new ButtonBuilder()
                .setCustomId('config_automod_page1')
                .setLabel('← Previous Page')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('config_back_main')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
    }
}

// ═══════════════════════════════════════════════════════════════
// AUTOMOD SUB-MENUS
// ═══════════════════════════════════════════════════════════════

async function showAntiAltsConfig(interaction, guildId) {
    const config = getGuildConfig(guildId);
    const antiAlts = config.automod?.antiAltsSettings || { minFriends: 0, minFollowers: 0, minGamerscore: 0 };
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '👥 Anti-Alts Configuration', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Configure minimum requirements for accounts.\n\n` +
            `**Current Settings**\n` +
            `👫 Min Friends: **${antiAlts.minFriends}**\n` +
            `👥 Min Followers: **${antiAlts.minFollowers}**\n` +
            `🎮 Min Gamerscore: **${antiAlts.minGamerscore}**\n\n` +
            `*Accounts below these thresholds will be kicked.*`
        );
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_antialts_friends')
            .setLabel('Set Min Friends')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('👫'),
        new ButtonBuilder()
            .setCustomId('config_antialts_followers')
            .setLabel('Set Min Followers')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('config_antialts_gamerscore')
            .setLabel('Set Min Gamerscore')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎮')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_antialts_toggle')
            .setLabel(config.automod?.antiAlts ? 'Disable' : 'Enable')
            .setStyle(config.automod?.antiAlts ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('config_back_automod')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

async function showAntiSpamConfig(interaction, guildId) {
    const config = getGuildConfig(guildId);
    const antiSpam = config.automod?.antiSpamSettings || { useAI: false, maxMessages: 5, timeWindow: 10 };
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '💬 Anti-Chat Spam Configuration', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Configure spam detection settings.\n\n` +
            `**Current Settings**\n` +
            `🤖 AI Detection: **${antiSpam.useAI ? 'Enabled' : 'Disabled'}**\n` +
            `📨 Max Messages: **${antiSpam.maxMessages}** in ${antiSpam.timeWindow}s\n\n` +
            `*AI detection uses advanced algorithms to detect spam patterns.*`
        );
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_antispam_ai')
            .setLabel(antiSpam.useAI ? 'Disable AI' : 'Enable AI')
            .setStyle(antiSpam.useAI ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji('🤖'),
        new ButtonBuilder()
            .setCustomId('config_antispam_settings')
            .setLabel('Edit Settings')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚙️')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_antispam_toggle')
            .setLabel(config.automod?.antiChatSpam ? 'Disable' : 'Enable')
            .setStyle(config.automod?.antiChatSpam ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('config_back_automod')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

// ═══════════════════════════════════════════════════════════════
// PERMISSIONS CATEGORY
// ═══════════════════════════════════════════════════════════════

async function showPermissionsMenu(interaction, guildId) {
    const config = getGuildConfig(guildId);
    const perms = config.commandPermissions || {};
    
    const commands = [
        'connect', 'disconnect', 'realm-players', 'realm-kick', 'realm-ban', 
        'realm-unban', 'realm-backup', 'realm-execute', 'realm-lockdown',
        'database', 'config'
    ];
    
    const formatPerm = (cmd) => {
        const roleId = perms[cmd];
        return roleId ? `<@&${roleId}>` : '`Server Owner`';
    };
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '👑 Command Permissions', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Configure which roles can use each command.\n\n` +
            `**Current Permissions**\n` +
            commands.map(cmd => `\`/${cmd}\` → ${formatPerm(cmd)}`).join('\n')
        )
        .setFooter({ text: 'Select a command to change its required role' });
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('config_perm_select')
        .setPlaceholder('Select a command to configure...')
        .addOptions(
            commands.map(cmd => ({
                label: `/${cmd}`,
                value: cmd,
                description: `Configure who can use /${cmd}`
            }))
        );
    
    const row1 = new ActionRowBuilder().addComponents(selectMenu);
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_perm_reset')
            .setLabel('Reset All to Owner')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('config_back_main')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

async function showPermissionRoleSelect(interaction, guildId, command) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: `👑 Set Permission for /${command}`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(`Select a role that can use \`/${command}\`.\n\n*Only members with this role will be able to use this command.*`);
    
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId(`config_perm_role_${command}`)
        .setPlaceholder('Select a role...');
    
    const row1 = new ActionRowBuilder().addComponents(roleSelect);
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`config_perm_owner_${command}`)
            .setLabel('Owner Only')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('config_back_permissions')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

// ═══════════════════════════════════════════════════════════════
// CHANNELS CATEGORY
// ═══════════════════════════════════════════════════════════════

async function showChannelsMenu(interaction, guildId) {
    const config = getGuildConfig(guildId);
    
    const formatChannel = (id) => id ? `<#${id}>` : '`Not Set`';
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '📺 Channel Settings', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Configure where the bot sends messages.\n\n` +
            `**Current Settings**\n` +
            `📋 Log Channel: ${formatChannel(config.logChannel)}\n` +
            `🔔 Alert Channel: ${formatChannel(config.alertChannel)}\n` +
            `💬 Chat Bridge: ${formatChannel(config.chatBridgeChannel)}\n` +
            `🗄️ Database Logs: ${formatChannel(config.databaseLogChannel)}\n` +
            `🎯 Detection Logs: ${formatChannel(config.detectionLogChannel)}`
        );
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_channel_log')
            .setLabel('Log Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📋'),
        new ButtonBuilder()
            .setCustomId('config_channel_alert')
            .setLabel('Alert Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔔'),
        new ButtonBuilder()
            .setCustomId('config_channel_chat')
            .setLabel('Chat Bridge')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💬')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_channel_database')
            .setLabel('Database Logs')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🗄️'),
        new ButtonBuilder()
            .setCustomId('config_channel_detection')
            .setLabel('Detection Logs')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯')
    );
    
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_back_main')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
}

async function showChannelSelect(interaction, channelType, title) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setDescription(`### ${title}\nSelect a channel from the dropdown below.`);
    
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`config_setchannel_${channelType}`)
        .setPlaceholder('Select a channel...')
        .setChannelTypes(ChannelType.GuildText);
    
    const row1 = new ActionRowBuilder().addComponents(channelSelect);
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`config_clearchannel_${channelType}`)
            .setLabel('Clear')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('config_back_channels')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

// ═══════════════════════════════════════════════════════════════
// FEATURES CATEGORY
// ═══════════════════════════════════════════════════════════════

async function showFeaturesMenu(interaction, guildId) {
    const config = getGuildConfig(guildId);
    const status = (enabled) => enabled ? '✅' : '❌';
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '⚡ Feature Settings', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Toggle bot features on or off.\n\n` +
            `**Current Settings**\n` +
            `${status(config.autoReconnect)} Auto-Reconnect\n` +
            `${status(config.chatBridge)} Chat Bridge\n` +
            `${status(config.welcomeMessage)} Welcome Message\n` +
            `${status(config.liveDetection)} Live Detection`
        );
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_feature_autoReconnect')
            .setLabel('Auto-Reconnect')
            .setStyle(config.autoReconnect ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('config_feature_chatBridge')
            .setLabel('Chat Bridge')
            .setStyle(config.chatBridge ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('💬'),
        new ButtonBuilder()
            .setCustomId('config_feature_welcomeMsg')
            .setLabel('Welcome Message')
            .setStyle(config.welcomeMessage ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('👋')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_feature_liveDetection')
            .setLabel('Live Detection')
            .setStyle(config.liveDetection ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🎯'),
        new ButtonBuilder()
            .setCustomId('config_feature_editWelcome')
            .setLabel('Edit Welcome Msg')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️')
    );
    
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_back_main')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
}

// ═══════════════════════════════════════════════════════════════
// DATABASE CATEGORY
// ═══════════════════════════════════════════════════════════════

async function showDatabaseMenu(interaction, guildId) {
    const config = getGuildConfig(guildId);
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setAuthor({ name: '🗄️ Database Settings', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            `Configure database and detection settings.\n\n` +
            `**Commands**\n` +
            `Use \`/database add\` to add entries\n` +
            `Use \`/database remove\` to remove entries\n\n` +
            `**Live Detection**\n` +
            `Automatically detect and log flagged players when they join.`
        );
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_db_viewHackers')
            .setLabel('View Hackers')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎮'),
        new ButtonBuilder()
            .setCustomId('config_db_viewDiscord')
            .setLabel('View Discord Users')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('👤')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('config_back_main')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════

function createAntiAltsModal(field) {
    const modal = new ModalBuilder()
        .setCustomId(`config_modal_antialts_${field}`)
        .setTitle('Anti-Alts Settings');
    
    const labels = {
        friends: 'Minimum Friends Required',
        followers: 'Minimum Followers Required',
        gamerscore: 'Minimum Gamerscore Required'
    };
    
    const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(labels[field])
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter a number...')
        .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

function createAntiSpamModal() {
    const modal = new ModalBuilder()
        .setCustomId('config_modal_antispam')
        .setTitle('Anti-Spam Settings');
    
    const maxMessages = new TextInputBuilder()
        .setCustomId('maxMessages')
        .setLabel('Max Messages (before trigger)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('5')
        .setRequired(true);
    
    const timeWindow = new TextInputBuilder()
        .setCustomId('timeWindow')
        .setLabel('Time Window (seconds)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('10')
        .setRequired(true);
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(maxMessages),
        new ActionRowBuilder().addComponents(timeWindow)
    );
    return modal;
}

function createWelcomeModal(currentMessage) {
    const modal = new ModalBuilder()
        .setCustomId('config_modal_welcome')
        .setTitle('Welcome Message');
    
    const input = new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Message (leave blank to disable)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Welcome to our realm!')
        .setValue(currentMessage || '')
        .setRequired(false)
        .setMaxLength(200);
    
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

// ═══════════════════════════════════════════════════════════════
// TEST LOGS
// ═══════════════════════════════════════════════════════════════

async function sendTestLogs(interaction, guildId) {
    const config = getGuildConfig(guildId);
    const client = interaction.client;
    const logChannels = config.logChannels || {};
    
    const testPlayer = {
        gamertag: 'TestPlayer123',
        xuid: '2535412345678901'
    };
    
    let sentCount = 0;
    const sentTo = [];
    const errors = [];
    
    // Temporarily enable all logs for testing
    const originalLogs = { ...config.logs };
    const testLogs = {
        chatRelay: true, joinsLeaves: true, playerDeaths: true,
        automod: true, realmBans: true, realmUnbans: true,
        realmKicks: true, realmInvites: true, commandExecution: true,
        watchlistAlerts: true
    };
    setGuildConfig(guildId, 'logs', testLogs);
    
    try {
        // Test each log type that has a channel configured
        const testTypes = [
            { type: 'join', key: 'joinsLeaves', name: 'Join' },
            { type: 'ban', key: 'realmBans', name: 'Ban' },
            { type: 'command', key: 'commandExecution', name: 'Command' },
            { type: 'automod', key: 'automod', name: 'Automod' }
        ];
        
        for (const test of testTypes) {
            const channelId = logChannels[test.key] || config.logChannel || config.alertChannel;
            if (channelId) {
                if (test.type === 'join') {
                    await sendLog(client, guildId, 'join', testPlayer);
                } else if (test.type === 'ban') {
                    await sendLog(client, guildId, 'ban', { ...testPlayer, moderator: interaction.user.id, reason: 'Test ban' });
                } else if (test.type === 'command') {
                    await sendLog(client, guildId, 'command', { command: 'test', userId: interaction.user.id, target: 'TestTarget' });
                } else if (test.type === 'automod') {
                    await sendLog(client, guildId, 'automod', { ...testPlayer, action: 'kick', rule: 'Test Rule' });
                }
                sentCount++;
                if (!sentTo.includes(channelId)) sentTo.push(channelId);
            }
        }
    } catch (error) {
        errors.push(error.message);
    }
    
    // Restore original logs
    setGuildConfig(guildId, 'logs', originalLogs);
    
    const channelMentions = sentTo.map(id => `<#${id}>`).join(', ');
    
    const embed = new EmbedBuilder()
        .setColor(sentCount > 0 ? COLORS.SUCCESS : COLORS.DANGER)
        .setAuthor({ name: '🧪 Test Logs Sent', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setDescription(
            sentCount > 0 
                ? `✅ Sent **${sentCount}** test log(s)!\n\n` +
                  `**Channels:** ${channelMentions}\n\n` +
                  `Check your log channels to see the test messages.`
                : `❌ No logs were sent.\n\n` +
                  `**To fix this:**\n` +
                  `1. Click a log type button (e.g., Chat, Bans)\n` +
                  `2. Select a channel from the dropdown\n` +
                  `3. The log type will be enabled automatically`
        )
        .setFooter({ text: 'These are sample logs for testing purposes' });
    
    if (errors.length > 0) {
        embed.addFields({ name: '⚠️ Errors', value: errors.join('\n') });
    }
    
    await interaction.update({ embeds: [embed], components: [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_cat_logs')
                .setLabel('Back to Logs')
                .setStyle(ButtonStyle.Secondary)
        )
    ]});
}

// ═══════════════════════════════════════════════════════════════
// INTERACTION HANDLER
// ═══════════════════════════════════════════════════════════════

export async function handleConfigInteraction(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    
    if (interaction.guild.ownerId !== userId) {
        return interaction.reply({ 
            content: '❌ Only the server owner can configure settings.', 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const customId = interaction.customId;
    const config = getGuildConfig(guildId);
    
    // ─── Navigation ───
    if (customId === 'config_back_main') {
        return showMainMenu(interaction, guildId, true);
    }
    if (customId === 'config_back_automod') {
        return showAutomodMenu(interaction, guildId);
    }
    if (customId === 'config_back_channels') {
        return showChannelsMenu(interaction, guildId);
    }
    if (customId === 'config_back_permissions') {
        return showPermissionsMenu(interaction, guildId);
    }
    
    // ─── Category Buttons ───
    if (customId === 'config_cat_logs') {
        return showLogsMenu(interaction, guildId);
    }
    if (customId === 'config_cat_automod') {
        return showAutomodMenu(interaction, guildId);
    }
    if (customId === 'config_cat_permissions') {
        return showPermissionsMenu(interaction, guildId);
    }
    if (customId === 'config_cat_channels') {
        return showChannelsMenu(interaction, guildId);
    }
    if (customId === 'config_cat_features') {
        return showFeaturesMenu(interaction, guildId);
    }
    if (customId === 'config_cat_database') {
        return showDatabaseMenu(interaction, guildId);
    }
    
    // ─── Log Toggles ───
    if (customId.startsWith('config_log_')) {
        const logType = customId.replace('config_log_', '');
        
        if (logType === 'enableAll') {
            const logs = {
                chatRelay: true, joinsLeaves: true, playerDeaths: true,
                automod: true, realmBans: true, realmUnbans: true,
                realmKicks: true, realmInvites: true, commandExecution: true,
                watchlistAlerts: true
            };
            setGuildConfig(guildId, 'logs', logs);
        } else if (logType === 'disableAll') {
            const logs = {
                chatRelay: false, joinsLeaves: false, playerDeaths: false,
                automod: false, realmBans: false, realmUnbans: false,
                realmKicks: false, realmInvites: false, commandExecution: false,
                watchlistAlerts: false
            };
            setGuildConfig(guildId, 'logs', logs);
        } else if (logType === 'testLog') {
            // Send test logs to configured channels
            return sendTestLogs(interaction, guildId);
        }
        return showLogsMenu(interaction, guildId);
    }
    
    // ─── Log Setup (click to configure individual log type) ───
    if (customId.startsWith('config_logsetup_')) {
        const logType = customId.replace('config_logsetup_', '');
        return showLogSetupMenu(interaction, guildId, logType);
    }
    
    // ─── Log Toggle (enable/disable individual log) ───
    if (customId.startsWith('config_logtoggle_')) {
        const logType = customId.replace('config_logtoggle_', '');
        const logs = config.logs || {};
        logs[logType] = !logs[logType];
        setGuildConfig(guildId, 'logs', logs);
        return showLogSetupMenu(interaction, guildId, logType);
    }
    
    // ─── Log Clear Channel ───
    if (customId.startsWith('config_logclear_')) {
        const logType = customId.replace('config_logclear_', '');
        const logChannels = config.logChannels || {};
        delete logChannels[logType];
        setGuildConfig(guildId, 'logChannels', logChannels);
        return showLogSetupMenu(interaction, guildId, logType);
    }
    
    // ─── Log Channel Select (dropdown) ───
    if (customId.startsWith('config_logchannel_')) {
        const logType = customId.replace('config_logchannel_', '');
        const channelId = interaction.values[0];
        const logChannels = config.logChannels || {};
        logChannels[logType] = channelId;
        setGuildConfig(guildId, 'logChannels', logChannels);
        
        // Also enable the log type when a channel is selected
        const logs = config.logs || {};
        logs[logType] = true;
        setGuildConfig(guildId, 'logs', logs);
        
        return showLogSetupMenu(interaction, guildId, logType);
    }
    
    // ─── Automod Buttons ───
    if (customId === 'config_automod_antiAlts') {
        return showAntiAltsConfig(interaction, guildId);
    }
    if (customId === 'config_automod_antiChatSpam') {
        return showAntiSpamConfig(interaction, guildId);
    }
    // Automod page navigation
    if (customId === 'config_automod_page1') {
        return showAutomodMenu(interaction, guildId, 1);
    }
    if (customId === 'config_automod_page2') {
        return showAutomodMenu(interaction, guildId, 2);
    }
    if (customId.startsWith('config_automod_')) {
        const setting = customId.replace('config_automod_', '');
        const automod = config.automod || {};
        automod[setting] = !automod[setting];
        setGuildConfig(guildId, 'automod', automod);
        // Determine which page to show based on the setting
        const page2Settings = ['antiUnicodeExploit', 'antiCommandSpam', 'antiChatFlood', 'antiAdvertising', 'antiInvalidPackets', 'antiPacketFlood', 'antiInventoryExploit'];
        const page = page2Settings.includes(setting) ? 2 : 1;
        return showAutomodMenu(interaction, guildId, page);
    }
    
    // ─── Anti-Alts Config ───
    if (customId === 'config_antialts_friends') {
        return interaction.showModal(createAntiAltsModal('friends'));
    }
    if (customId === 'config_antialts_followers') {
        return interaction.showModal(createAntiAltsModal('followers'));
    }
    if (customId === 'config_antialts_gamerscore') {
        return interaction.showModal(createAntiAltsModal('gamerscore'));
    }
    if (customId === 'config_antialts_toggle') {
        const automod = config.automod || {};
        automod.antiAlts = !automod.antiAlts;
        setGuildConfig(guildId, 'automod', automod);
        return showAntiAltsConfig(interaction, guildId);
    }
    
    // ─── Anti-Spam Config ───
    if (customId === 'config_antispam_ai') {
        const automod = config.automod || {};
        const settings = automod.antiSpamSettings || { useAI: false, maxMessages: 5, timeWindow: 10 };
        settings.useAI = !settings.useAI;
        automod.antiSpamSettings = settings;
        setGuildConfig(guildId, 'automod', automod);
        return showAntiSpamConfig(interaction, guildId);
    }
    if (customId === 'config_antispam_settings') {
        return interaction.showModal(createAntiSpamModal());
    }
    if (customId === 'config_antispam_toggle') {
        const automod = config.automod || {};
        automod.antiChatSpam = !automod.antiChatSpam;
        setGuildConfig(guildId, 'automod', automod);
        return showAntiSpamConfig(interaction, guildId);
    }
    
    // ─── Channel Buttons ───
    if (customId === 'config_channel_log') {
        return showChannelSelect(interaction, 'log', '📋 Select Log Channel');
    }
    if (customId === 'config_channel_alert') {
        return showChannelSelect(interaction, 'alert', '🔔 Select Alert Channel');
    }
    if (customId === 'config_channel_chat') {
        return showChannelSelect(interaction, 'chat', '💬 Select Chat Bridge Channel');
    }
    if (customId === 'config_channel_database') {
        return showChannelSelect(interaction, 'database', '🗄️ Select Database Log Channel');
    }
    if (customId === 'config_channel_detection') {
        return showChannelSelect(interaction, 'detection', '🎯 Select Detection Log Channel');
    }
    
    // ─── Channel Selects ───
    if (customId.startsWith('config_setchannel_')) {
        const type = customId.replace('config_setchannel_', '');
        const channelId = interaction.values[0];
        
        const channelMap = {
            'log': 'logChannel',
            'alert': 'alertChannel',
            'chat': 'chatBridgeChannel',
            'database': 'databaseLogChannel',
            'detection': 'detectionLogChannel'
        };
        
        setGuildConfig(guildId, channelMap[type], channelId);
        return showChannelsMenu(interaction, guildId);
    }
    
    // ─── Clear Channel ───
    if (customId.startsWith('config_clearchannel_')) {
        const type = customId.replace('config_clearchannel_', '');
        const channelMap = {
            'log': 'logChannel',
            'alert': 'alertChannel',
            'chat': 'chatBridgeChannel',
            'database': 'databaseLogChannel',
            'detection': 'detectionLogChannel'
        };
        setGuildConfig(guildId, channelMap[type], null);
        return showChannelsMenu(interaction, guildId);
    }
    
    // ─── Feature Toggles ───
    if (customId === 'config_feature_autoReconnect') {
        setGuildConfig(guildId, 'autoReconnect', !config.autoReconnect);
        return showFeaturesMenu(interaction, guildId);
    }
    if (customId === 'config_feature_chatBridge') {
        setGuildConfig(guildId, 'chatBridge', !config.chatBridge);
        return showFeaturesMenu(interaction, guildId);
    }
    if (customId === 'config_feature_liveDetection') {
        setGuildConfig(guildId, 'liveDetection', !config.liveDetection);
        return showFeaturesMenu(interaction, guildId);
    }
    if (customId === 'config_feature_welcomeMsg') {
        if (config.welcomeMessage) {
            setGuildConfig(guildId, 'welcomeMessage', null);
            return showFeaturesMenu(interaction, guildId);
        } else {
            return interaction.showModal(createWelcomeModal(config.welcomeMessage));
        }
    }
    if (customId === 'config_feature_editWelcome') {
        return interaction.showModal(createWelcomeModal(config.welcomeMessage));
    }
    
    // ─── Permissions ───
    if (customId === 'config_perm_select') {
        const command = interaction.values[0];
        return showPermissionRoleSelect(interaction, guildId, command);
    }
    if (customId.startsWith('config_perm_role_')) {
        const command = customId.replace('config_perm_role_', '');
        const roleId = interaction.values[0];
        const perms = config.commandPermissions || {};
        perms[command] = roleId;
        setGuildConfig(guildId, 'commandPermissions', perms);
        return showPermissionsMenu(interaction, guildId);
    }
    if (customId.startsWith('config_perm_owner_')) {
        const command = customId.replace('config_perm_owner_', '');
        const perms = config.commandPermissions || {};
        delete perms[command];
        setGuildConfig(guildId, 'commandPermissions', perms);
        return showPermissionsMenu(interaction, guildId);
    }
    if (customId === 'config_perm_reset') {
        setGuildConfig(guildId, 'commandPermissions', {});
        return showPermissionsMenu(interaction, guildId);
    }
    
    // ─── Reset All ───
    if (customId === 'config_reset_all') {
        const embed = new EmbedBuilder()
            .setColor(COLORS.DANGER)
            .setDescription('### ⚠️ Reset All Settings?\nThis will reset **everything** to default.\n\n**This cannot be undone.**');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config_reset_confirm')
                .setLabel('Yes, Reset Everything')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('config_back_main')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );
        
        return interaction.update({ embeds: [embed], components: [row] });
    }
    if (customId === 'config_reset_confirm') {
        resetGuildConfig(guildId);
        return showMainMenu(interaction, guildId, true);
    }
}

// ═══════════════════════════════════════════════════════════════
// MODAL HANDLER
// ═══════════════════════════════════════════════════════════════

export async function handleConfigModal(interaction) {
    const guildId = interaction.guild.id;
    const config = getGuildConfig(guildId);
    const customId = interaction.customId;
    
    if (customId.startsWith('config_modal_antialts_')) {
        const field = customId.replace('config_modal_antialts_', '');
        const value = parseInt(interaction.fields.getTextInputValue('value')) || 0;
        
        const automod = config.automod || {};
        const settings = automod.antiAltsSettings || { minFriends: 0, minFollowers: 0, minGamerscore: 0 };
        
        const fieldMap = {
            'friends': 'minFriends',
            'followers': 'minFollowers',
            'gamerscore': 'minGamerscore'
        };
        
        settings[fieldMap[field]] = value;
        automod.antiAltsSettings = settings;
        setGuildConfig(guildId, 'automod', automod);
        
        await interaction.deferUpdate();
        return showAntiAltsConfig(interaction, guildId);
    }
    
    if (customId === 'config_modal_antispam') {
        const maxMessages = parseInt(interaction.fields.getTextInputValue('maxMessages')) || 5;
        const timeWindow = parseInt(interaction.fields.getTextInputValue('timeWindow')) || 10;
        
        const automod = config.automod || {};
        const settings = automod.antiSpamSettings || { useAI: false };
        settings.maxMessages = maxMessages;
        settings.timeWindow = timeWindow;
        automod.antiSpamSettings = settings;
        setGuildConfig(guildId, 'automod', automod);
        
        await interaction.deferUpdate();
        return showAntiSpamConfig(interaction, guildId);
    }
    
    if (customId === 'config_modal_welcome') {
        const message = interaction.fields.getTextInputValue('message');
        setGuildConfig(guildId, 'welcomeMessage', message || null);
        
        await interaction.deferUpdate();
        return showFeaturesMenu(interaction, guildId);
    }
}
