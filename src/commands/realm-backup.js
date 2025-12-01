import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, getBackups, getWorldDownload } from '../utils/realmsApi.js';

export const data = new SlashCommandBuilder()
    .setName('realm-backup')
    .setDescription('View and manage your Realm backups')
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List available backups for your Realm')
            .addStringOption(option =>
                option.setName('realm')
                    .setDescription('Select your Realm')
                    .setRequired(true)
                    .setAutocomplete(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('download')
            .setDescription('Download a specific backup')
            .addStringOption(option =>
                option.setName('realm')
                    .setDescription('Select your Realm')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addStringOption(option =>
                option.setName('backup')
                    .setDescription('Select the backup to download')
                    .setRequired(true)
                    .setAutocomplete(true)));

export async function autocomplete(interaction) {
    const guildId = interaction.guild.id;
    const focusedOption = interaction.options.getFocused(true);
    let choices = [];
    
    try {
        if (!isUserLinked(guildId)) {
            choices = [{ name: '⚠️ Server owner must use /setup first', value: 'not_linked' }];
        } else if (focusedOption.name === 'realm') {
            const ownedRealms = await getOwnedRealms(guildId);
            
            if (ownedRealms.length === 0) {
                choices = [{ name: '❌ No Realms found', value: 'no_realms' }];
            } else {
                const focusedValue = focusedOption.value.toLowerCase();
                const filtered = ownedRealms.filter(realm =>
                    realm.name.toLowerCase().includes(focusedValue)
                );
                
                choices = filtered.map(realm => ({
                    name: `🏰 ${realm.name}`,
                    value: JSON.stringify({ id: realm.id, name: realm.name })
                }));
            }
        } else if (focusedOption.name === 'backup') {
            // Get the selected realm to fetch backups
            const realmData = interaction.options.getString('realm');
            if (!realmData || realmData === 'not_linked' || realmData === 'no_realms') {
                choices = [{ name: '⚠️ Select a realm first', value: 'no_realm' }];
            } else {
                try {
                    const realm = JSON.parse(realmData);
                    const backupsData = await getBackups(guildId, realm.id);
                    const backups = backupsData.backups || [];
                    
                    if (backups.length === 0) {
                        choices = [{ name: '❌ No backups available', value: 'no_backups' }];
                    } else {
                        const focusedValue = focusedOption.value.toLowerCase();
                        choices = backups
                            .slice(0, 25)
                            .map((backup, index) => {
                                const date = new Date(backup.lastModifiedDate);
                                const dateStr = date.toLocaleString();
                                const sizeMB = (backup.size / 1024 / 1024).toFixed(2);
                                return {
                                    name: `📦 ${dateStr} (${sizeMB} MB)`,
                                    value: JSON.stringify({ 
                                        backupId: backup.backupId, 
                                        date: dateStr,
                                        size: sizeMB,
                                        slot: backup.slot || 1
                                    })
                                };
                            })
                            .filter(c => c.name.toLowerCase().includes(focusedValue));
                    }
                } catch (error) {
                    console.error('[RealmBackup] Error fetching backups:', error);
                    choices = [{ name: '⚠️ Select a realm first', value: 'no_realm' }];
                }
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    } catch (error) {
        console.error('[RealmBackup] Autocomplete error:', error);
        try {
            await interaction.respond([{ name: '❌ Error loading data', value: 'error' }]);
        } catch {
            // Already responded
        }
    }
}

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    
    if (!isUserLinked(guildId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('⚠️ Account Not Linked')
            .setDescription('This server needs to link a Microsoft account first!')
            .setFooter({ text: 'Server owner must use /setup to link an account' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const realmData = interaction.options.getString('realm');
    
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
        
        if (subcommand === 'list') {
            const backupsData = await getBackups(guildId, targetRealm.id);
            const backups = backupsData.backups || [];
            
            if (backups.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('📦 No Backups Found')
                    .setDescription(`**${targetRealm.name}** has no backups available.`);
                
                return interaction.editReply({ embeds: [embed] });
            }
            
            const backupList = backups.slice(0, 10).map((backup, index) => {
                const date = new Date(backup.lastModifiedDate);
                const sizeMB = (backup.size / 1024 / 1024).toFixed(2);
                return `**${index + 1}.** ${date.toLocaleString()} • ${sizeMB} MB`;
            }).join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('📦 Realm Backups')
                .setDescription(`Backups for **${targetRealm.name}**`)
                .addFields(
                    { name: '📋 Available Backups', value: backupList || 'None' },
                    { name: '📊 Total Backups', value: `${backups.length}`, inline: true }
                )
                .setFooter({ text: 'Use /realm-backup download to download a specific backup' })
                .setTimestamp();
            
            return interaction.editReply({ embeds: [embed] });
            
        } else if (subcommand === 'download') {
            const backupData = interaction.options.getString('backup');
            
            if (backupData === 'no_realm' || backupData === 'no_backups' || backupData === 'error') {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Invalid Selection')
                    .setDescription('Please select a valid backup from the dropdown.');
                
                return interaction.editReply({ embeds: [embed] });
            }
            
            const backup = JSON.parse(backupData);
            
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0x3498db)
                    .setTitle('⏳ Generating Download Link...')
                    .setDescription(`Getting download link for backup from ${backup.date}...`)
                ]
            });
            
            // Get download link for the backup slot
            const downloadInfo = await getWorldDownload(guildId, targetRealm.id, backup.slot);
            
            if (!downloadInfo.downloadLink) {
                throw new Error('No download link received from Realms API');
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('📥 Backup Download Ready')
                .setDescription(`Download link for **${targetRealm.name}** backup`)
                .addFields(
                    { name: '🏰 Realm', value: targetRealm.name, inline: true },
                    { name: '📅 Backup Date', value: backup.date, inline: true },
                    { name: '📦 Size', value: `${backup.size} MB`, inline: true },
                    { name: '🔗 Download Link', value: `[Click to download .mcworld](${downloadInfo.downloadLink})` }
                )
                .setFooter({ text: '⚠️ Link expires in ~30 minutes' })
                .setTimestamp();
            
            return interaction.editReply({ embeds: [embed] });
        }
        
    } catch (error) {
        console.error('[RealmBackup] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Load Backups')
            .setDescription('Could not retrieve backup information.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
