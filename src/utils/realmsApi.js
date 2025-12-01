import { buildAuthHeader, getXboxToken } from './auth.js';
import { getUserAuth, storeUserAuth } from './tokenStorage.js';

const REALMS_API_BASE = 'https://pocket.realms.minecraft.net';
const XBOX_PROFILE_API = 'https://profile.xboxlive.com';

// ═══════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════

const rateLimitQueue = [];
let isProcessingQueue = false;
const MIN_REQUEST_INTERVAL = 100; // Minimum 100ms between requests
let lastRequestTime = 0;

/**
 * Execute a function with rate limiting
 */
async function rateLimitedRequest(fn) {
    return new Promise((resolve, reject) => {
        rateLimitQueue.push({ fn, resolve, reject });
        processRateLimitQueue();
    });
}

async function processRateLimitQueue() {
    if (isProcessingQueue || rateLimitQueue.length === 0) return;
    
    isProcessingQueue = true;
    
    while (rateLimitQueue.length > 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
        }
        
        const { fn, resolve, reject } = rateLimitQueue.shift();
        lastRequestTime = Date.now();
        
        try {
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        }
    }
    
    isProcessingQueue = false;
}

// Cache gamertags - can be populated manually or via other means
// Users can also type gamertags manually
const gamertagCache = new Map([
    // Add known XUIDs -> Gamertags here
    // These are from your realm - update as needed
    ['2535435384199055', 'RoyalRealms0'],      // Your main account (realm owner)
    ['2535455895125940', 'Verxcy12O'],         // Bot account
    ['2535428798750708', 'vex CRAB'],          // Another player
]);

// Cache for Xbox profiles (gamerscore, etc.)
const profileCache = new Map();
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for owned realms (per guild) - speeds up autocomplete
const realmsCache = new Map();
const REALMS_CACHE_TTL = 30 * 1000; // 30 seconds

/**
 * Get Xbox profile for a player (includes gamerscore)
 * @param {string} discordUserId - Discord user ID (for auth)
 * @param {string} xuid - Xbox User ID
 * @returns {Promise<object|null>} Profile data or null
 */
