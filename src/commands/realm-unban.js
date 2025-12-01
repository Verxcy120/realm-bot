import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isUserLinked } from '../utils/tokenStorage.js';
import { getOwnedRealms, getBlocklist, unblockPlayer, getGamertagsFromXuids } from '../utils/realmsApi.js';
import { sendLog } from '../utils/logging.js';

export const data = new SlashCommandBuilder()
    .setName('realm-unban')
    .setDescription('Unban a player from your Realm')
    .addStringOption(option =>
        option.setName('realm')
            .setDescription('Select your Realm')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('player')
            .setDescription('Select the player to unban')
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
            // Get the selected realm to fetch blocklist
            const realmData = interaction.options.getString('realm');
            if (!realmData || realmData === 'not_linked' || realmData === 'no_realms') {
                choices = [{ name: '⚠️ Select a realm first', value: 'no_realm' }];
            } else {
                try {
                    const realm = JSON.parse(realmData);
                    const blocklist = await getBlocklist(guildId, realm.id);
                    const blockedPlayers = blocklist.blockedPlayers || [];
                    
                    if (blockedPlayers.length === 0) {
                        choices = [{ name: '✅ No banned players', value: 'no_banned' }];
                    } else {
                        // Try to get gamertags for blocked XUIDs
                        const xuids = blockedPlayers.map(p => p.xuid || p);
                        const gamertagMap = await getGamertagsFromXuids(guildId, xuids);
                        
                        const focusedValue = focusedOption.value.toLowerCase();
                        choices = blockedPlayers
                            .map(p => {
                                const xuid = p.xuid || p;
                                const name = gamertagMap.get(xuid) || `Unknown (${xuid})`;
                                return { xuid, name };
                            })
                            .filter(p => p.name.toLowerCase().includes(focusedValue))
                            .slice(0, 25)
                            .map(p => ({
                                name: `🚫 ${p.name}`,
                                value: JSON.stringify({ xuid: p.xuid, name: p.name })
                            }));
                    }
                } catch (error) {
                    console.error('[RealmUnban] Error fetching blocklist:', error);
                    choices = [{ name: '⚠️ Select a realm first', value: 'no_realm' }];
                }
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    } catch (error) {
        console.error('[RealmUnban] Autocomplete error:', error);
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
    
    if (playerData === 'no_realm' || playerData === 'no_banned' || playerData === 'error') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Selection')
            .setDescription('Please select a valid banned player from the dropdown.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        const targetRealm = JSON.parse(realmData);
        const targetPlayer = JSON.parse(playerData);
        
        console.log(`[RealmUnban] Unbanning ${targetPlayer.name} (${targetPlayer.xuid}) from ${targetRealm.name}`);
        
        await unblockPlayer(guildId, targetRealm.id, targetPlayer.xuid);
        
        // Log the unban action
        await sendLog(interaction.client, guildId, 'unban', {
            gamertag: targetPlayer.name,
            xuid: targetPlayer.xuid,
            moderator: interaction.user.id
        });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Player Unbanned!')
            .setDescription(`**${targetPlayer.name}** has been unbanned from **${targetRealm.name}**!`)
            .addFields(
                { name: '🏰 Realm', value: targetRealm.name, inline: true },
                { name: '🎮 Player', value: targetPlayer.name, inline: true }
            )
            .setFooter({ text: 'The player can now join the realm again' })
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('[RealmUnban] Error:', error);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Failed to Unban Player')
            .setDescription('Could not unban the player from the realm.')
            .addFields({
                name: 'Error',
                value: error.message || 'Unknown error'
            });
        
        return interaction.editReply({ embeds: [embed] });
    }
}
