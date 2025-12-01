import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, closeRealm, openRealm, getRealmInfo } from '../utils/realmsApi.js';

export const data = new SlashCommandBuilder()
    .setName('realm-lockdown')
    .setDescription('Toggle lockdown mode on your Realm (close and prevent joining)')
    .addStringOption(option =>
        option.setName('realm')
            .setDescription('Select your Realm')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('action')
            .setDescription('Enable or disable lockdown')
            .setRequired(true)
            .addChoices(
                { name: '🔒 Enable Lockdown', value: 'enable' },
                { name: '🔓 Disable Lockdown', value: 'disable' }
            ));

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
                    name: `🏰 ${realm.name} ${realm.state === 'CLOSED' ? '🔒' : '🔓'}`,
                    value: JSON.stringify({ id: realm.id, name: realm.name, state: realm.state })
                }));
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    } catch (error) {
        console.error('[RealmLockdown] Autocomplete error:', error);
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
    const action = interaction.options.getString('action');
    
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
        
        if (action === 'enable') {
            // Close the realm
            await closeRealm(guildId, targetRealm.id);
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🔒 Lockdown Enabled!')
                .setDescription(`**${targetRealm.name}** is now in lockdown mode!`)
                .addFields(
                    { name: '🏰 Realm', value: targetRealm.name, inline: true },
                    { name: '📊 Status', value: '🔒 Locked Down', inline: true }
                )
                .setFooter({ text: 'No players can join until lockdown is disabled' })
                .setTimestamp();
            
            return interaction.editReply({ embeds: [embed] });
            
        } else {
            // Open the realm
            await openRealm(guildId, targetRealm.id);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🔓 Lockdown Disabled!')
                .setDescription(`**${targetRealm.name}** lockdown has been lifted!`)
                .addFields(
                    { name: '🏰 Realm', value: targetRealm.name, inline: true },
                    { name: '📊 Status', value: '🔓 Open', inline: true }
                )
                .setFooter({ text: 'Players can now join the realm' })
                .setTimestamp();
            
            return interaction.editReply({ embeds: [embed] });
        }
        
    } catch (error) {
        console.error('[RealmLockdown] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Toggle Lockdown')
            .setDescription('Could not change realm lockdown status.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
