import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal styling
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    bgBlue: '\x1b[44m',
    white: '\x1b[37m'
};

const c = colors;

// Pretty print functions
const log = {
    header: (text) => console.log(`\n${c.bgBlue}${c.white}${c.bright} ${text} ${c.reset}\n`),
    command: (name) => console.log(`  ${c.green}✓${c.reset} ${c.cyan}/${name}${c.reset}`),
    info: (text) => console.log(`  ${c.blue}ℹ${c.reset} ${c.dim}${text}${c.reset}`),
    success: (text) => console.log(`\n  ${c.green}${c.bright}✅ ${text}${c.reset}`),
    warn: (text) => console.log(`  ${c.yellow}⚠${c.reset} ${c.yellow}${text}${c.reset}`),
    error: (text) => console.log(`\n  ${c.red}${c.bright}❌ ${text}${c.reset}`),
    divider: () => console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`)
};

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Load all commands
async function loadCommands() {
    log.header('LOADING COMMANDS');
    
    for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const command = await import(`file://${filePath}`);
        
        if ('data' in command) {
            commands.push(command.data.toJSON());
            log.command(command.data.name);
        }
    }
    
    log.divider();
    log.info(`Loaded ${commands.length} commands from ${commandFiles.length} files`);
}

// Deploy commands
async function deploy() {
    console.clear();
    console.log(`
${c.cyan}${c.bright}
  ██████╗ ███████╗ █████╗ ██╗     ███╗   ███╗    ██████╗  ██████╗ ████████╗
  ██╔══██╗██╔════╝██╔══██╗██║     ████╗ ████║    ██╔══██╗██╔═══██╗╚══██╔══╝
  ██████╔╝█████╗  ███████║██║     ██╔████╔██║    ██████╔╝██║   ██║   ██║   
  ██╔══██╗██╔══╝  ██╔══██║██║     ██║╚██╔╝██║    ██╔══██╗██║   ██║   ██║   
  ██║  ██║███████╗██║  ██║███████╗██║ ╚═╝ ██║    ██████╔╝╚██████╔╝   ██║   
  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝    ╚═════╝  ╚═════╝    ╚═╝   
${c.reset}${c.dim}                     Command Deployment Tool${c.reset}
`);
    
    await loadCommands();
    
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    
    try {
        log.header('DEPLOYING TO DISCORD');
        
        const isGuild = !!process.env.DISCORD_GUILD_ID;
        log.info(`Mode: ${isGuild ? 'Guild (instant)' : 'Global (up to 1 hour)'}`);
        log.info(`Commands: ${commands.length}`);
        log.divider();
        
        let data;
        
        if (isGuild) {
            data = await rest.put(
                Routes.applicationGuildCommands(
                    process.env.DISCORD_CLIENT_ID,
                    process.env.DISCORD_GUILD_ID
                ),
                { body: commands }
            );
            log.success(`Registered ${data.length} commands to guild`);
            log.info(`Guild ID: ${process.env.DISCORD_GUILD_ID}`);
        } else {
            data = await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: commands }
            );
            log.success(`Registered ${data.length} global commands`);
            log.warn('Global commands can take up to 1 hour to appear');
        }
        
        console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}`);
        console.log(`${c.green}${c.bright}  🎉 Deployment Complete!${c.reset}\n`);
        
    } catch (error) {
        log.error('Deployment failed');
        console.error(`\n${c.dim}${error.stack || error}${c.reset}\n`);
        process.exit(1);
    }
}

deploy();
