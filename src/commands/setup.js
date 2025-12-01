import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { startDeviceCodeAuth } from '../utils/auth.js';
import { isUserLinked, getUserAuth } from '../utils/tokenStorage.js';
import { getOwnedRealms, extractAndStoreXuid } from '../utils/realmsApi.js';

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Link your Microsoft/Xbox account to use Realm features (Guild Owner Only)');

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    
    // Check if user is the guild owner
    if (interaction.guild.ownerId !== userId) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Permission Denied')
            .setDescription('Only the **server owner** can run this command.')
            .setFooter({ text: 'Contact your server owner to set up the bot' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // Check if guild is already linked - show their realms
    if (isUserLinked(guildId)) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        // Fetch their owned realms
        let realmsList = 'No realms found';
        try {
            // Make sure we have XUID extracted
            const xuid = await extractAndStoreXuid(guildId);
            console.log('[Setup] Already linked - XUID:', xuid);
            
            if (!xuid) {
                realmsList = 'You don\'t own any realms';
            } else {
                const ownedRealms = await getOwnedRealms(guildId);
                
                if (ownedRealms.length > 0) {
                    realmsList = ownedRealms.map(realm => {
                        const status = realm.state === 'OPEN' ? '🟢' : '🔴';
                        return `${status} **${realm.name}** \`(${realm.id})\``;
                    }).join('\n');
                } else {
                    realmsList = 'You don\'t own any realms';
                }
            }
        } catch (realmError) {
            console.error('[Setup] Error fetching realms:', realmError);
            realmsList = '⚠️ Could not fetch realms';
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Account Already Linked')
            .setDescription('This server\'s Microsoft account is linked to this bot.')
            .addFields(
                { name: '🏰 Your Realms', value: realmsList }
            )
            .setFooter({ text: 'Use /unsetup to unlink your account' })
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
    }
    
    // Send initial response
    const loadingEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🔗 Microsoft Account Linking')
        .setDescription('Generating your login code...')
        .setFooter({ text: 'Please wait...' });
    
    await interaction.reply({ embeds: [loadingEmbed], flags: MessageFlags.Ephemeral });
    
    try {
        // Start device code auth flow
        const authResult = await startDeviceCodeAuth(guildId, async (deviceCodeInfo) => {
            console.log('[Setup] Received device code in command:', deviceCodeInfo.userCode);
            
            // Update the message with the device code
            const codeEmbed = new EmbedBuilder()
                .setColor(0x00D4FF)
                .setTitle('🔗 Link Your Microsoft Account')
                .setDescription(
                    `**Step 1:** Click the link below to open Microsoft's login page\n` +
                    `**Step 2:** Enter the code shown below\n` +
                    `**Step 3:** Sign in with your Microsoft account`
                )
                .addFields(
                    { 
                        name: '🌐 Login Page', 
                        value: `### [Click Here to Login](${deviceCodeInfo.verificationUri})`,
                        inline: false
                    },
                    { 
                        name: '🔑 Your Code', 
                        value: `# \`${deviceCodeInfo.userCode}\``,
                        inline: false
                    },
                    {
                        name: '⏱️ Expires',
                        value: `<t:${Math.floor(Date.now() / 1000) + deviceCodeInfo.expiresIn}:R>`,
                        inline: true
                    }
                )
                .setFooter({ text: '⏳ Waiting for you to sign in...' })
                .setTimestamp();
            
            try {
                await interaction.editReply({ embeds: [codeEmbed] });
                console.log('[Setup] Embed updated successfully!');
            } catch (editError) {
                console.error('[Setup] Failed to edit reply:', editError);
            }
        });
        
        // Auth successful! Now extract XUID and fetch owned realms
        let realmsList = 'No realms found';
        try {
            // Extract XUID by checking which realms we can access backups for
            console.log('[Setup] Extracting XUID from realm ownership...');
            const xuid = await extractAndStoreXuid(guildId);
            console.log('[Setup] Extracted XUID:', xuid);
            
            if (!xuid) {
                realmsList = 'You don\'t own any realms';
            } else {
                // Now get owned realms (filtered by XUID)
                const ownedRealms = await getOwnedRealms(guildId);
                
                console.log('[Setup] Owned realms:', JSON.stringify(ownedRealms.map(r => ({ id: r.id, name: r.name })), null, 2));
                
                if (ownedRealms.length > 0) {
                    realmsList = ownedRealms.map(realm => {
                        const status = realm.state === 'OPEN' ? '🟢' : '🔴';
                        return `${status} **${realm.name}** \`(${realm.id})\``;
                    }).join('\n');
                } else {
                    realmsList = 'You don\'t own any realms';
                }
            }
        } catch (realmError) {
            console.error('[Setup] Error fetching realms:', realmError);
            realmsList = '⚠️ Could not fetch realms';
        }
        
        const successEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Account Linked Successfully!')
            .setDescription('This server\'s Microsoft account has been linked to this bot.')
            .addFields(
                { name: '🏰 Your Realms', value: realmsList }
            )
            .setFooter({ text: 'Use /unsetup to unlink your account' })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed] });
        
    } catch (error) {
        console.error('Setup error:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Authentication Failed')
            .setDescription('Failed to link your account. This could happen if:')
            .addFields(
                { name: 'Possible causes', value: 
                    '• The code expired before you signed in\n' +
                    '• You cancelled the sign-in process\n' +
                    '• There was a network error\n' +
                    '• Your account doesn\'t own Minecraft'
                }
            )
            .setFooter({ text: 'Try running /setup again' });
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
}
