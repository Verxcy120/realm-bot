import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, getRealmInfo, blockPlayer, getXuidFromGamertag } from '../utils/realmsApi.js';
import { sendLog } from '../utils/logging.js';

export const data = new SlashCommandBuilder()
    .setName('realm-ban')
    .setDescription('Ban a player from your Realm')
    .addStringOption(option =>
        option.setName('realm')
            .setDescription('Select your Realm')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('player')
            .setDescription('Select the player to ban')
            .setRequired(true)
            .setAutocomplete(true));

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
        } else if (focusedOption.name === 'player') {
            // Get the selected realm to fetch players
            const realmData = interaction.options.getString('realm');
            if (!realmData || realmData === 'not_linked' || realmData === 'no_realms') {
                choices = [{ name: '⚠️ Select a realm first', value: 'no_realm' }];
            } else {
                try {
                    const realm = JSON.parse(realmData);
                    const realmInfo = await getRealmInfo(guildId, realm.id, true);
                    const players = realmInfo.players || [];
                    
                    if (players.length === 0) {
                        choices = [{ name: '❌ No players on this realm', value: 'no_players' }];
                    } else {
                        const focusedValue = focusedOption.value.toLowerCase();
                        const filtered = players.filter(p => 
                            p.name && p.name.toLowerCase().includes(focusedValue)
                        );
                        
                        choices = filtered.slice(0, 25).map(p => ({
                            name: `🎮 ${p.name || p.uuid}`,
                            value: JSON.stringify({ xuid: p.uuid, name: p.name || p.uuid })
                        }));
                    }
                } catch {
                    choices = [{ name: '⚠️ Select a realm first', value: 'no_realm' }];
                }
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    } catch (error) {
        console.error('[RealmBan] Autocomplete error:', error);
        try {
            await interaction.respond([{ name: '❌ Error loading data', value: 'error' }]);
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
    const playerData = interaction.options.getString('player');
    
    if (realmData === 'not_linked' || realmData === 'no_realms' || realmData === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid Realm from the dropdown.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    if (playerData === 'no_realm' || playerData === 'no_players' || playerData === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid player from the dropdown.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        const targetRealm = JSON.parse(realmData);
        const targetPlayer = JSON.parse(playerData);
        
        console.log(`[RealmBan] Banning ${targetPlayer.name} (${targetPlayer.xuid}) from ${targetRealm.name}`);
        
        await blockPlayer(guildId, targetRealm.id, targetPlayer.xuid);
        
        // Log the ban action
        await sendLog(interaction.client, guildId, 'ban', {
            gamertag: targetPlayer.name,
            xuid: targetPlayer.xuid,
            moderator: interaction.user.id,
            reason: `Banned from ${targetRealm.name}`
        });
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔨 Player Banned!')
            .setDescription(`**${targetPlayer.name}** has been banned from **${targetRealm.name}**!`)
            .addFields(
                { name: '🏰 Realm', value: targetRealm.name, inline: true },
                { name: '🎮 Player', value: targetPlayer.name, inline: true },
                { name: '🔢 XUID', value: targetPlayer.xuid, inline: true }
            )
            .setFooter({ text: 'Use /realm-unban to remove the ban' })
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('[RealmBan] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Ban Player')
            .setDescription('Could not ban the player from the realm.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