export async function getXboxProfile(discordUserId, xuid) {
    // Check cache first
    const cached = profileCache.get(xuid);
    if (cached && Date.now() - cached.timestamp < PROFILE_CACHE_TTL) {
        return cached.data;
    }
    
    // Use rate limiting for Xbox API calls
    return rateLimitedRequest(async () => {
        try {
            const authData = await getXboxToken(discordUserId);
            
            const response = await fetch(`${XBOX_PROFILE_API}/users/xuid(${xuid})/profile/settings?settings=Gamerscore,GameDisplayPicRaw,Gamertag,AccountTier,XboxOneRep`, {
                headers: {
                    'Authorization': buildAuthHeader(authData.xblToken, authData.userHash),
                    'x-xbl-contract-version': '2',
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.log(`[XboxAPI] Failed to get profile for ${xuid}: ${response.status}`);
                return null;
            }
            
            const data = await response.json();
            const settings = data.profileUsers?.[0]?.settings || [];
            
            const profile = {
                xuid: xuid,
                gamertag: settings.find(s => s.id === 'Gamertag')?.value || null,
                gamerscore: settings.find(s => s.id === 'Gamerscore')?.value || '0',
                avatar: settings.find(s => s.id === 'GameDisplayPicRaw')?.value || null,
                accountTier: settings.find(s => s.id === 'AccountTier')?.value || null,
                reputation: settings.find(s => s.id === 'XboxOneRep')?.value || null
            };
            
            // Cache the profile
            profileCache.set(xuid, { data: profile, timestamp: Date.now() });
            
            // Also cache the gamertag
            if (profile.gamertag) {
                gamertagCache.set(xuid, profile.gamertag);
            }
            
            return profile;
        } catch (error) {
            console.error(`[XboxAPI] Error fetching profile for ${xuid}:`, error?.message || error);
            return null;
        }
    });
}

/**
 * Get gamerscore for a player
 * @param {string} discordUserId - Discord user ID (for auth)
 * @param {string} xuid - Xbox User ID
 * @returns {Promise<string>} Gamerscore or 'N/A'
 */
export async function getGamerscore(discordUserId, xuid) {
    const profile = await getXboxProfile(discordUserId, xuid);
    return profile?.gamerscore || 'N/A';
}

/**
 * Look up gamertags from XUIDs - uses cache since Xbox APIs require different auth scope
 * @param {string} discordUserId - Discord user ID (not used but kept for API compatibility)
 * @param {string[]} xuids - Array of Xbox User IDs
 * @returns {Promise<Map<string, string>>} Map of XUID -> Gamertag
 */
export async function getGamertagsFromXuids(discordUserId, xuids) {
    const result = new Map();
    
    for (const xuid of xuids) {
        if (gamertagCache.has(xuid)) {
            result.set(xuid, gamertagCache.get(xuid));
        }
    }
    
    return result;
}

/**
 * Add a gamertag mapping to the cache
 * @param {string} xuid - Xbox User ID
 * @param {string} gamertag - Player's gamertag
 */
export function cacheGamertag(xuid, gamertag) {
    gamertagCache.set(xuid, gamertag);
}

/**
 * Make an authenticated request to the Realms API
 * @param {string} discordUserId - Discord user ID
 * @param {string} endpoint - API endpoint (e.g., '/worlds')
 * @param {string} method - HTTP method
 * @param {object} body - Request body (optional)
 * @returns {Promise<object>} API response
 */
async function realmsRequest(discordUserId, endpoint, method = 'GET', body = null) {
    // Get fresh token
    const authData = await getXboxToken(discordUserId);
    
    console.log('[RealmsAPI] Making request to:', endpoint);
    console.log('[RealmsAPI] Auth header using userHash:', authData.userHash);
    
    const headers = {
        'Authorization': buildAuthHeader(authData.xblToken, authData.userHash),
        'Client-Version': '1.17.41',
        'User-Agent': 'MCPE/UWP',
        'Accept': '*/*',
        'Content-Type': 'application/json'
    };
    
    const options = {
        method,
        headers
    };
    
    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }
    
    // Retry logic for temporary failures (503, 429, etc.)
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await fetch(`${REALMS_API_BASE}${endpoint}`, options);
        
        console.log('[RealmsAPI] Response status:', response.status);
        
        // Handle retryable errors
        if (response.status === 503 || response.status === 429) {
            const errorText = await response.text();
            console.log(`[RealmsAPI] Retryable error (attempt ${attempt}/3):`, errorText);
            lastError = new Error(`Realms API error (${response.status}): ${errorText}`);
            
            if (attempt < 3) {
                // Wait before retrying (1s, then 2s)
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                continue;
            }
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[RealmsAPI] Error response:', errorText);
            throw new Error(`Realms API error (${response.status}): ${errorText}`);
        }
        
        // Some endpoints return empty responses
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    }
    
    // All retries failed
    throw lastError;
}

/**
 * Get list of realms the user has access to
 * @param {string} discordUserId - Discord user ID
 * @returns {Promise<object>} List of realms
 */
export async function getRealms(discordUserId) {
    return realmsRequest(discordUserId, '/worlds');
}

/**
 * Extract and store XUID from realm data
 * Finds a realm where the user is owner by checking if they can access owner-only operations
 * @param {string} discordUserId - Discord user ID
 * @returns {Promise<string|null>} The user's XUID if found
 */
