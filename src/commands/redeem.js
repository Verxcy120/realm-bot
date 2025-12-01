import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { createPremiumCode, redeemCode } from '../utils/premiumStorage.js';

// Bot owner Discord ID
const BOT_OWNER_ID = '1056287776863158312';

export const data = new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Manage and redeem premium codes')
    .addSubcommand(subcommand =>
        subcommand
            .setName('code')
            .setDescription('Redeem a premium code for this server')
            .addStringOption(option =>
                option.setName('code')
                    .setDescription('The premium code to redeem')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('generate')
            .setDescription('[Owner Only] Generate a new premium code')
            .addIntegerOption(option =>
                option.setName('days')
                    .setDescription('Number of days the code grants')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(3650)));

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    
    if (subcommand === 'code') {
        // Only guild owner can redeem codes
        if (interaction.guild.ownerId !== userId) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Access Denied')
                .setDescription('Only the server owner can redeem premium codes for this server.');
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        // Redeem a code
        const code = interaction.options.getString('code').toUpperCase().trim();
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const result = redeemCode(code, guildId, userId);
        
        if (result.success) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🎉 Premium Activated!')
                .setDescription(`Premium has been activated for this server!`)
                .addFields(
                    { name: '⏰ Days Added', value: `${result.daysAdded} days`, inline: true },
                    { name: '📅 Expires', value: result.expiresAt.toLocaleDateString(), inline: true }
                )
                .setFooter({ text: 'Thank you for supporting the bot!' })
                .setTimestamp();
            
            return interaction.editReply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Redemption Failed')
                .setDescription(result.message);
            
            return interaction.editReply({ embeds: [embed] });
        }
        
    } else if (subcommand === 'generate') {
        // Owner only - generate code
        if (userId !== BOT_OWNER_ID) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Access Denied')
                .setDescription('Only the bot owner can generate premium codes.');
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const days = interaction.options.getInteger('days');
        const newCode = createPremiumCode(days, userId);
        
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🎫 Premium Code Generated')
            .setDescription('A new premium code has been created!')
            .addFields(
                { name: '🔑 Code', value: `\`${newCode}\``, inline: false },
                { name: '⏰ Duration', value: `${days} days`, inline: true }
            )
            .setFooter({ text: 'Share this code with a server owner' })
            .setTimestamp();
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}
