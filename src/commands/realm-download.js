import { SlashCommandBuilder, EmbedBuilder, MessageFlags, AttachmentBuilder } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, getWorldDownload } from '../utils/realmsApi.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const data = new SlashCommandBuilder()
    .setName('realm-download')
    .setDescription('Download your Realm world as a .mcworld file')
    .addStringOption(option =>
        option.setName('realm')
            .setDescription('Select your Realm')
            .setRequired(true)
            .setAutocomplete(true))
    .addIntegerOption(option =>
        option.setName('slot')
            .setDescription('World slot to download (1-4, default: active slot)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(4));

export async function autocomplete(interaction) {
    const guildId = interaction.guild.id;
    let choices = [];
    
    try {
        if (!isUserLinked(guildId)) {
            choices = [{ name: '⚠️ Server owner must use /setup first', value: 'not_linked' }];
        } else {
            const ownedRealms = await getOwnedRealms(guildId);
            
            if (ownedRealms.length === 0) {
                choices = [{ name: '❌ No Realms found', value: 'no_realms' }];
            } else {
                const focusedValue = interaction.options.getFocused().toLowerCase();
                const filtered = ownedRealms.filter(realm =>
                    realm.name.toLowerCase().includes(focusedValue)
                );
                
                choices = filtered.map(realm => ({
                    name: `🏰 ${realm.name}`,
                    value: JSON.stringify({ id: realm.id, name: realm.name, activeSlot: realm.activeSlot })
                }));
            }
        }
        
        await interaction.respond(choices);
    } catch (error) {
        console.error('[RealmDownload] Autocomplete error:', error);
        try {
            await interaction.respond([{ name: '❌ Error loading realms', value: 'error' }]);
        } catch {
            // Already responded
        }
    }
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
    
    const realmData = interaction.options.getString('realm');
    const slotOption = interaction.options.getInteger('slot');
    
    if (realmData === 'not_linked' || realmData === 'no_realms' || realmData === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid Realm from the dropdown.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        const targetRealm = JSON.parse(realmData);
        const slot = slotOption || targetRealm.activeSlot || 1;
        
        // Send initial status
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('⏳ Preparing Download...')
                .setDescription(`Getting download link for **${targetRealm.name}**...`)
            ]
        });
        
        const downloadInfo = await getWorldDownload(guildId, targetRealm.id, slot);
        
        if (!downloadInfo.downloadLink) {
            throw new Error('No download link received from Realms API');
        }
        
        // Update status
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('⏳ Downloading World...')
                .setDescription(`Downloading **${targetRealm.name}** from Realms servers...`)
            ]
        });
        
        // Download the world file
        console.log('[RealmDownload] Downloading from:', downloadInfo.downloadLink);
        const response = await fetch(downloadInfo.downloadLink);
        
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Create a safe filename
        const safeName = targetRealm.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${safeName}_slot${slot}.mcworld`;
        
        // Create temp directory if needed
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Save temporarily
        const tempPath = path.join(tempDir, filename);
        fs.writeFileSync(tempPath, buffer);
        
        // Get file size
        const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
        
        // Check if file is too large for Discord (25MB limit for non-nitro)
        if (buffer.length > 25 * 1024 * 1024) {
            // File too large, provide the direct link instead
            const embed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('📥 World Download Ready')
                .setDescription(`**${targetRealm.name}** is too large to upload directly (${fileSizeMB} MB).\nUse the link below to download:`)
                .addFields(
                    { name: '🏰 Realm', value: targetRealm.name, inline: true },
                    { name: '📁 Slot', value: `${slot}`, inline: true },
                    { name: '📦 Size', value: `${fileSizeMB} MB`, inline: true },
                    { name: '🔗 Download Link', value: `[Click to download .mcworld](${downloadInfo.downloadLink})` }
                )
                .setFooter({ text: '⚠️ Link expires in ~30 minutes • Rename file to .mcworld after downloading' })
                .setTimestamp();
            
            // Clean up temp file
            fs.unlinkSync(tempPath);
            
            return interaction.editReply({ embeds: [embed] });
        }
        
        // Create attachment
        const attachment = new AttachmentBuilder(buffer, { name: filename });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('📥 World Downloaded!')
            .setDescription(`Here's your **${targetRealm.name}** world as a .mcworld file!`)
            .addFields(
                { name: '🏰 Realm', value: targetRealm.name, inline: true },
                { name: '📁 Slot', value: `${slot}`, inline: true },
                { name: '📦 Size', value: `${fileSizeMB} MB`, inline: true }
            )
            .setFooter({ text: '💡 Double-click the .mcworld file to import into Minecraft' })
            .setTimestamp();
        
        // Clean up temp file
        fs.unlinkSync(tempPath);
        
        return interaction.editReply({ embeds: [embed], files: [attachment] });
        
    } catch (error) {
        console.error('[RealmDownload] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Get Download')
            .setDescription('Could not generate a download link for the realm.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            })
            .setFooter({ text: 'Make sure you own this realm' });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
