import pkg from 'prismarine-auth';
const { Authflow, Titles } = pkg;
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { storeUserAuth, getUserAuth } from './tokenStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache directory for auth tokens (per user)
const AUTH_CACHE_DIR = join(__dirname, '..', '..', 'data', 'auth_cache');

/**
 * Create an Authflow instance for a Discord user with device code callback
 * @param {string} discordUserId - Discord user ID
 * @param {function} onDeviceCode - Callback when device code is received
 * @returns {Authflow}
 */
export function createAuthflow(discordUserId, onDeviceCode = null) {
    const userCacheDir = join(AUTH_CACHE_DIR, discordUserId);
    
    const options = {
        flow: 'sisu',           // Sisu flow for Bedrock/Realms
        authTitle: Titles.MinecraftNintendoSwitch, // Bedrock auth title
        deviceType: 'Nintendo', // Device type for Bedrock
    };
    
    // The codeCallback is the 4th parameter to Authflow constructor, NOT in options
    const codeCallback = onDeviceCode ? (codeInfo) => {
        console.log('[Auth] Device code callback fired!');
        console.log('[Auth] Code info:', JSON.stringify(codeInfo, null, 2));
        
        // prismarine-auth uses different property names
        const userCode = codeInfo.user_code || codeInfo.userCode;
        const verificationUri = codeInfo.verification_uri || codeInfo.verificationUri || 'https://www.microsoft.com/link';
        const expiresIn = codeInfo.expires_in || codeInfo.expiresIn || 900;
        
        console.log('[Auth] Parsed - Code:', userCode, 'URL:', verificationUri);
        
        onDeviceCode({
            userCode: userCode,
            verificationUri: verificationUri,
            expiresIn: expiresIn,
            message: codeInfo.message
        });
    } : undefined;
    
    return new Authflow(
        discordUserId, // Username identifier
        userCacheDir,  // Cache directory for this user
        options,
        codeCallback   // 4th parameter is the device code callback
    );
}

/**
 * Start device code authentication flow
 * @param {string} discordUserId - Discord user ID
 * @param {function} onDeviceCode - Callback when device code is received
 * @returns {Promise<object>} Authentication result with XBL token and user info
 */
export async function startDeviceCodeAuth(discordUserId, onDeviceCode) {
    const authflow = createAuthflow(discordUserId, onDeviceCode);
    
    // Get Xbox Live token with device code flow
    const xblToken = await authflow.getXboxToken('https://pocket.realms.minecraft.net/');
    
    console.log('[Auth] XBL Token received:', JSON.stringify(xblToken, null, 2));
    
    // Try to get XUID from various sources
    let xuid = xblToken.userXUID || xblToken.xuid || null;
    
    // If no XUID, try to get it from the displayClaims
    if (!xuid && xblToken.displayClaims && xblToken.displayClaims.xui) {
        xuid = xblToken.displayClaims.xui[0]?.xid;
    }
    
    // If still no XUID, try to get the Minecraft Bedrock token which has the XUID
    if (!xuid) {
        try {
            const mcToken = await authflow.getMinecraftBedrockToken();
            console.log('[Auth] MC Bedrock Token received for XUID extraction');
            // The XUID might be in the token chain
            if (mcToken && mcToken.chain) {
                // Parse the JWT to get XUID - it's in the extraData
                for (const jwt of mcToken.chain) {
                    try {
                        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
                        if (payload.extraData && payload.extraData.XUID) {
                            xuid = payload.extraData.XUID;
                            console.log('[Auth] Found XUID in MC token:', xuid);
                            break;
                        }
                    } catch (e) {
                        // Skip invalid JWT
                    }
                }
            }
        } catch (e) {
            console.log('[Auth] Could not get MC Bedrock token for XUID:', e.message);
        }
    }
    
    // Extract user hash and token - the token is XSTSToken in sisu flow
    const authData = {
        xblToken: xblToken.XSTSToken || xblToken.token || xblToken.Token,
        userHash: xblToken.userHash || xblToken.uhs,
        gamertag: xblToken.gamertag || 'Unknown',
        xuid: xuid
    };
    
    console.log('[Auth] Extracted auth data:', JSON.stringify(authData, null, 2));
    
    // Store the auth data
    storeUserAuth(discordUserId, authData);
    
    return authData;
}

/**
 * Get a fresh XBL token for a user (refreshes if needed)
 * @param {string} discordUserId - Discord user ID
 * @returns {Promise<object>} Fresh XBL token data
 */
export async function getXboxToken(discordUserId) {
    const authflow = createAuthflow(discordUserId, null);
    
    // Get existing auth data to preserve XUID
    const existingAuth = getUserAuth(discordUserId);
    const existingXuid = existingAuth?.xuid;
    
    try {
        const xblToken = await authflow.getXboxToken('https://pocket.realms.minecraft.net/');
        
        console.log('[Auth] Refreshed XBL Token:', JSON.stringify(xblToken, null, 2));
        
        // Try to get XUID from displayClaims if not directly available
        let xuid = xblToken.userXUID || xblToken.xuid || null;
        if (!xuid && xblToken.displayClaims && xblToken.displayClaims.xui) {
            xuid = xblToken.displayClaims.xui[0]?.xid;
        }
        
        // IMPORTANT: Preserve existing XUID if we already have one stored
        if (!xuid && existingXuid) {
            xuid = existingXuid;
            console.log('[Auth] Preserving existing XUID:', xuid);
        }
        
        // Update stored auth data - the token is XSTSToken in sisu flow
        const authData = {
            xblToken: xblToken.XSTSToken || xblToken.token || xblToken.Token,
            userHash: xblToken.userHash || xblToken.uhs,
            gamertag: xblToken.gamertag || 'Unknown',
            xuid: xuid
        };
        
        storeUserAuth(discordUserId, authData);
        
        return authData;
    } catch (error) {
        console.error(`Error getting Xbox token for user ${discordUserId}:`, error);
        throw error;
    }
}

/**
 * Build authorization header for Realm API requests
 * @param {string} xblToken - XBL token
 * @param {string} userHash - User hash (uhs)
 * @returns {string} Authorization header value
 */
export function buildAuthHeader(xblToken, userHash) {
    return `XBL3.0 x=${userHash};${xblToken}`;
}