export async function extractAndStoreXuid(discordUserId) {
    const realmsData = await getRealms(discordUserId);
    const realms = realmsData.servers || [];
    
    // Get current auth data
    const userAuth = getUserAuth(discordUserId);
    console.log(`[RealmsAPI] extractAndStoreXuid - userAuth exists: ${!!userAuth}, xuid: ${userAuth?.xuid}`);
    if (!userAuth) return null;
    
    // If we already have XUID, return it
    if (userAuth.xuid) {
        console.log(`[RealmsAPI] Already have XUID: ${userAuth.xuid}`);
        return userAuth.xuid;
    }
    
    // For each realm where member === false, try to find one we own
    // by checking if we can access backups (owner-only)
    for (const realm of realms.filter(r => r.member === false)) {
        try {
            // Try to access backups - only owner can do this
            await realmsRequest(discordUserId, `/worlds/${realm.id}/backups`);
            
            // If we got here, we own this realm - save the XUID
            const xuid = realm.ownerUUID;
            console.log(`[RealmsAPI] Found user's XUID from realm ${realm.name}: ${xuid}`);
            
            // Update stored auth with XUID
            const updatedAuth = {
                ...userAuth,
                xuid: xuid
            };
            console.log(`[RealmsAPI] Storing updated auth with XUID:`, updatedAuth.xuid);
            storeUserAuth(discordUserId, updatedAuth);
            
            // Verify it was stored
            const verifyAuth = getUserAuth(discordUserId);
            console.log(`[RealmsAPI] Verified stored XUID: ${verifyAuth?.xuid}`);
            
            return xuid;
        } catch (error) {
            // Not the owner of this realm, continue
            console.log(`[RealmsAPI] Not owner of ${realm.name}`);
        }
    }
    
    return null;
}

/**
 * Get only the realms that the user actually owns (with caching for faster autocomplete)
 * Uses the stored XUID to compare against ownerUUID
 * @param {string} discordUserId - Discord user ID
 * @param {boolean} bypassCache - Force fresh fetch
 * @returns {Promise<Array>} List of owned realms
 */
export async function getOwnedRealms(discordUserId, bypassCache = false) {
    // Check cache first
    const cached = realmsCache.get(discordUserId);
    if (!bypassCache && cached && Date.now() - cached.timestamp < REALMS_CACHE_TTL) {
        return cached.data;
    }
    
    const realmsData = await getRealms(discordUserId);
    const realms = realmsData.servers || [];
    
    // Get the user's stored XUID
    const userAuth = getUserAuth(discordUserId);
    const userXuid = userAuth?.xuid;
    
    console.log('[RealmsAPI] User XUID for filtering:', userXuid);
    
    // Filter to realms where the user is the owner (ownerUUID matches user's XUID)
    const ownedRealms = realms.filter(realm => {
        const isOwner = realm.ownerUUID === userXuid;
        console.log(`[RealmsAPI] Realm ${realm.name} (${realm.id}): ownerUUID=${realm.ownerUUID}, match=${isOwner}`);
        return isOwner;
    });
    
    // Cache the result
    realmsCache.set(discordUserId, { data: ownedRealms, timestamp: Date.now() });
    
    return ownedRealms;
}

/**
 * Get detailed info about a specific realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {boolean} includeGamertags - Whether to fetch gamertags for players
 * @returns {Promise<object>} Realm details
 */
export async function getRealmInfo(discordUserId, realmId, includeGamertags = false) {
    const result = await realmsRequest(discordUserId, `/worlds/${realmId}`);
    
    // If gamertags requested and there are players, fetch their names
    if (includeGamertags && result.players && result.players.length > 0) {
        const xuids = result.players.map(p => p.uuid).filter(Boolean);
        const gamertagMap = await getGamertagsFromXuids(discordUserId, xuids);
        
        // Enrich players with gamertags
        result.players = result.players.map(p => ({
            ...p,
            name: gamertagMap.get(p.uuid) || p.name || null,
            xuid: p.uuid  // Keep XUID accessible
        }));
        
        console.log('[RealmsAPI] Realm info players with gamertags:', JSON.stringify(result.players, null, 2));
    } else {
        console.log('[RealmsAPI] Realm info players:', JSON.stringify(result.players, null, 2));
    }
    
    return result;
}

/**
 * Get the address to connect to a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @returns {Promise<object>} Connection address
 */
