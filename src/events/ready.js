const { Events, ActivityType } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        console.log(`✅ Logged in as ${client.user.tag}`);
        console.log(`📊 Serving ${client.guilds.cache.size} servers`);
        
        // Set bot activity
        client.user.setActivity('Minecraft Realms', { type: ActivityType.Watching });
    }
};
