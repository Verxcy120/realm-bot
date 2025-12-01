import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getBotStatus, runCommand } from '../utils/minecraftBot.js';
import { getConnectedRealm } from '../utils/realmStorage.js';

export const data = new SlashCommandBuilder()
    .setName('realm-execute')
    .setDescription('Execute a command on the Realm (requires bot to be connected and OP)')
    .addStringOption(option =>
        option.setName('command')
            .setDescription('The command to execute (without /)')
            .setRequired(true)
            .setAutocomplete(true));

// Common Minecraft commands for autocomplete
const COMMON_COMMANDS = [
    { name: '⏰ Set Day', value: 'time set day' },
    { name: '🌙 Set Night', value: 'time set night' },
    { name: '☀️ Clear Weather', value: 'weather clear' },
    { name: '🌧️ Set Rain', value: 'weather rain' },
    { name: '⛈️ Set Thunder', value: 'weather thunder' },
    { name: '💀 Kill All Mobs', value: 'kill @e[type=!player]' },
    { name: '📍 Get Position', value: 'tp @s ~ ~ ~' },
    { name: '🎮 Gamemode Survival', value: 'gamemode survival @a' },
    { name: '🎮 Gamemode Creative', value: 'gamemode creative @a' },
    { name: '🎮 Gamemode Adventure', value: 'gamemode adventure @a' },
    { name: '💬 Say Hello', value: 'say Hello from Discord!' },
    { name: '📢 Title Test', value: 'title @a title Welcome!' },
    { name: '🔔 Playsound', value: 'playsound random.levelup @a' },
    { name: '📊 List Players', value: 'list' },
    { name: '🏷️ Show Scoreboard', value: 'scoreboard objectives list' }
];

export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    
    let choices;
    if (focusedValue === '') {
        // Show common commands when empty
        choices = COMMON_COMMANDS;
    } else {
        // Filter based on input
        choices = COMMON_COMMANDS.filter(cmd => 
            cmd.name.toLowerCase().includes(focusedValue) ||
            cmd.value.toLowerCase().includes(focusedValue)
        );
        
        // Add the custom command as first option if it doesn't match any preset
        if (choices.length === 0 || !choices.some(c => c.value.toLowerCase() === focusedValue)) {
            choices.unshift({ name: `📝 Custom: ${focusedValue}`, value: focusedValue });
        }
    }
    
    await interaction.respond(choices.slice(0, 25));
}

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    
    if (!isUserLinked(guildId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ Account Not Linked')
            .setDescription('This server needs to link a Microsoft account first!')
            .setFooter({ text: 'Server owner must use /setup to link an account' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const connectedRealm = getConnectedRealm(guildId);
    if (!connectedRealm) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Bot Not Connected')
            .setDescription('The bot is not connected to any Realm!')
            .setFooter({ text: 'Use /connect to connect the bot to a Realm first' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const botStatus = getBotStatus(guildId);
    if (!botStatus || botStatus.status !== 'connected') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Bot Not Online')
            .setDescription('The bot is not currently online on the Realm!')
            .addFields({ name: 'Status', value: botStatus?.status || 'disconnected' })
            .setFooter({ text: 'Use /connect to reconnect the bot' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const command = interaction.options.getString('command');
    
    // Remove leading slash if present
    const cleanCommand = command.startsWith('/') ? command.substring(1) : command;
    
    try {
        const success = runCommand(guildId, cleanCommand);
        
        if (success) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Command Executed')
                .setDescription(`Command sent to **${connectedRealm.name}**!`)
                .addFields(
                    { name: '📝 Command', value: `\`/${cleanCommand}\``, inline: false }
                )
                .setFooter({ text: 'Note: Command output is not captured' })
                .setTimestamp();
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
            throw new Error('Failed to send command to bot');
        }
        
    } catch (error) {
        console.error('[RealmExecute] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Execute Command')
            .setDescription('Could not execute the command on the Realm.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}