export async function getRealmAddress(discordUserId, realmId) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/join`);
}

/**
 * Open a realm to allow players to join
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @returns {Promise<object>} Result
 */
export async function openRealm(discordUserId, realmId) {
    console.log(`[RealmsAPI] Opening realm ${realmId}`);
    return realmsRequest(discordUserId, `/worlds/${realmId}/open`, 'PUT');
}

/**
 * Close a realm to prevent players from joining
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @returns {Promise<object>} Result
 */
export async function closeRealm(discordUserId, realmId) {
    console.log(`[RealmsAPI] Closing realm ${realmId}`);
    return realmsRequest(discordUserId, `/worlds/${realmId}/close`, 'PUT');
}

/**
 * Get list of players invited to a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @returns {Promise<object>} Invited players
 */
export async function getRealmPlayers(discordUserId, realmId) {
    const realmInfo = await getRealmInfo(discordUserId, realmId);
    return realmInfo.players || [];
}

/**
 * Invite a player to a realm by XUID
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @returns {Promise<object>} Result
 */
export async function invitePlayer(discordUserId, realmId, xuid) {
    // Correct endpoint: PUT /invites/{realmId}/invite/update
    return realmsRequest(discordUserId, `/invites/${realmId}/invite/update`, 'PUT', {
        invites: {
            [xuid]: 'ADD'
        }
    });
}

/**
 * Invite a player to a realm by gamertag name
 * Uses the name-based invite endpoint
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} gamertag - Player's Xbox gamertag
 * @returns {Promise<object>} Result
 */
export async function invitePlayerByName(discordUserId, realmId, gamertag) {
    console.log(`[RealmsAPI] Inviting player ${gamertag} to realm ${realmId}`);
    return realmsRequest(discordUserId, `/invites/${realmId}/invite/update`, 'PUT', {
        invites: {},
        uninvites: [],
        names: [gamertag]
    });
}

/**
 * Remove/uninvite a player from a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @returns {Promise<object>} Result
 */
export async function removePlayer(discordUserId, realmId, xuid) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/invite/${xuid}`, 'DELETE');
}

/**
 * Get the blocklist (banned players) for a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @returns {Promise<object>} Blocked players
 */
export async function getBlocklist(discordUserId, realmId) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/blocklist`);
}

/**
 * Block a player on a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @returns {Promise<object>} Result
 */
export async function blockPlayer(discordUserId, realmId, xuid) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/blocklist/${xuid}`, 'POST');
}

/**
 * Unblock a player on a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @returns {Promise<object>} Result
 */
export async function unblockPlayer(discordUserId, realmId, xuid) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/blocklist/${xuid}`, 'DELETE');
}

/**
 * Get realm backups
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @returns {Promise<object>} List of backups
 */
export async function getBackups(discordUserId, realmId) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/backups`);
}

/**
 * Get a download link for a realm world
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {number} slotId - World slot (1-4)
 * @returns {Promise<object>} Download info with downloadLink and size
 */
export async function getWorldDownload(discordUserId, realmId, slotId = 1) {
    console.log(`[RealmsAPI] Getting world download for realm ${realmId}, slot ${slotId}`);
    return realmsRequest(discordUserId, `/worlds/${realmId}/slot/${slotId}/download`);
}

/**
 * Set a player's permission level on a realm
 * Permission levels: VISITOR, MEMBER, OPERATOR
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @param {string} permission - Permission level (VISITOR, MEMBER, OPERATOR)
 * @returns {Promise<object>} Result
 */
export async function setPlayerPermission(discordUserId, realmId, xuid, permission) {
    // Correct endpoint: PUT /world/{realmId}/userPermission
    return realmsRequest(discordUserId, `/world/${realmId}/userPermission`, 'PUT', {
        permission: permission.toUpperCase(),
        xuid: xuid
    });
}

/**
 * Look up a player's XUID from their gamertag using the realm's player list
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} gamertag - Player's Xbox gamertag
 * @returns {Promise<string|null>} Player's XUID or null if not found
 */
export async function getXuidFromGamertag(discordUserId, realmId, gamertag) {
    const realmInfo = await getRealmInfo(discordUserId, realmId);
    const players = realmInfo.players || [];
    
    // Search for player by gamertag (case-insensitive)
    const player = players.find(p => 
        p.name && p.name.toLowerCase() === gamertag.toLowerCase()
    );
    
    if (player && player.uuid) {
        return player.uuid; // uuid in realm API is the XUID
    }
    
    return null;
}

/**
 * Set a player's permission level on a realm using their XUID directly
 * Tries multiple API approaches to set the permission
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @param {string} permission - Permission level (OPERATOR, MEMBER, or VISITOR)
 * @returns {Promise<object>} Result
 */
