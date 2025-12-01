import { SlashCommandBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';
import { isUserLinked, getUserAuth } from '../utils/tokenStorage.js';
import { getOwnedRealms, getRealmAddress } from '../utils/realmsApi.js';
import { getConnectedRealm, setConnectedRealm } from '../utils/realmStorage.js';
import { connectToRealm, getBotStatus, botEvents } from '../utils/minecraftBot.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const data = new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Connect the bot to one of your Realms');

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    
    // Check if guild is linked
    if (!isUserLinked(guildId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ Account Not Linked')
            .setDescription('This server needs to link a Microsoft account first!')
            .setFooter({ text: 'Server owner must use /setup to link an account' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // Defer with a loading message
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        // Fetch realms in parallel with showing loading state
        const ownedRealms = await getOwnedRealms(guildId);
        
        console.log('[Connect] Owned realms:', JSON.stringify(ownedRealms.map(r => ({
            id: r.id,
            name: r.name
        })), null, 2));

        if (ownedRealms.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ No Realms Found')
                .setDescription('The linked account doesn\'t own any Realms.')
                .setFooter({ text: 'You need to own a Realm to use this feature' });
            
            return interaction.editReply({ embeds: [embed] });
        }
        
        // Check if already connected to a realm
        const currentRealm = getConnectedRealm(guildId);
        
        // Create select menu with owned realms
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_realm')
            .setPlaceholder('Select a Realm to connect to...')
            .addOptions(
                ownedRealms.map(realm => ({
                    label: realm.name,
                    description: `ID: ${realm.id} • ${realm.state === 'OPEN' ? 'Online' : 'Offline'}`,
                    value: JSON.stringify({ id: realm.id, name: realm.name }),
                    emoji: realm.state === 'OPEN' ? '🟢' : '🔴'
                }))
            );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        let description = 'Select a Realm from the dropdown below to connect the bot.';
        if (currentRealm) {
            description = `Currently connected to: **${currentRealm.name}**\n\nSelect a different Realm to switch:`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🔌 Connect to a Realm')
            .setDescription(description)
            .setFooter({ text: 'The bot will join the selected Realm as a player' });
        
        const response = await interaction.editReply({ embeds: [embed], components: [row] });
        
        // Wait for selection
        try {
            const selectInteraction = await response.awaitMessageComponent({
                filter: i => i.user.id === userId && i.customId === 'select_realm',
                time: 60000 // 60 seconds
            });
            
            const selectedRealm = JSON.parse(selectInteraction.values[0]);
            
            await selectInteraction.deferUpdate();
            
            // Show connecting message
            const connectingEmbed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('⏳ Connecting to Realm...')
                .setDescription(`Joining **${selectedRealm.name}**...\n\nThis may take a moment.`)
                .setFooter({ text: 'Please wait...' });
            
            await selectInteraction.editReply({ embeds: [connectingEmbed], components: [] });
            
            // Store the connected realm
            setConnectedRealm(guildId, {
                id: selectedRealm.id,
                name: selectedRealm.name,
                connectedAt: new Date().toISOString()
            });
            
            // Connect the Minecraft bot to the realm
            const authCacheDir = join(__dirname, '..', '..', 'data', 'auth_cache', guildId);
            
            try {
                // Set up the connected event listener BEFORE connecting
                const connectPromise = new Promise((resolve) => {
                    const onConnected = (data) => {
                        if (data.discordUserId === guildId) {
                            botEvents.off('connected', onConnected);
                            resolve(true);
                        }
                    };
                    botEvents.on('connected', onConnected);
                    
                    // Timeout after 15 seconds
                    setTimeout(() => {
                        botEvents.off('connected', onConnected);
                        resolve(false);
                    }, 15000);
                });
                
                // Start connection
                const botData = await connectToRealm(guildId, selectedRealm, authCacheDir);
                
                // Wait for spawn event (or timeout)
                const connected = await connectPromise;
                
                const successEmbed = new EmbedBuilder()
                    .setColor(connected ? 0x00FF00 : 0xFFFF00)
                    .setTitle('✅ Bot Joined Realm!')
                    .setDescription(`Successfully joined **${selectedRealm.name}**`)
                    .addFields(
                        { name: '🏰 Realm ID', value: `\`${selectedRealm.id}\``, inline: true },
                        { name: '📡 Status', value: connected ? '🟢 Connected' : '🟡 Spawning...', inline: true }
                    )
                    .setFooter({ text: connected ? 'The bot is now active in your Realm!' : 'The bot is joining...' })
                    .setTimestamp();
                
                await selectInteraction.editReply({ embeds: [successEmbed], components: [] });
                
            } catch (botError) {
                console.error('[Connect] Bot connection error:', botError);
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Connection Failed')
                    .setDescription(`Could not join **${selectedRealm.name}**`)
                    .addFields(
                        { name: 'Error', value: botError.message || 'Unknown error' }
                    )
                    .setFooter({ text: 'Make sure the realm is online and try again' });
                
                await selectInteraction.editReply({ embeds: [errorEmbed], components: [] });
            }
            
        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                const timeoutEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('⏱️ Selection Timed Out')
                    .setDescription('You didn\'t select a Realm in time. Run `/connect` again.');
                
                await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
            } else {
                throw error;
            }
        }
        
    } catch (error) {
        console.error('Connect error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Error')
            .setDescription('Failed to fetch your Realms. Try again later.')
            .setFooter({ text: 'If this persists, try /unsetup then /setup' });
        
        await interaction.editReply({ embeds: [embed] });
    }
}
