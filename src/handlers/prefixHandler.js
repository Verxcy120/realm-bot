const { EmbedBuilder } = require('discord.js');
const { addToBlacklist, removeFromBlacklist, isBlacklisted, getAllBlacklisted } = require('../database/db');
const Emojis = require('../utils/emojis');

const PREFIX = '.';
const OWNER_ID = process.env.OWNER_ID;

async function handlePrefixCommands(message, client) {
    // Ignore bots and messages without prefix
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    // Only owner can use prefix commands
    if (message.author.id !== OWNER_ID) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // .blacklist <userId> [reason]
    if (command === 'blacklist') {
        const userId = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!userId) {
            return message.reply(`${Emojis.Error} Usage: \`.blacklist <userId> [reason]\``);
        }

        // Check if already blacklisted
        const existing = isBlacklisted(userId);
        if (existing) {
            return message.reply(`${Emojis.Error} User \`${userId}\` is already blacklisted.`);
        }

        // Add to blacklist
        addToBlacklist(userId, reason, message.author.id);

        const embed = new EmbedBuilder()
            .setTitle(`${Emojis.Success} User Blacklisted`)
            .setColor(0xFF0000)
            .addFields(
                { name: 'User ID', value: `\`${userId}\``, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Blacklisted By', value: `<@${message.author.id}>`, inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // .unblacklist <userId>
    if (command === 'unblacklist') {
        const userId = args[0];

        if (!userId) {
            return message.reply(`${Emojis.Error} Usage: \`.unblacklist <userId>\``);
        }

        // Check if blacklisted
        const existing = isBlacklisted(userId);
        if (!existing) {
            return message.reply(`${Emojis.Error} User \`${userId}\` is not blacklisted.`);
        }

        // Remove from blacklist
        removeFromBlacklist(userId);

        const embed = new EmbedBuilder()
            .setTitle(`${Emojis.Success} User Unblacklisted`)
            .setColor(0x00FF00)
            .addFields(
                { name: 'User ID', value: `\`${userId}\``, inline: true },
                { name: 'Removed By', value: `<@${message.author.id}>`, inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // .blacklisted - List all blacklisted users
    if (command === 'blacklisted') {
        const blacklisted = getAllBlacklisted();

        if (blacklisted.length === 0) {
            return message.reply(`${Emojis.Success} No users are blacklisted.`);
        }

        const list = blacklisted.map((b, i) => 
            `**${i + 1}.** \`${b.discord_id}\`\n   Reason: ${b.reason}\n   Date: <t:${b.blacklisted_at}:R>`
        ).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`${Emojis.Error} Blacklisted Users (${blacklisted.length})`)
            .setDescription(list.slice(0, 4000))
            .setColor(0xFF0000)
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // .checkbl <userId> - Check if user is blacklisted
    if (command === 'checkbl') {
        const userId = args[0];

        if (!userId) {
            return message.reply(`${Emojis.Error} Usage: \`.checkbl <userId>\``);
        }

        const blacklisted = isBlacklisted(userId);

        if (blacklisted) {
            const embed = new EmbedBuilder()
                .setTitle(`${Emojis.Error} User is Blacklisted`)
                .setColor(0xFF0000)
                .addFields(
                    { name: 'User ID', value: `\`${userId}\``, inline: true },
                    { name: 'Reason', value: blacklisted.reason, inline: true },
                    { name: 'Blacklisted', value: `<t:${blacklisted.blacklisted_at}:R>`, inline: true }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        } else {
            return message.reply(`${Emojis.Success} User \`${userId}\` is not blacklisted.`);
        }
    }
}

module.exports = { handlePrefixCommands };