export async function setPlayerPermissionByXuid(discordUserId, realmId, xuid, permission) {
    const perm = permission.toUpperCase();
    console.log(`[RealmsAPI] Setting permission ${perm} for XUID ${xuid}`);
    
    // Try the permission endpoint format: PUT /worlds/{realmId}/userPermission/{xuid}
    // with permission in the body
    try {
        console.log('[RealmsAPI] Trying /worlds/{realmId}/userPermission endpoint...');
        const result = await realmsRequest(discordUserId, `/worlds/${realmId}/userPermission`, 'PUT', {
            permission: perm,
            xuid: xuid
        });
        console.log('[RealmsAPI] userPermission response:', JSON.stringify(result, null, 2));
        return result;
    } catch (error1) {
        console.log('[RealmsAPI] First attempt failed:', error1.message);
        
        // Try alternate format: POST /worlds/{realmId}/permission/{permission}/{xuid}
        try {
            console.log('[RealmsAPI] Trying /worlds/{realmId}/permission/{perm}/{xuid} endpoint...');
            const result = await realmsRequest(discordUserId, `/worlds/${realmId}/permission/${perm}/${xuid}`, 'POST');
            console.log('[RealmsAPI] permission POST response:', JSON.stringify(result, null, 2));
            return result;
        } catch (error2) {
            console.log('[RealmsAPI] Second attempt failed:', error2.message);
            
            // Fallback to invite/update for OP/DEOP
            console.log('[RealmsAPI] Falling back to invite/update endpoint...');
            const action = perm === 'OPERATOR' ? 'OP' : 'DEOP';
            const result = await realmsRequest(discordUserId, `/invites/${realmId}/invite/update`, 'PUT', {
                invites: {
                    [xuid]: action
                }
            });
            console.log('[RealmsAPI] invite/update response:', JSON.stringify(result, null, 2));
            return result;
        }
    }
}

/**
 * Set a player's permission level on a realm using their gamertag
 * Permission levels: VISITOR, MEMBER, OPERATOR
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} gamertag - Player's Xbox gamertag
 * @param {string} permission - Permission level (VISITOR, MEMBER, OPERATOR)
 * @returns {Promise<object>} Result
 */
export async function setPlayerPermissionByGamertag(discordUserId, realmId, gamertag, permission) {
    // First, find the player's XUID from the realm's player list
    const xuid = await getXuidFromGamertag(discordUserId, realmId, gamertag);
    
    if (!xuid) {
        throw new Error(`Player "${gamertag}" not found on this realm. Make sure they have joined the realm at least once.`);
    }
    
    console.log(`[RealmsAPI] Found XUID ${xuid} for gamertag ${gamertag}`);
    
    return setPlayerPermissionByXuid(discordUserId, realmId, xuid, permission);
}

/**
 * OP a player on a realm using the invite update endpoint
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @returns {Promise<object>} Result
 */
export async function opPlayer(discordUserId, realmId, xuid) {
    // Correct endpoint: PUT /invites/{realmId}/invite/update with OP action
    return realmsRequest(discordUserId, `/invites/${realmId}/invite/update`, 'PUT', {
        invites: {
            [xuid]: 'OP'
        }
    });
}

/**
 * DEOP a player on a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} xuid - Player's Xbox User ID
 * @returns {Promise<object>} Result
 */
export async function deopPlayer(discordUserId, realmId, xuid) {
    return realmsRequest(discordUserId, `/invites/${realmId}/invite/update`, 'PUT', {
        invites: {
            [xuid]: 'DEOP'
        }
    });
}

/**
 * Update realm default settings (gamemode, difficulty, etc.)
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {object} settings - Settings to update
 * @returns {Promise<object>} Result
 */
export async function updateRealmSettings(discordUserId, realmId, settings) {
    return realmsRequest(discordUserId, `/worlds/${realmId}`, 'PUT', settings);
}

/**
 * Set the default player permission for a realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} realmId - Realm ID
 * @param {string} permission - Default permission (VISITOR, MEMBER, OPERATOR)
 * @returns {Promise<object>} Result
 */
export async function setDefaultPermission(discordUserId, realmId, permission) {
    return realmsRequest(discordUserId, `/worlds/${realmId}/defaultPermission`, 'PUT', {
        permission: permission
    });
}
