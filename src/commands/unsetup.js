import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked, removeUserAuth, getUserAuth } from '../utils/tokenStorage.js';
import { rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const data = new SlashCommandBuilder()
    .setName('unsetup')
    .setDescription('Unlink your Microsoft/Xbox account from this bot (Guild Owner Only)');

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    
    // Check if user is the guild owner
    if (interaction.guild.ownerId !== userId) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Permission Denied')
            .setDescription('Only the **server owner** can run this command.')
            .setFooter({ text: 'Contact your server owner to manage the bot' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // Check if guild is linked
    if (!isUserLinked(guildId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ No Account Linked')
            .setDescription('This server doesn\'t have a Microsoft account linked to this bot.')
            .setFooter({ text: 'Use /setup to link your account' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // Defer reply first to prevent timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    // Get user info before removing
    const authData = getUserAuth(guildId);
    
    // Remove the guild's auth data from tokens.json
    removeUserAuth(guildId);
    
    // Also remove the auth cache folder for this guild
    const authCacheDir = join(__dirname, '..', '..', 'data', 'auth_cache', guildId);
    try {
        if (existsSync(authCacheDir)) {
            rmSync(authCacheDir, { recursive: true, force: true });
            console.log(`[Unsetup] Removed auth cache for guild ${guildId}`);
        }
    } catch (error) {
        console.error(`[Unsetup] Error removing auth cache:`, error);
    }
    
    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🔓 Account Unlinked')
        .setDescription('This server\'s Microsoft account has been disconnected from this bot.')
        .addFields(
            { 
                name: '🗑️ Data Removed', 
                value: 
                    '• Authentication tokens deleted\n' +
                    '• Cached credentials removed\n' +
                    '• Session data cleared'
            }
        )
        .setFooter({ text: 'Use /setup to link again' })
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}
