const { Authflow, Titles } = require('prismarine-auth');
const path = require('path');

const AUTH_CACHE_DIR = path.join(__dirname, '../../auth_cache');

/**
 * Get Authflow instance for a user with device code callback
 */
function getAuthflow(discordId, codeCallback = null) {
    const options = {
        authTitle: Titles.MinecraftNintendoSwitch,
        deviceType: 'Nintendo',
        flow: 'live'
    };
    
    // codeCallback is the 4th argument, not an option
    return new Authflow(discordId, AUTH_CACHE_DIR, options, codeCallback);
}

/**
 * Get Xbox Live token for a user (from cache if available)
 */
async function getXboxToken(discordId) {
    try {
        const authflow = getAuthflow(discordId);
        const token = await authflow.getXboxToken();
        return token;
    } catch (error) {
        console.error('Error getting Xbox token:', error);
        throw error;
    }
}

/**
 * Get Minecraft Bedrock token for Realms API access
 */
async function getMinecraftBedrockToken(discordId) {
    try {
        const authflow = getAuthflow(discordId);
        const token = await authflow.getMinecraftBedrockToken();
        return token;
    } catch (error) {
        console.error('Error getting Minecraft Bedrock token:', error);
        throw error;
    }
}

/**
 * Start device code authentication flow
 * Returns the device code info for the user to authenticate
 */
async function startDeviceCodeAuth(discordId, codeCallback) {
    const authflow = getAuthflow(discordId, codeCallback);
    const token = await authflow.getXboxToken();
    return token;
}

module.exports = {
    getAuthflow,
    getXboxToken,
    getMinecraftBedrockToken,
    startDeviceCodeAuth
};
