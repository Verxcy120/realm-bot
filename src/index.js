require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { startAuthServer } = require('./auth/server');
const { loadCommands } = require('./handlers/commandHandler');
const { loadEvents } = require('./handlers/eventHandler');
const { initDatabase } = require('./database/db');
const { handlePrefixCommands } = require('./handlers/prefixHandler');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.commands = new Collection();

// Handle prefix commands
client.on('messageCreate', (message) => handlePrefixCommands(message, client));

async function main() {
    try {
        // Initialize database
        initDatabase();
        console.log('✅ Database initialized');

        // Load commands and events
        await loadCommands(client);
        await loadEvents(client);

        // Start the OAuth server for Microsoft authentication
        startAuthServer(client);
        console.log('✅ Auth server started');

        // Login to Discord
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('❌ Error starting bot:', error);
        process.exit(1);
    }
}

main();
