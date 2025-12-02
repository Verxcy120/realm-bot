const { EmbedBuilder } = require('discord.js');

const COLORS = {
    SUCCESS: 0x00FF00,
    ERROR: 0xFF0000,
    WARNING: 0xFFA500,
    INFO: 0x5865F2,
    REALM: 0x7B68EE
};

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setColor(COLORS.SUCCESS)
        .setTimestamp();
}

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setColor(COLORS.ERROR)
        .setTimestamp();
}

function warningEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`⚠️ ${title}`)
        .setDescription(description)
        .setColor(COLORS.WARNING)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description)
        .setColor(COLORS.INFO)
        .setTimestamp();
}

function realmEmbed(realm) {
    const status = realm.state === 'OPEN' ? '🟢 Online' : '🔴 Offline';
    
    return new EmbedBuilder()
        .setTitle(`🏰 ${realm.name || 'Unnamed Realm'}`)
        .setColor(COLORS.REALM)
        .addFields(
            { name: 'Status', value: status, inline: true },
            { name: 'Players', value: `${realm.players?.length || 0}/${realm.maxPlayers || 10}`, inline: true },
            { name: 'Owner', value: realm.owner || 'Unknown', inline: true }
        )
        .setTimestamp();
}

module.exports = {
    COLORS,
    successEmbed,
    errorEmbed,
    warningEmbed,
    infoEmbed,
    realmEmbed
};
