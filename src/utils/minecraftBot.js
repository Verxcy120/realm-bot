import bedrock from 'bedrock-protocol';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { opPlayer, blockPlayer, getXboxProfile } from './realmsApi.js';
import { readdirSync, readFileSync } from 'fs';
import { getGuildConfig } from './guildConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the bot's XUID from the bedrock token cache
 * The bot uses a separate Microsoft account, so we need its XUID, not the realm owner's
 * @param {string} authCacheDir - Path to auth cache for this user
 * @returns {string|null} Bot's XUID
 */
function getBotXuidFromCache(authCacheDir) {
    try {
        // Find all bed-cache.json files in the auth cache directory
        const files = readdirSync(authCacheDir);
        const bedCacheFiles = files.filter(f => f.endsWith('_bed-cache.json'));
        
        for (const file of bedCacheFiles) {
            const cachePath = join(authCacheDir, file);
            const cacheData = JSON.parse(readFileSync(cachePath, 'utf-8'));
            
            // Check if this cache has the mca.chain (Minecraft Bedrock token)
            if (cacheData.mca && cacheData.mca.chain && cacheData.mca.chain.length > 0) {
                // The XUID is in the second JWT's payload at extraData.XUID
                for (const jwt of cacheData.mca.chain) {
                    try {
                        const parts = jwt.split('.');
                        if (parts.length >= 2) {
                            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                            if (payload.extraData && payload.extraData.XUID) {
                                console.log(`[Bot] Found bot XUID in cache: ${payload.extraData.XUID} (${payload.extraData.displayName})`);
                                return payload.extraData.XUID;
                            }
                        }
                    } catch (e) {
                        // Skip invalid JWT
                    }
                }
            }
        }
        
        console.log('[Bot] Could not find bot XUID in cache files');
        return null;
    } catch (error) {
        console.log('[Bot] Error reading auth cache:', error.message);
        return null;
    }
}

// Device platform mapping
const DEVICE_MAP = {
    0: 'Unknown',
    1: 'Android',
    2: 'iOS',
    3: 'macOS',
    4: 'FireOS',
    5: 'GearVR',
    6: 'Hololens',
    7: 'Windows',
    8: 'Windows',
    9: 'Dedicated',
    10: 'tvOS',
    11: 'PlayStation',
    12: 'Nintendo',
    13: 'Xbox',
    14: 'Windows Phone'
};

function getDeviceName(buildPlatform) {
    return DEVICE_MAP[buildPlatform] || 'Unknown';
}

// Store active bot connections
const activeBots = new Map();

// Store reconnection timers
const reconnectTimers = new Map();

// Event emitter for bot events
export const botEvents = new EventEmitter();
botEvents.setMaxListeners(20); // Increase max listeners to prevent warnings

// ═══════════════════════════════════════════════════════════════
// AUTOMOD CONFIGURATION (External crash detection)
// ═══════════════════════════════════════════════════════════════
export const automodConfig = {
    type: 'External',
    message: 'External Type 2',
    enabled: true,
    banOnCrash: true  // Ban last player who joined when realm crashes
};

// ═══════════════════════════════════════════════════════════════
// AUTOMOD FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * ADVANCED SKIN DETECTION SYSTEM
 * Checks for: invisible skins, tiny skins, 4D skins, geometry exploits, 
 * toolbox skins, negative space skins, armor stand skins, and more
 */

// Known bad geometry identifiers
const BANNED_GEOMETRY = [
    'geometry.humanoid.customslim',  // Often used for tiny skins
    'geometry.cape',
    'geometry.humanoid.custom',
    'geometry.persona_',
    'tiny', 'small', 'invis', 'invisible', 'exploit',
    '4d', 'fourD', 'four_d', '4_d',
    'toolbox', 'horion', 'zephyr', 'packet',
    'hitbox', 'hit_box', 'crasher', 'crash',
    'negative', 'void', 'null', 'empty',
    'armor_stand', 'armorstand',
    'mini', 'micro', 'nano', 'pixel',
    'flat', 'paper', '2d', 'plane'
];

// Standard skin dimensions
const VALID_SKIN_SIZES = [
    { w: 64, h: 32 },   // Classic skin
    { w: 64, h: 64 },   // Modern skin
    { w: 128, h: 128 }, // HD skin
    { w: 256, h: 256 }, // Ultra HD
    { w: 512, h: 512 }, // Super HD (rare but valid)
];

/**
 * Check skin data for unfair/exploit skins
 * @param {object} skinData - Skin data from player_list packet
 * @returns {object} { flagged: boolean, reason: string, severity: string }
 */
function checkSkinData(skinData) {
    if (!skinData) {
        return { flagged: false, reason: null, severity: null };
    }
    
    const flags = [];
    
    try {
        // ═══════════════════════════════════════════════════════════════
        // 1. DIMENSION CHECKS
        // ═══════════════════════════════════════════════════════════════
        const skinWidth = skinData.skin_image_width || 0;
        const skinHeight = skinData.skin_image_height || 0;
        
        // Check for zero/negative dimensions
        if (skinWidth <= 0 || skinHeight <= 0) {
            flags.push({ reason: `Invalid dimensions (${skinWidth}x${skinHeight})`, severity: 'CRITICAL' });
        }
        
        // Check for tiny skins (anything less than 16x16 is suspicious)
        if (skinWidth > 0 && skinHeight > 0 && (skinWidth < 16 || skinHeight < 16)) {
            flags.push({ reason: `Tiny skin (${skinWidth}x${skinHeight})`, severity: 'CRITICAL' });
        }
        
        // Check for non-standard dimensions
        const isValidSize = VALID_SKIN_SIZES.some(s => s.w === skinWidth && s.h === skinHeight);
        if (skinWidth > 0 && skinHeight > 0 && !isValidSize) {
            // Allow some tolerance for custom skins but flag very weird sizes
            if (skinWidth < 32 || skinHeight < 32 || skinWidth > 1024 || skinHeight > 1024) {
                flags.push({ reason: `Non-standard dimensions (${skinWidth}x${skinHeight})`, severity: 'HIGH' });
            }
        }
        
        // Check for asymmetric skins (potential exploit)
        if (skinWidth > 0 && skinHeight > 0) {
            const ratio = Math.max(skinWidth, skinHeight) / Math.min(skinWidth, skinHeight);
            if (ratio > 4) {
                flags.push({ reason: `Extreme aspect ratio (${ratio.toFixed(1)}:1)`, severity: 'HIGH' });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════
        // 2. SKIN DATA ANALYSIS
        // ═══════════════════════════════════════════════════════════════
        const skinDataBuffer = skinData.skin_data;
        
        if (skinDataBuffer) {
            const dataLength = skinDataBuffer.length || 0;
            const expectedLength = skinWidth * skinHeight * 4; // RGBA
            
            // Check for empty/missing skin data
            if (dataLength === 0) {
                flags.push({ reason: 'Empty skin data', severity: 'CRITICAL' });
            }
            
            // Check for data size mismatch (potential exploit)
            if (dataLength > 0 && expectedLength > 0 && Math.abs(dataLength - expectedLength) > 100) {
                flags.push({ reason: `Skin data size mismatch (got ${dataLength}, expected ${expectedLength})`, severity: 'HIGH' });
            }
            
            // Analyze pixel data
            if (dataLength >= 4) {
                const data = Buffer.isBuffer(skinDataBuffer) ? skinDataBuffer : Buffer.from(skinDataBuffer);
                
                let transparentPixels = 0;
                let blackPixels = 0;
                let whitePixels = 0;
                let totalPixels = 0;
                let singleColorCount = new Map();
                
                // Sample pixels (every 4th pixel for performance on large skins)
                const step = dataLength > 10000 ? 16 : 4;
                
                for (let i = 0; i < data.length - 3; i += step) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];
                    
                    totalPixels++;
                    
                    // Count transparent pixels
                    if (a === 0 || a < 10) transparentPixels++;
                    
                    // Count black pixels (potential invisible skin)
                    if (r < 5 && g < 5 && b < 5) blackPixels++;
                    
                    // Count white pixels
                    if (r > 250 && g > 250 && b > 250) whitePixels++;
                    
                    // Track color frequency
                    const colorKey = `${r},${g},${b},${a}`;
                    singleColorCount.set(colorKey, (singleColorCount.get(colorKey) || 0) + 1);
                }
                
                if (totalPixels > 0) {
                    const transparentRatio = transparentPixels / totalPixels;
                    const blackRatio = blackPixels / totalPixels;
                    const whiteRatio = whitePixels / totalPixels;
                    
                    // Check for invisible skin (>90% transparent)
                    if (transparentRatio > 0.90) {
                        flags.push({ reason: `Invisible skin (${Math.round(transparentRatio * 100)}% transparent)`, severity: 'CRITICAL' });
                    } else if (transparentRatio > 0.75) {
                        flags.push({ reason: `Mostly transparent skin (${Math.round(transparentRatio * 100)}% transparent)`, severity: 'HIGH' });
                    }
                    
                    // Check for all-black skin (can be invisible in dark areas)
                    if (blackRatio > 0.95) {
                        flags.push({ reason: `All-black skin (${Math.round(blackRatio * 100)}% black)`, severity: 'HIGH' });
                    }
                    
                    // Check for single-color skins (lazy exploit skins)
                    const maxColorFreq = Math.max(...singleColorCount.values());
                    const singleColorRatio = maxColorFreq / totalPixels;
                    if (singleColorRatio > 0.98 && totalPixels > 100) {
                        flags.push({ reason: `Single-color skin (${Math.round(singleColorRatio * 100)}% same color)`, severity: 'MEDIUM' });
                    }
                }
            }
        } else {
            // No skin data at all
            flags.push({ reason: 'Missing skin data', severity: 'CRITICAL' });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // 3. GEOMETRY CHECKS
        // ═══════════════════════════════════════════════════════════════
        const geometryData = skinData.geometry_data || '';
        const geometryName = skinData.geometry_data_engine_version || '';
        const resourcePatch = JSON.stringify(skinData.skin_resource_patch || {}).toLowerCase();
        
        // Check geometry data for banned patterns
        const geometryLower = (geometryData + geometryName + resourcePatch).toLowerCase();
        
        for (const banned of BANNED_GEOMETRY) {
            if (geometryLower.includes(banned.toLowerCase())) {
                flags.push({ reason: `Banned geometry pattern: "${banned}"`, severity: 'CRITICAL' });
                break;
            }
        }
        
        // Check for custom geometry with suspicious bone counts
        if (geometryData && geometryData.length > 100) {
            try {
                const geoJson = typeof geometryData === 'string' ? JSON.parse(geometryData) : geometryData;
                
                // Check for geometry definitions
                const geoKeys = Object.keys(geoJson).filter(k => k.startsWith('geometry.'));
                
                for (const key of geoKeys) {
                    const geo = geoJson[key];
                    if (geo && geo.bones) {
                        const boneCount = Array.isArray(geo.bones) ? geo.bones.length : 0;
                        
                        // Normal skins have ~20-30 bones, 4D skins have many more
                        if (boneCount > 100) {
                            flags.push({ reason: `Excessive bone count (${boneCount} bones) - possible 4D skin`, severity: 'CRITICAL' });
                        }
                        
                        // Check for tiny bone cubes (used for small hitbox)
                        let tinyBones = 0;
                        let negativeBones = 0;
                        
                        for (const bone of geo.bones || []) {
                            if (bone.cubes) {
                                for (const cube of bone.cubes) {
                                    const size = cube.size || [0, 0, 0];
                                    const origin = cube.origin || [0, 0, 0];
                                    
                                    // Check for tiny cubes
                                    if (size[0] < 0.5 && size[1] < 0.5 && size[2] < 0.5) {
                                        tinyBones++;
                                    }
                                    
                                    // Check for negative origin (exploit)
                                    if (origin[0] < -100 || origin[1] < -100 || origin[2] < -100) {
                                        negativeBones++;
                                    }
                                    
                                    // Check for extreme positions (used to hide skin)
                                    if (Math.abs(origin[0]) > 1000 || Math.abs(origin[1]) > 1000 || Math.abs(origin[2]) > 1000) {
                                        flags.push({ reason: 'Geometry with extreme positions', severity: 'CRITICAL' });
                                    }
                                }
                            }
                            
                            // Check bone scale (tiny scale = tiny hitbox)
                            if (bone.scale) {
                                const scale = Array.isArray(bone.scale) ? bone.scale : [bone.scale, bone.scale, bone.scale];
                                if (scale[0] < 0.1 || scale[1] < 0.1 || scale[2] < 0.1) {
                                    flags.push({ reason: `Tiny bone scale detected (${scale.join(', ')})`, severity: 'HIGH' });
                                }
                            }
                        }
                        
                        if (tinyBones > 10) {
                            flags.push({ reason: `Many tiny bone cubes (${tinyBones})`, severity: 'HIGH' });
                        }
                        
                        if (negativeBones > 0) {
                            flags.push({ reason: `Negative bone origins (${negativeBones})`, severity: 'CRITICAL' });
                        }
                    }
                }
            } catch (e) {
                // Invalid JSON geometry - suspicious
                if (geometryData.length > 50) {
                    flags.push({ reason: 'Malformed geometry data', severity: 'MEDIUM' });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════
        // 4. CAPE & ANIMATION CHECKS
        // ═══════════════════════════════════════════════════════════════
        const capeData = skinData.cape_data;
        const capeWidth = skinData.cape_image_width || 0;
        const capeHeight = skinData.cape_image_height || 0;
        
        if (capeData && capeData.length > 0) {
            // Check for exploit capes
            if (capeWidth < 8 || capeHeight < 8) {
                flags.push({ reason: `Tiny cape (${capeWidth}x${capeHeight})`, severity: 'MEDIUM' });
            }
        }
        
        // Check animation data
        const animationData = skinData.animation_data || skinData.animations;
        if (animationData && typeof animationData === 'string' && animationData.length > 0) {
            const animLower = animationData.toLowerCase();
            if (animLower.includes('crash') || animLower.includes('exploit') || animLower.includes('lag')) {
                flags.push({ reason: 'Suspicious animation data', severity: 'HIGH' });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════
        // 5. PERSONA CHECKS
        // ═══════════════════════════════════════════════════════════════
        const isPersona = skinData.is_persona_skin || skinData.persona;
        const personaPieces = skinData.persona_pieces || [];
        
        if (isPersona && personaPieces.length > 50) {
            flags.push({ reason: `Excessive persona pieces (${personaPieces.length})`, severity: 'MEDIUM' });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // 6. ARM SIZE CHECKS (for small arm exploits)
        // ═══════════════════════════════════════════════════════════════
        const armSize = skinData.arm_size || 'wide';
        // This is normal, but combined with other flags could be suspicious
        
        // ═══════════════════════════════════════════════════════════════
        // FINAL VERDICT
        // ═══════════════════════════════════════════════════════════════
        if (flags.length > 0) {
            // Sort by severity
            const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2 };
            flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
            
            const criticalFlags = flags.filter(f => f.severity === 'CRITICAL');
            const highFlags = flags.filter(f => f.severity === 'HIGH');
            
            // Auto-ban on critical flags or multiple high flags
            if (criticalFlags.length > 0 || highFlags.length >= 2) {
                return {
                    flagged: true,
                    reason: flags.map(f => `[${f.severity}] ${f.reason}`).join(' | '),
                    severity: criticalFlags.length > 0 ? 'CRITICAL' : 'HIGH',
                    allFlags: flags
                };
            }
            
            // Log but don't ban for single medium/high flags
            console.log(`[Automod] Skin warnings for review: ${flags.map(f => f.reason).join(', ')}`);
        }
        
        return { flagged: false, reason: null, severity: null };
        
    } catch (error) {
        console.log(`[Automod] Error checking skin: ${error.message}`);
        return { flagged: false, reason: null, severity: null };
    }
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED DEVICE SPOOFING DETECTION SYSTEM
// ═══════════════════════════════════════════════════════════════

/**
 * Valid device platform IDs (from build_platform)
 * Anything outside this range is instantly sus
 */
const VALID_DEVICE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * Device-specific characteristics for validation
 * Each device has expected properties that should match
 */
const DEVICE_CHARACTERISTICS = {
    // Mobile devices
    1: { name: 'Android', expectedInputModes: [1, 2], maxGuiScale: 3, canHaveController: true },
    2: { name: 'iOS', expectedInputModes: [1, 2], maxGuiScale: 2, canHaveController: true },
    4: { name: 'FireOS', expectedInputModes: [1, 2], maxGuiScale: 2, canHaveController: false },
    14: { name: 'Windows Phone', expectedInputModes: [1], maxGuiScale: 2, canHaveController: false },
    
    // Console devices - should have controller input
    11: { name: 'PlayStation', expectedInputModes: [2], maxGuiScale: 4, requiresController: true },
    12: { name: 'Nintendo', expectedInputModes: [2], maxGuiScale: 3, requiresController: true },
    13: { name: 'Xbox', expectedInputModes: [2], maxGuiScale: 4, requiresController: true },
    
    // Desktop - keyboard/mouse or controller
    3: { name: 'macOS', expectedInputModes: [1, 2], maxGuiScale: 4, canHaveController: true },
    7: { name: 'Windows 10', expectedInputModes: [1, 2], maxGuiScale: 4, canHaveController: true },
    8: { name: 'Windows 10', expectedInputModes: [1, 2], maxGuiScale: 4, canHaveController: true },
    
    // VR devices
    5: { name: 'GearVR', expectedInputModes: [3], maxGuiScale: 2, isVR: true },
    6: { name: 'Hololens', expectedInputModes: [3], maxGuiScale: 2, isVR: true },
    
    // Other
    0: { name: 'Unknown', expectedInputModes: [1, 2], maxGuiScale: 4, suspicious: true },
    9: { name: 'Dedicated', expectedInputModes: [1], maxGuiScale: 1, isServer: true },
    10: { name: 'tvOS', expectedInputModes: [2], maxGuiScale: 4, requiresController: true }
};

/**
 * Known toolbox/client device model patterns
 * These are commonly used by hacked clients to identify themselves
 */
const SUSPICIOUS_DEVICE_MODELS = [
    'toolbox', 'horion', 'zephyr', 'packet', 'prax', 'onix',
    'flarial', 'latite', 'lunar', 'badlion', 'pvplounge',
    'client', 'hack', 'cheat', 'exploit', 'crash', 'external',
    'injector', 'dll', 'mod', 'modified', 'custom', 'bypass',
    'spoof', 'fake', 'emulator', 'emulated', 'virtual',
    'null', 'undefined', 'unknown', 'test', 'debug',
    // Common Chinese hack clients
    'wurst', 'aristois', 'impact', 'meteor', 'sigma', 'vape'
];

/**
 * Suspicious language/locale patterns
 * These might indicate spoofed or modified clients
 */
const SUSPICIOUS_LANGUAGES = [
    'xx_XX', 'en_ZZ', 'test', 'debug', 'null', 'undefined',
    '', 'hacker', 'exploit'
];

/**
 * INPUT MODES:
 * 0 = Unknown
 * 1 = Mouse/Keyboard
 * 2 = Touch
 * 3 = Controller/Gamepad
 */
const INPUT_MODE_NAMES = {
    0: 'Unknown',
    1: 'Keyboard/Mouse',
    2: 'Touch',
    3: 'Controller'
};

/**
 * Advanced device spoofing detection
 * Checks for impossible device configurations, spoofed platforms, and suspicious patterns
 * @param {object} playerData - Full player data from packet
 * @returns {object} { flagged: boolean, reason: string, severity: string, allFlags: array }
 */
function checkDeviceData(playerData) {
    if (!playerData) {
        return { flagged: false, reason: null, severity: null };
    }
    
    const flags = [];
    const buildPlatform = playerData.build_platform ?? playerData.buildPlatform;
    const deviceModel = playerData.device_model ?? playerData.deviceModel ?? '';
    const deviceId = playerData.device_id ?? playerData.deviceId ?? '';
    const inputMode = playerData.current_input_mode ?? playerData.currentInputMode ?? playerData.input_mode ?? 1;
    const defaultInputMode = playerData.default_input_mode ?? playerData.defaultInputMode ?? inputMode;
    const uiProfile = playerData.ui_profile ?? playerData.uiProfile ?? 0;
    const guiScale = playerData.gui_scale ?? playerData.guiScale ?? -1;
    const languageCode = playerData.language_code ?? playerData.languageCode ?? '';
    const platformOnlineId = playerData.platform_online_id ?? playerData.platformOnlineId ?? '';
    const platformOfflineId = playerData.platform_offline_id ?? playerData.platformOfflineId ?? '';
    const selfSignedId = playerData.self_signed_id ?? playerData.selfSignedId ?? '';
    const serverAddress = playerData.server_address ?? playerData.serverAddress ?? '';
    const thirdPartyName = playerData.third_party_name ?? playerData.thirdPartyName ?? '';
    const isEditorMode = playerData.is_editor_mode ?? playerData.isEditorMode ?? false;
    const trustedSkin = playerData.trusted_skin ?? playerData.trustedSkin ?? true;
    const platformChatId = playerData.platform_chat_id ?? playerData.platformChatId ?? '';
    
    const deviceCharacteristics = DEVICE_CHARACTERISTICS[buildPlatform];
    const deviceName = DEVICE_MAP[buildPlatform] || 'Unknown';
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 1: Invalid Build Platform
    // ═══════════════════════════════════════════════════════════════
    if (buildPlatform !== undefined && buildPlatform !== null) {
        if (!VALID_DEVICE_IDS.includes(buildPlatform)) {
            flags.push({
                check: 'Invalid Platform ID',
                reason: `Invalid build_platform: ${buildPlatform} (valid: 0-14)`,
                severity: 'CRITICAL',
                details: { buildPlatform }
            });
        }
        
        // Unknown device (0) is suspicious
        if (buildPlatform === 0) {
            flags.push({
                check: 'Unknown Platform',
                reason: 'Device reports as Unknown (platform 0)',
                severity: 'MEDIUM',
                details: { buildPlatform }
            });
        }
        
        // Dedicated server (9) shouldn't be a player
        if (buildPlatform === 9) {
            flags.push({
                check: 'Server Spoof',
                reason: 'Player claims to be a Dedicated Server (platform 9)',
                severity: 'CRITICAL',
                details: { buildPlatform }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 2: Input Mode Mismatch
    // ═══════════════════════════════════════════════════════════════
    if (deviceCharacteristics && inputMode !== undefined) {
        const inputModeName = INPUT_MODE_NAMES[inputMode] || 'Unknown';
        
        // Console requires controller
        if (deviceCharacteristics.requiresController && inputMode !== 3) {
            flags.push({
                check: 'Console Input Mismatch',
                reason: `${deviceName} should use Controller, but using ${inputModeName}`,
                severity: 'HIGH',
                details: { device: deviceName, inputMode, expected: 'Controller' }
            });
        }
        
        // VR devices have specific input
        if (deviceCharacteristics.isVR && inputMode !== 3) {
            flags.push({
                check: 'VR Input Mismatch',
                reason: `${deviceName} VR should use motion controls, but using ${inputModeName}`,
                severity: 'MEDIUM',
                details: { device: deviceName, inputMode }
            });
        }
        
        // Check if input mode is in expected range
        if (deviceCharacteristics.expectedInputModes && 
            !deviceCharacteristics.expectedInputModes.includes(inputMode) && 
            inputMode !== 0) {
            flags.push({
                check: 'Unexpected Input Mode',
                reason: `${deviceName} unexpectedly using ${inputModeName}`,
                severity: 'LOW',
                details: { device: deviceName, inputMode, expected: deviceCharacteristics.expectedInputModes }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 3: Device Model Validation
    // ═══════════════════════════════════════════════════════════════
    if (deviceModel) {
        const modelLower = deviceModel.toLowerCase();
        
        // Check for known hack client identifiers
        for (const suspicious of SUSPICIOUS_DEVICE_MODELS) {
            if (modelLower.includes(suspicious)) {
                flags.push({
                    check: 'Suspicious Device Model',
                    reason: `Device model contains suspicious string: "${suspicious}"`,
                    severity: 'CRITICAL',
                    details: { deviceModel, matched: suspicious }
                });
                break;
            }
        }
        
        // Empty or weird device model
        if (deviceModel.length < 2) {
            flags.push({
                check: 'Invalid Device Model',
                reason: `Device model too short: "${deviceModel}"`,
                severity: 'MEDIUM',
                details: { deviceModel }
            });
        }
        
        // Extremely long device model (potential buffer overflow attempt)
        if (deviceModel.length > 256) {
            flags.push({
                check: 'Oversized Device Model',
                reason: `Device model suspiciously long: ${deviceModel.length} chars`,
                severity: 'HIGH',
                details: { length: deviceModel.length }
            });
        }
        
        // Device model contains non-ASCII characters (potential exploit)
        if (!/^[\x20-\x7E]*$/.test(deviceModel)) {
            flags.push({
                check: 'Invalid Device Model Chars',
                reason: 'Device model contains non-printable/invalid characters',
                severity: 'HIGH',
                details: { deviceModel }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 4: Device ID Validation
    // ═══════════════════════════════════════════════════════════════
    if (deviceId) {
        // Device ID should be a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const simpleIdRegex = /^[0-9a-f\-]+$/i;
        
        if (!uuidRegex.test(deviceId) && !simpleIdRegex.test(deviceId)) {
            // Check for obviously fake device IDs
            const idLower = deviceId.toLowerCase();
            if (idLower.includes('fake') || idLower.includes('spoof') || 
                idLower.includes('null') || idLower === '00000000-0000-0000-0000-000000000000') {
                flags.push({
                    check: 'Fake Device ID',
                    reason: `Device ID appears fake or spoofed`,
                    severity: 'HIGH',
                    details: { deviceId }
                });
            }
        }
        
        // All zeros UUID is suspicious
        if (deviceId === '00000000-0000-0000-0000-000000000000') {
            flags.push({
                check: 'Null Device ID',
                reason: 'Device ID is all zeros (null UUID)',
                severity: 'HIGH',
                details: { deviceId }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 5: Language/Locale Validation
    // ═══════════════════════════════════════════════════════════════
    if (languageCode) {
        const langLower = languageCode.toLowerCase();
        
        // Check for suspicious language codes
        for (const suspicious of SUSPICIOUS_LANGUAGES) {
            if (langLower === suspicious || langLower.includes(suspicious)) {
                flags.push({
                    check: 'Suspicious Language Code',
                    reason: `Language code suspicious: "${languageCode}"`,
                    severity: 'MEDIUM',
                    details: { languageCode }
                });
                break;
            }
        }
        
        // Valid language codes are like "en_US", "es_MX", "zh_CN"
        const validLangRegex = /^[a-z]{2}[_-][A-Z]{2}$/;
        if (!validLangRegex.test(languageCode) && languageCode.length > 0) {
            flags.push({
                check: 'Invalid Language Format',
                reason: `Language code format invalid: "${languageCode}"`,
                severity: 'LOW',
                details: { languageCode }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 6: Platform ID Cross-Validation
    // ═══════════════════════════════════════════════════════════════
    
    // Console platforms should have platform online ID
    if ([11, 12, 13].includes(buildPlatform)) {
        if (!platformOnlineId || platformOnlineId.length < 1) {
            flags.push({
                check: 'Missing Console ID',
                reason: `${deviceName} missing platform online ID`,
                severity: 'MEDIUM',
                details: { buildPlatform, platformOnlineId }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 7: GUI Scale Validation
    // ═══════════════════════════════════════════════════════════════
    if (guiScale !== -1 && guiScale !== undefined && deviceCharacteristics) {
        // GUI scale should be reasonable (usually -1 to 4)
        if (guiScale < -1 || guiScale > 10) {
            flags.push({
                check: 'Invalid GUI Scale',
                reason: `GUI scale out of range: ${guiScale}`,
                severity: 'MEDIUM',
                details: { guiScale }
            });
        }
        
        // Check against device-specific max
        if (deviceCharacteristics.maxGuiScale && guiScale > deviceCharacteristics.maxGuiScale) {
            flags.push({
                check: 'GUI Scale Mismatch',
                reason: `${deviceName} has GUI scale ${guiScale} (max expected: ${deviceCharacteristics.maxGuiScale})`,
                severity: 'LOW',
                details: { guiScale, maxExpected: deviceCharacteristics.maxGuiScale }
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 8: Editor Mode Check
    // ═══════════════════════════════════════════════════════════════
    if (isEditorMode === true) {
        flags.push({
            check: 'Editor Mode Active',
            reason: 'Player is using Editor Mode (potential exploit)',
            severity: 'HIGH',
            details: { isEditorMode }
        });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 9: Untrusted Skin Flag
    // ═══════════════════════════════════════════════════════════════
    if (trustedSkin === false) {
        flags.push({
            check: 'Untrusted Skin',
            reason: 'Player skin marked as untrusted by client',
            severity: 'HIGH',
            details: { trustedSkin }
        });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 10: Third Party Name Validation
    // ═══════════════════════════════════════════════════════════════
    if (thirdPartyName && thirdPartyName.length > 0) {
        const nameLower = thirdPartyName.toLowerCase();
        
        // Check for hack client names
        for (const suspicious of SUSPICIOUS_DEVICE_MODELS) {
            if (nameLower.includes(suspicious)) {
                flags.push({
                    check: 'Suspicious Third Party',
                    reason: `Third party name contains: "${suspicious}"`,
                    severity: 'CRITICAL',
                    details: { thirdPartyName, matched: suspicious }
                });
                break;
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK 11: Platform Consistency
    // ═══════════════════════════════════════════════════════════════
    
    // Mobile device (1, 2, 4) should have touch as default input
    if ([1, 2, 4].includes(buildPlatform) && defaultInputMode === 1) {
        // Mobile with keyboard as DEFAULT is suspicious (could be emulator)
        flags.push({
            check: 'Mobile Keyboard Default',
            reason: `${deviceName} has keyboard as default input (possible emulator)`,
            severity: 'MEDIUM',
            details: { buildPlatform, defaultInputMode }
        });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // FINAL VERDICT
    // ═══════════════════════════════════════════════════════════════
    
    if (flags.length > 0) {
        // Sort by severity
        const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
        flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
        
        const criticalFlags = flags.filter(f => f.severity === 'CRITICAL');
        const highFlags = flags.filter(f => f.severity === 'HIGH');
        
        // Auto-ban on CRITICAL or multiple HIGH flags
        const shouldAutoBan = criticalFlags.length > 0 || highFlags.length >= 2;
        
        console.log(`[Device Check] ═══════════════════════════════════════════════════`);
        console.log(`[Device Check] Platform: ${deviceName} (${buildPlatform})`);
        console.log(`[Device Check] Model: ${deviceModel || 'N/A'}`);
        console.log(`[Device Check] Input: ${INPUT_MODE_NAMES[inputMode] || inputMode}`);
        console.log(`[Device Check] Flags: ${flags.length} (${criticalFlags.length} critical, ${highFlags.length} high)`);
        flags.forEach(f => {
            console.log(`[Device Check]   [${f.severity}] ${f.check}: ${f.reason}`);
        });
        console.log(`[Device Check] Verdict: ${shouldAutoBan ? '🚫 AUTO-BAN' : '⚠️ FLAGGED'}`);
        console.log(`[Device Check] ═══════════════════════════════════════════════════`);
        
        return {
            flagged: true,
            reason: flags.map(f => `[${f.severity}] ${f.reason}`).join(' | '),
            severity: criticalFlags.length > 0 ? 'CRITICAL' : (highFlags.length > 0 ? 'HIGH' : 'MEDIUM'),
            allFlags: flags,
            shouldAutoBan
        };
    }
    
    return { flagged: false, reason: null, severity: null, shouldAutoBan: false };
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT AGE CHECK (Detection #10)
// ═══════════════════════════════════════════════════════════════

/**
 * Check if an Xbox account is too new (potential alt)
 * Uses the account's tenure level and join date indicators
 * @param {object} profile - Xbox profile data
 * @param {number} minDaysOld - Minimum account age in days
 * @returns {object} { flagged: boolean, reason: string, accountAge: number }
 */
function checkAccountAge(profile, minDaysOld = 30) {
    if (!profile) {
        return { flagged: false, reason: null, accountAge: null };
    }
    
    try {
        // Xbox profiles have tenure level (years on Xbox Live)
        // Tenure 0 = new account, 1 = 1+ years, etc.
        const tenureLevel = parseInt(profile.tenureLevel) || 0;
        
        // Also check gamerscore as indicator - new accounts typically have low score
        const gamerscore = parseInt(profile.gamerscore) || 0;
        
        // Account creation date if available
        const accountTier = profile.accountTier || 'unknown';
        const xboxOneRep = profile.xboxOneRep || 'unknown';
        
        // Estimate account age based on tenure
        const estimatedDays = tenureLevel * 365;
        
        // Flag if tenure is 0 (less than 1 year) and we require older
        if (minDaysOld > 365 && tenureLevel === 0) {
            return {
                flagged: true,
                reason: `Account too new (tenure: ${tenureLevel}, <1 year old)`,
                accountAge: estimatedDays,
                severity: 'MEDIUM'
            };
        }
        
        // Additional heuristic: new accounts with very low gamerscore
        if (tenureLevel === 0 && gamerscore < 100 && minDaysOld > 0) {
            return {
                flagged: true,
                reason: `New account suspected (tenure: 0, gamerscore: ${gamerscore})`,
                accountAge: estimatedDays,
                severity: 'LOW'
            };
        }
        
        return { flagged: false, reason: null, accountAge: estimatedDays };
        
    } catch (error) {
        console.log(`[Account Age] Error checking account: ${error.message}`);
        return { flagged: false, reason: null, accountAge: null };
    }
}

// ═══════════════════════════════════════════════════════════════
// UNICODE EXPLOIT DETECTION (Detection #15)
// ═══════════════════════════════════════════════════════════════

/**
 * Dangerous unicode sequences that can crash clients or cause issues
 */
const DANGEROUS_UNICODE = [
    // Zalgo text generators (combining diacritics)
    /[\u0300-\u036f]{10,}/,  // 10+ combining marks
    /[\u0489]{3,}/,          // Multiple Cyrillic millions signs
    
    // Right-to-left override exploits
    /\u202e/,                // Right-to-left override
    /\u202d/,                // Left-to-right override
    /\u200f/,                // Right-to-left mark
    /\u200e/,                // Left-to-right mark
    /\u2066/,                // Left-to-right isolate
    /\u2067/,                // Right-to-left isolate
    /\u2068/,                // First strong isolate
    /\u2069/,                // Pop directional isolate
    
    // Null bytes and control characters
    /\u0000/,                // Null byte
    /[\u0001-\u0008]/,       // Control characters
    /[\u000b-\u000c]/,       // Vertical tab, form feed
    /[\u000e-\u001f]/,       // More control chars
    /\u007f/,                // Delete
    
    // Object replacement and special chars
    /\ufffc/,                // Object replacement character
    /\ufffd{5,}/,            // Multiple replacement characters
    /\ufffe/,                // Noncharacter
    /\uffff/,                // Noncharacter
    
    // Zero-width characters (used for invisible text exploits)
    /[\u200b-\u200d]{5,}/,   // Multiple zero-width chars
    /\u2060{3,}/,            // Word joiner spam
    /\ufeff{2,}/,            // Multiple BOM
    
    // Private use area (can cause rendering issues)
    /[\ue000-\uf8ff]{10,}/,  // Private use spam
    
    // Emoji modifier spam
    /[\u{1f3fb}-\u{1f3ff}]{5,}/u,  // Skin tone modifier spam
    
    // Line/paragraph separators (can break chat)
    /\u2028/,                // Line separator
    /\u2029/,                // Paragraph separator
    
    // Mathematical alphanumeric symbols that look like normal text
    /[\u{1d400}-\u{1d7ff}]{20,}/u,  // Too many math symbols
    
    // Specials block
    /[\ufff0-\ufff8]/,       // Specials
    
    // Tags block (deprecated, can cause issues)
    /[\u{e0000}-\u{e007f}]/u
];

/**
 * Check message for dangerous unicode sequences
 * @param {string} message - Message to check
 * @returns {object} { flagged: boolean, reason: string, matches: array }
 */
function checkUnicodeExploit(message) {
    if (!message || typeof message !== 'string') {
        return { flagged: false, reason: null, matches: [] };
    }
    
    const matches = [];
    
    for (const pattern of DANGEROUS_UNICODE) {
        if (pattern.test(message)) {
            matches.push({
                pattern: pattern.toString(),
                severity: 'HIGH'
            });
        }
    }
    
    // Check for excessive combining characters (Zalgo text)
    const combiningCount = (message.match(/[\u0300-\u036f]/g) || []).length;
    if (combiningCount > 20) {
        matches.push({
            pattern: 'Zalgo text (excessive combining chars)',
            count: combiningCount,
            severity: 'HIGH'
        });
    }
    
    // Check for invisible character spam
    const invisibleCount = (message.match(/[\u200b-\u200d\u2060\ufeff]/g) || []).length;
    if (invisibleCount > 10) {
        matches.push({
            pattern: 'Invisible character spam',
            count: invisibleCount,
            severity: 'MEDIUM'
        });
    }
    
    // Check message length vs visible length (hidden text detection)
    const visibleLength = message.replace(/[\u200b-\u200d\u2060\ufeff\u0300-\u036f]/g, '').length;
    if (message.length > 10 && visibleLength < message.length * 0.3) {
        matches.push({
            pattern: 'Hidden text detected',
            visibleRatio: (visibleLength / message.length * 100).toFixed(1) + '%',
            severity: 'HIGH'
        });
    }
    
    if (matches.length > 0) {
        return {
            flagged: true,
            reason: matches.map(m => m.pattern).join(', '),
            matches,
            severity: matches.some(m => m.severity === 'HIGH') ? 'HIGH' : 'MEDIUM'
        };
    }
    
    return { flagged: false, reason: null, matches: [] };
}

// ═══════════════════════════════════════════════════════════════
// COMMAND SPAM DETECTION (Detection #16)
// ═══════════════════════════════════════════════════════════════

// Track command usage per player
const commandHistory = new Map();

/**
 * Check for command spam
 * @param {string} playerXuid - Player's XUID
 * @param {string} command - Command executed
 * @param {object} settings - { maxCommands: number, timeWindow: number (seconds) }
 * @returns {object} { flagged: boolean, reason: string, commandCount: number }
 */
function checkCommandSpam(playerXuid, command, settings = { maxCommands: 10, timeWindow: 5 }) {
    const now = Date.now();
    const windowMs = settings.timeWindow * 1000;
    
    // Get or create history for this player
    if (!commandHistory.has(playerXuid)) {
        commandHistory.set(playerXuid, []);
    }
    
    const history = commandHistory.get(playerXuid);
    
    // Add current command
    history.push({ command, timestamp: now });
    
    // Remove old entries outside the time window
    const recentCommands = history.filter(h => now - h.timestamp < windowMs);
    commandHistory.set(playerXuid, recentCommands);
    
    // Check if over limit
    if (recentCommands.length > settings.maxCommands) {
        // Check for exact duplicate commands (bot behavior)
        const commandCounts = {};
        recentCommands.forEach(h => {
            commandCounts[h.command] = (commandCounts[h.command] || 0) + 1;
        });
        
        const maxSameCommand = Math.max(...Object.values(commandCounts));
        const isRepetitive = maxSameCommand > settings.maxCommands * 0.7;
        
        return {
            flagged: true,
            reason: `Command spam (${recentCommands.length} commands in ${settings.timeWindow}s)${isRepetitive ? ' - repetitive' : ''}`,
            commandCount: recentCommands.length,
            severity: isRepetitive ? 'HIGH' : 'MEDIUM'
        };
    }
    
    return { flagged: false, reason: null, commandCount: recentCommands.length };
}

// ═══════════════════════════════════════════════════════════════
// CHAT FLOODING DETECTION (Detection #17)
// ═══════════════════════════════════════════════════════════════

// Track chat history per player
const chatHistory = new Map();

/**
 * Advanced chat flood detection with pattern matching
 * @param {string} playerXuid - Player's XUID
 * @param {string} message - Message sent
 * @param {object} settings - Detection settings
 * @returns {object} { flagged: boolean, reason: string, details: object }
 */
function checkChatFlood(playerXuid, message, settings = { 
    maxMessages: 5, 
    timeWindow: 10, 
    duplicateThreshold: 3,
    minMessageLength: 1
}) {
    const now = Date.now();
    const windowMs = settings.timeWindow * 1000;
    
    // Get or create history
    if (!chatHistory.has(playerXuid)) {
        chatHistory.set(playerXuid, []);
    }
    
    const history = chatHistory.get(playerXuid);
    
    // Add current message
    history.push({ message, timestamp: now, length: message.length });
    
    // Filter to recent messages
    const recentMessages = history.filter(h => now - h.timestamp < windowMs);
    chatHistory.set(playerXuid, recentMessages);
    
    const flags = [];
    
    // Check 1: Too many messages
    if (recentMessages.length > settings.maxMessages) {
        flags.push({
            type: 'rate',
            reason: `${recentMessages.length} messages in ${settings.timeWindow}s`,
            severity: 'MEDIUM'
        });
    }
    
    // Check 2: Duplicate messages
    const messageCounts = {};
    recentMessages.forEach(h => {
        const normalized = h.message.toLowerCase().trim();
        messageCounts[normalized] = (messageCounts[normalized] || 0) + 1;
    });
    
    const maxDuplicates = Math.max(...Object.values(messageCounts));
    if (maxDuplicates >= settings.duplicateThreshold) {
        flags.push({
            type: 'duplicate',
            reason: `Same message sent ${maxDuplicates} times`,
            severity: 'HIGH'
        });
    }
    
    // Check 3: Rapid-fire messages (less than 500ms apart)
    let rapidCount = 0;
    for (let i = 1; i < recentMessages.length; i++) {
        if (recentMessages[i].timestamp - recentMessages[i-1].timestamp < 500) {
            rapidCount++;
        }
    }
    if (rapidCount >= 3) {
        flags.push({
            type: 'rapid',
            reason: `${rapidCount} rapid-fire messages (<500ms apart)`,
            severity: 'HIGH'
        });
    }
    
    // Check 4: Character spam (same character repeated)
    if (message.length > 10) {
        const charCounts = {};
        for (const char of message) {
            charCounts[char] = (charCounts[char] || 0) + 1;
        }
        const maxCharRepeat = Math.max(...Object.values(charCounts));
        if (maxCharRepeat > message.length * 0.7) {
            flags.push({
                type: 'charspam',
                reason: 'Character spam detected',
                severity: 'MEDIUM'
            });
        }
    }
    
    // Check 5: Wall of text
    if (message.length > 200) {
        flags.push({
            type: 'wall',
            reason: `Message too long (${message.length} chars)`,
            severity: 'LOW'
        });
    }
    
    if (flags.length > 0) {
        const highSeverity = flags.some(f => f.severity === 'HIGH');
        return {
            flagged: true,
            reason: flags.map(f => f.reason).join(', '),
            details: flags,
            severity: highSeverity ? 'HIGH' : 'MEDIUM'
        };
    }
    
    return { flagged: false, reason: null, details: [] };
}

// ═══════════════════════════════════════════════════════════════
// ADVERTISING DETECTION (Detection #18)
// ═══════════════════════════════════════════════════════════════

/**
 * Patterns for detecting advertisements
 */
const AD_PATTERNS = [
    // Discord invites
    /discord\.gg\/[a-zA-Z0-9]+/i,
    /discord\.com\/invite\/[a-zA-Z0-9]+/i,
    /discordapp\.com\/invite\/[a-zA-Z0-9]+/i,
    /dsc\.gg\/[a-zA-Z0-9]+/i,
    
    // Server IPs (Minecraft)
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/,  // IPv4 with optional port
    /\b[a-zA-Z0-9-]+\.(?:aternos|minehut|mc|play|server|net|pvp|hub)(?:\.[a-z]{2,})?(?::\d+)?\b/i,
    
    // Common server advertising phrases
    /join (?:my|our) (?:server|realm|discord|world)/i,
    /(?:server|realm) (?:ip|code|link|invite)/i,
    /come (?:join|play) (?:on|at)/i,
    /recruiting (?:for|players)/i,
    /looking for (?:members|players|staff)/i,
    
    // YouTube/Twitch advertising
    /youtube\.com\/(?:watch|channel|c)\/?[a-zA-Z0-9_-]*/i,
    /youtu\.be\/[a-zA-Z0-9_-]+/i,
    /twitch\.tv\/[a-zA-Z0-9_]+/i,
    /(?:sub(?:scribe)?|follow) (?:to )?(?:my|our) (?:channel|stream|youtube|twitch)/i,
    
    // Social media
    /(?:follow|add) (?:me|us) (?:on|at) (?:instagram|twitter|tiktok|snapchat)/i,
    /instagram\.com\/[a-zA-Z0-9_.]+/i,
    /twitter\.com\/[a-zA-Z0-9_]+/i,
    /tiktok\.com\/@?[a-zA-Z0-9_.]+/i,
    
    // Selling/trading
    /(?:selling|buying|trading) (?:accounts?|ranks?|items?|coins?)/i,
    /(?:free|cheap) (?:accounts?|ranks?|nitro|robux)/i,
    /dm (?:me|for) (?:prices?|deals?|trades?)/i,
    
    // Websites
    /(?:check out|visit) (?:my|our) (?:website|site|store)/i,
    /www\.[a-zA-Z0-9-]+\.[a-z]{2,}/i
];

/**
 * Whitelist patterns (don't flag these)
 */
const AD_WHITELIST = [
    /minecraft\.net/i,
    /xbox\.com/i,
    /microsoft\.com/i,
    /mojang\.com/i
];

/**
 * Check message for advertising
 * @param {string} message - Message to check
 * @returns {object} { flagged: boolean, reason: string, matches: array }
 */
function checkAdvertising(message) {
    if (!message || typeof message !== 'string') {
        return { flagged: false, reason: null, matches: [] };
    }
    
    // Check whitelist first
    for (const whitelist of AD_WHITELIST) {
        if (whitelist.test(message)) {
            return { flagged: false, reason: null, matches: [] };
        }
    }
    
    const matches = [];
    
    for (const pattern of AD_PATTERNS) {
        const match = message.match(pattern);
        if (match) {
            matches.push({
                pattern: pattern.toString().slice(0, 50),
                matched: match[0],
                severity: pattern.toString().includes('discord') ? 'HIGH' : 'MEDIUM'
            });
        }
    }
    
    if (matches.length > 0) {
        return {
            flagged: true,
            reason: `Advertising detected: ${matches.map(m => m.matched).join(', ')}`,
            matches,
            severity: matches.some(m => m.severity === 'HIGH') ? 'HIGH' : 'MEDIUM'
        };
    }
    
    return { flagged: false, reason: null, matches: [] };
}

// ═══════════════════════════════════════════════════════════════
// INVALID PACKET DETECTION (Detection #20)
// ═══════════════════════════════════════════════════════════════

/**
 * Track packet anomalies per player
 */
const packetAnomalies = new Map();

/**
 * Check for invalid/malformed packets
 * @param {string} playerXuid - Player's XUID
 * @param {string} packetType - Type of packet
 * @param {object} packetData - Packet data
 * @returns {object} { flagged: boolean, reason: string, severity: string }
 */
function checkInvalidPacket(playerXuid, packetType, packetData) {
    const flags = [];
    
    // Get anomaly count for this player
    if (!packetAnomalies.has(playerXuid)) {
        packetAnomalies.set(playerXuid, { count: 0, lastReset: Date.now() });
    }
    
    const anomalyData = packetAnomalies.get(playerXuid);
    
    // Reset counter every 60 seconds
    if (Date.now() - anomalyData.lastReset > 60000) {
        anomalyData.count = 0;
        anomalyData.lastReset = Date.now();
    }
    
    // Check for impossibly large values
    if (packetData) {
        // Position checks
        if (packetData.position || packetData.pos) {
            const pos = packetData.position || packetData.pos;
            if (Math.abs(pos.x) > 30000000 || Math.abs(pos.z) > 30000000) {
                flags.push({ reason: 'Invalid position (out of world bounds)', severity: 'HIGH' });
            }
            if (pos.y < -1000 || pos.y > 500) {
                flags.push({ reason: `Suspicious Y coordinate: ${pos.y}`, severity: 'MEDIUM' });
            }
        }
        
        // Velocity checks
        if (packetData.velocity || packetData.motion) {
            const vel = packetData.velocity || packetData.motion;
            const speed = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2);
            if (speed > 100) {
                flags.push({ reason: `Impossible velocity: ${speed.toFixed(2)}`, severity: 'HIGH' });
            }
        }
        
        // Rotation checks (should be 0-360 or -180 to 180)
        if (packetData.yaw !== undefined) {
            if (Math.abs(packetData.yaw) > 360) {
                flags.push({ reason: 'Invalid yaw rotation', severity: 'LOW' });
            }
        }
        if (packetData.pitch !== undefined) {
            if (Math.abs(packetData.pitch) > 90) {
                flags.push({ reason: 'Invalid pitch rotation', severity: 'MEDIUM' });
            }
        }
        
        // Slot/inventory checks
        if (packetData.slot !== undefined) {
            if (packetData.slot < -1 || packetData.slot > 500) {
                flags.push({ reason: `Invalid slot number: ${packetData.slot}`, severity: 'HIGH' });
            }
        }
        
        // Count/amount checks
        if (packetData.count !== undefined || packetData.amount !== undefined) {
            const count = packetData.count ?? packetData.amount;
            if (count < 0 || count > 64 * 100) {
                flags.push({ reason: `Invalid item count: ${count}`, severity: 'HIGH' });
            }
        }
        
        // String length checks (potential buffer overflow attempts)
        for (const [key, value] of Object.entries(packetData)) {
            if (typeof value === 'string' && value.length > 10000) {
                flags.push({ reason: `Oversized string in ${key}: ${value.length} chars`, severity: 'CRITICAL' });
            }
        }
    }
    
    if (flags.length > 0) {
        anomalyData.count += flags.length;
        
        return {
            flagged: true,
            reason: flags.map(f => f.reason).join(', '),
            severity: flags.some(f => f.severity === 'CRITICAL') ? 'CRITICAL' : 
                     flags.some(f => f.severity === 'HIGH') ? 'HIGH' : 'MEDIUM',
            anomalyCount: anomalyData.count
        };
    }
    
    return { flagged: false, reason: null, severity: null };
}

// ═══════════════════════════════════════════════════════════════
// PACKET RATE LIMITING (Detection #21)
// ═══════════════════════════════════════════════════════════════

/**
 * Track packet rates per player
 */
const packetRates = new Map();

/**
 * Packet rate limits per type (packets per second)
 */
const PACKET_RATE_LIMITS = {
    'move_player': 30,           // Movement (normal is ~20/s)
    'player_action': 20,         // Actions like jumping, sneaking
    'inventory_transaction': 15, // Inventory interactions
    'animate': 10,               // Animations (arm swing, etc)
    'interact': 10,              // Entity interactions
    'block_pick_request': 5,     // Block picking
    'command_request': 5,        // Commands
    'text': 10,                  // Chat messages
    'mob_equipment': 10,         // Equipment changes
    'default': 50                // Default for unspecified packets
};

/**
 * Check packet rate for flooding
 * @param {string} playerXuid - Player's XUID
 * @param {string} packetType - Type of packet
 * @returns {object} { flagged: boolean, reason: string, rate: number }
 */
function checkPacketRate(playerXuid, packetType) {
    const now = Date.now();
    
    // Get or create rate tracker
    if (!packetRates.has(playerXuid)) {
        packetRates.set(playerXuid, {});
    }
    
    const playerRates = packetRates.get(playerXuid);
    
    if (!playerRates[packetType]) {
        playerRates[packetType] = { count: 0, windowStart: now, violations: 0 };
    }
    
    const rateData = playerRates[packetType];
    
    // Reset window every second
    if (now - rateData.windowStart >= 1000) {
        // Check if previous second exceeded limit
        const limit = PACKET_RATE_LIMITS[packetType] || PACKET_RATE_LIMITS.default;
        if (rateData.count > limit) {
            rateData.violations++;
        }
        rateData.count = 0;
        rateData.windowStart = now;
    }
    
    rateData.count++;
    
    const limit = PACKET_RATE_LIMITS[packetType] || PACKET_RATE_LIMITS.default;
    const currentRate = rateData.count;
    
    // Flag if significantly over limit
    if (currentRate > limit * 2) {
        return {
            flagged: true,
            reason: `Packet flood: ${packetType} at ${currentRate}/s (limit: ${limit})`,
            rate: currentRate,
            violations: rateData.violations,
            severity: currentRate > limit * 5 ? 'CRITICAL' : 'HIGH'
        };
    }
    
    // Flag if consistent violations
    if (rateData.violations >= 3) {
        return {
            flagged: true,
            reason: `Sustained packet abuse: ${packetType} (${rateData.violations} violations)`,
            rate: currentRate,
            violations: rateData.violations,
            severity: 'HIGH'
        };
    }
    
    return { flagged: false, reason: null, rate: currentRate };
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY MANIPULATION DETECTION (Detection #22)
// ═══════════════════════════════════════════════════════════════

/**
 * Illegal items that shouldn't exist in survival
 */
const ILLEGAL_ITEMS = [
    'minecraft:command_block',
    'minecraft:chain_command_block', 
    'minecraft:repeating_command_block',
    'minecraft:command_block_minecart',
    'minecraft:barrier',
    'minecraft:structure_block',
    'minecraft:structure_void',
    'minecraft:jigsaw',
    'minecraft:light_block',
    'minecraft:debug_stick',
    'minecraft:spawn_egg',       // Generic spawn egg
    'minecraft:bedrock',
    'minecraft:end_portal_frame',
    'minecraft:end_portal',
    'minecraft:nether_portal',
    'minecraft:fire',
    'minecraft:soul_fire',
    'minecraft:water',
    'minecraft:lava',
    'minecraft:air',
    'minecraft:mob_spawner',
    'minecraft:infested_',       // Infested blocks (prefix)
    'minecraft:petrified_oak_slab',
    'minecraft:knowledge_book',
    'minecraft:bundle',          // Not fully implemented
    'minecraft:suspicious_stew', // With invalid effects
    'minecraft:written_book',    // Can contain exploits
    'minecraft:firework_rocket', // With invalid data
    'minecraft:enchanted_book'   // With invalid enchants
];

/**
 * Items with restricted enchantments/NBT
 */
const RESTRICTED_ENCHANTS = {
    'sharpness': 5,
    'smite': 5,
    'bane_of_arthropods': 5,
    'knockback': 2,
    'fire_aspect': 2,
    'looting': 3,
    'sweeping': 3,
    'efficiency': 5,
    'silk_touch': 1,
    'unbreaking': 3,
    'fortune': 3,
    'power': 5,
    'punch': 2,
    'flame': 1,
    'infinity': 1,
    'luck_of_the_sea': 3,
    'lure': 3,
    'loyalty': 3,
    'impaling': 5,
    'riptide': 3,
    'channeling': 1,
    'multishot': 1,
    'quick_charge': 3,
    'piercing': 4,
    'mending': 1,
    'vanishing_curse': 1,
    'binding_curse': 1,
    'protection': 4,
    'fire_protection': 4,
    'feather_falling': 4,
    'blast_protection': 4,
    'projectile_protection': 4,
    'respiration': 3,
    'aqua_affinity': 1,
    'thorns': 3,
    'depth_strider': 3,
    'frost_walker': 2,
    'soul_speed': 3,
    'swift_sneak': 3
};

/**
 * Check for illegal inventory manipulations
 * @param {object} inventoryData - Inventory transaction data
 * @returns {object} { flagged: boolean, reason: string, items: array }
 */
function checkInventoryManipulation(inventoryData) {
    if (!inventoryData) {
        return { flagged: false, reason: null, items: [] };
    }
    
    const flags = [];
    
    // Check transaction actions
    const actions = inventoryData.actions || inventoryData.transaction?.actions || [];
    
    for (const action of actions) {
        const item = action.new_item || action.item || action;
        
        if (!item || !item.network_id) continue;
        
        const itemName = (item.name || item.network_id || '').toLowerCase();
        
        // Check for illegal items
        for (const illegal of ILLEGAL_ITEMS) {
            if (itemName.includes(illegal.replace('minecraft:', ''))) {
                flags.push({
                    type: 'illegal_item',
                    item: itemName,
                    reason: `Illegal item: ${itemName}`,
                    severity: 'CRITICAL'
                });
            }
        }
        
        // Check for impossible stack sizes
        const count = item.count || item.amount || 1;
        const maxStack = item.max_stack_size || 64;
        
        if (count > maxStack && count > 64) {
            flags.push({
                type: 'impossible_stack',
                item: itemName,
                count: count,
                reason: `Impossible stack size: ${count}x ${itemName}`,
                severity: 'HIGH'
            });
        }
        
        if (count < 0) {
            flags.push({
                type: 'negative_stack',
                item: itemName,
                count: count,
                reason: `Negative item count: ${count}`,
                severity: 'CRITICAL'
            });
        }
        
        // Check for invalid enchantments
        const enchants = item.enchantments || item.nbt?.Enchantments || [];
        for (const enchant of enchants) {
            const enchantName = (enchant.name || enchant.id || '').toLowerCase().replace('minecraft:', '');
            const level = enchant.level || enchant.lvl || 1;
            
            const maxLevel = RESTRICTED_ENCHANTS[enchantName];
            if (maxLevel && level > maxLevel) {
                flags.push({
                    type: 'invalid_enchant',
                    enchant: enchantName,
                    level: level,
                    maxLevel: maxLevel,
                    reason: `Invalid enchant level: ${enchantName} ${level} (max: ${maxLevel})`,
                    severity: 'HIGH'
                });
            }
            
            // Check for impossible enchant levels
            if (level > 255 || level < 0) {
                flags.push({
                    type: 'exploit_enchant',
                    enchant: enchantName,
                    level: level,
                    reason: `Exploit enchant level: ${enchantName} ${level}`,
                    severity: 'CRITICAL'
                });
            }
        }
        
        // Check for suspicious NBT data
        if (item.nbt) {
            const nbtString = JSON.stringify(item.nbt);
            if (nbtString.length > 50000) {
                flags.push({
                    type: 'oversized_nbt',
                    size: nbtString.length,
                    reason: `Oversized NBT data: ${nbtString.length} bytes`,
                    severity: 'CRITICAL'
                });
            }
        }
    }
    
    if (flags.length > 0) {
        return {
            flagged: true,
            reason: flags.map(f => f.reason).join(', '),
            items: flags,
            severity: flags.some(f => f.severity === 'CRITICAL') ? 'CRITICAL' : 'HIGH'
        };
    }
    
    return { flagged: false, reason: null, items: [] };
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP FUNCTION (Memory Management)
// ═══════════════════════════════════════════════════════════════

/**
 * Clean up old tracking data to prevent memory leaks
 * Should be called periodically
 */
function cleanupTrackingData() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    // Clean chat history
    for (const [xuid, history] of chatHistory.entries()) {
        const recent = history.filter(h => now - h.timestamp < maxAge);
        if (recent.length === 0) {
            chatHistory.delete(xuid);
        } else {
            chatHistory.set(xuid, recent);
        }
    }
    
    // Clean command history
    for (const [xuid, history] of commandHistory.entries()) {
        const recent = history.filter(h => now - h.timestamp < maxAge);
        if (recent.length === 0) {
            commandHistory.delete(xuid);
        } else {
            commandHistory.set(xuid, recent);
        }
    }
    
    // Clean packet rates (reset old entries)
    for (const [xuid, rates] of packetRates.entries()) {
        let hasRecent = false;
        for (const [type, data] of Object.entries(rates)) {
            if (now - data.windowStart < maxAge) {
                hasRecent = true;
            }
        }
        if (!hasRecent) {
            packetRates.delete(xuid);
        }
    }
    
    // Clean packet anomalies
    for (const [xuid, data] of packetAnomalies.entries()) {
        if (now - data.lastReset > maxAge) {
            packetAnomalies.delete(xuid);
        }
    }
}

// Run cleanup every 2 minutes
setInterval(cleanupTrackingData, 2 * 60 * 1000);

/**
 * Check player against automod rules
 * @param {string} discordUserId - Guild ID
 * @param {object} player - Player data from packet
 * @param {object} realmInfo - Realm info
 * @returns {Promise<object>} { shouldBan: boolean, shouldKick: boolean, reason: string, rule: string }
 */
async function checkAutomodRules(discordUserId, player, realmInfo) {
    const config = getGuildConfig(discordUserId);
    const automod = config.automod || {};
    
    console.log(`[Automod] Checking player ${player.username} (${player.xuid})`);
    
    // 1. Anti-Unfair Skins Check
    if (automod.antiUnfairSkins && player.skin) {
        const skinCheck = checkSkinData(player.skin);
        if (skinCheck.flagged) {
            console.log(`[Automod] 🚫 Unfair skin detected for ${player.username}: ${skinCheck.reason}`);
            return { 
                shouldBan: true, 
                shouldKick: false, 
                reason: skinCheck.reason, 
                rule: 'Anti-Unfair Skins' 
            };
        }
    }
    
    // 2. Anti-Alts Check (gamerscore)
    if (automod.antiAlts) {
        const settings = automod.antiAltsSettings || { minGamerscore: 0, minFriends: 0, minFollowers: 0 };
        
        if (settings.minGamerscore > 0 && player.xuid) {
            try {
                const profile = await getXboxProfile(discordUserId, player.xuid);
                if (profile) {
                    const gamerscore = parseInt(profile.gamerscore) || 0;
                    if (gamerscore < settings.minGamerscore) {
                        console.log(`[Automod] 🚫 Low gamerscore for ${player.username}: ${gamerscore} < ${settings.minGamerscore}`);
                        return {
                            shouldBan: false,
                            shouldKick: true,
                            reason: `Gamerscore too low (${gamerscore} < ${settings.minGamerscore})`,
                            rule: 'Anti-Alts'
                        };
                    }
                }
            } catch (e) {
                console.log(`[Automod] Could not check gamerscore for ${player.username}: ${e.message}`);
            }
        }
    }
    
    // 3. Anti-Private Profile Check
    if (automod.antiPrivateProfile && player.xuid) {
        try {
            const profile = await getXboxProfile(discordUserId, player.xuid);
            // If profile fetch fails or returns null, might be private
            if (!profile) {
                console.log(`[Automod] 🚫 Private profile detected for ${player.username}`);
                return {
                    shouldBan: false,
                    shouldKick: true,
                    reason: 'Private Xbox profile',
                    rule: 'Anti-Private Profile'
                };
            }
        } catch (e) {
            // 401 usually means private profile
            if (e.message?.includes('401') || e.message?.includes('private')) {
                console.log(`[Automod] 🚫 Private profile detected for ${player.username}`);
                return {
                    shouldBan: false,
                    shouldKick: true,
                    reason: 'Private Xbox profile',
                    rule: 'Anti-Private Profile'
                };
            }
        }
    }
    
    // 4. Anti-Spoof Check (spoofed gamertag/XUID mismatch)
    if (automod.antiSpoof && player.xuid) {
        try {
            const profile = await getXboxProfile(discordUserId, player.xuid);
            if (profile && profile.gamertag) {
                // Check if gamertag matches
                if (profile.gamertag.toLowerCase() !== player.username.toLowerCase()) {
                    console.log(`[Automod] 🚫 Spoofed account detected: ${player.username} vs ${profile.gamertag}`);
                    return {
                        shouldBan: true,
                        shouldKick: false,
                        reason: `Spoofed gamertag (claims ${player.username}, actually ${profile.gamertag})`,
                        rule: 'Anti-Spoof'
                    };
                }
            }
        } catch (e) {
            console.log(`[Automod] Could not verify gamertag for ${player.username}: ${e.message}`);
        }
    }
    
    // 5. ADVANCED DEVICE SPOOF CHECK
    if (automod.antiDeviceSpoof && player.rawData) {
        const deviceCheck = checkDeviceData(player.rawData);
        if (deviceCheck.flagged) {
            console.log(`[Automod] 🚫 Device spoof detected for ${player.username}: ${deviceCheck.reason}`);
            
            // Auto-ban if shouldAutoBan flag is set (CRITICAL or multiple HIGH flags)
            if (deviceCheck.shouldAutoBan) {
                return {
                    shouldBan: true,
                    shouldKick: false,
                    reason: deviceCheck.reason,
                    rule: 'Anti-Device Spoof'
                };
            } else {
                // Just kick for minor violations
                return {
                    shouldBan: false,
                    shouldKick: true,
                    reason: deviceCheck.reason,
                    rule: 'Anti-Device Spoof'
                };
            }
        }
    }
    
    // 6. ACCOUNT AGE CHECK (Detection #10)
    if (automod.antiNewAccounts && player.xuid) {
        try {
            const profile = await getXboxProfile(discordUserId, player.xuid);
            if (profile) {
                const settings = automod.antiNewAccountsSettings || { minAccountAgeDays: 30 };
                const ageCheck = checkAccountAge(profile, settings.minAccountAgeDays);
                if (ageCheck.flagged) {
                    console.log(`[Automod] 🚫 New account detected for ${player.username}: ${ageCheck.reason}`);
                    return {
                        shouldBan: false,
                        shouldKick: true,
                        reason: ageCheck.reason,
                        rule: 'Anti-New Accounts'
                    };
                }
            }
        } catch (e) {
            console.log(`[Automod] Could not check account age for ${player.username}: ${e.message}`);
        }
    }
    
    return { shouldBan: false, shouldKick: false, reason: null, rule: null };
}

/**
 * Execute automod action (ban or kick)
 */
async function executeAutomodAction(discordUserId, realmInfo, player, action, reason, rule) {
    try {
        console.log(`[Automod] ═══════════════════════════════════════════════════`);
        console.log(`[Automod] Rule: ${rule}`);
        console.log(`[Automod] Action: ${action.toUpperCase()}`);
        console.log(`[Automod] Player: ${player.username} (${player.xuid})`);
        console.log(`[Automod] Reason: ${reason}`);
        console.log(`[Automod] ═══════════════════════════════════════════════════`);
        
        if (action === 'ban') {
            await blockPlayer(discordUserId, realmInfo.id, player.xuid);
            console.log(`[Automod] ✅ Successfully banned ${player.username}`);
        }
        // Note: Kick would require sending a command to the realm
        // For now, we'll ban for serious offenses
        
        // Emit event for logging
        botEvents.emit('automodAction', {
            discordUserId,
            realmInfo,
            player: {
                username: player.username,
                xuid: player.xuid,
                device: player.device
            },
            action,
            reason,
            rule,
            success: true
        });
        
        return true;
    } catch (error) {
        console.error(`[Automod] ❌ Failed to ${action} ${player.username}:`, error.message);
        
        botEvents.emit('automodAction', {
            discordUserId,
            realmInfo,
            player: {
                username: player.username,
                xuid: player.xuid,
                device: player.device
            },
            action,
            reason,
            rule,
            success: false,
            error: error.message
        });
        
        return false;
    }
}

/**
 * Ban the last player who joined (automod action)
 * @param {object} botData - Bot data object (to check/set automodTriggered flag)
 */
async function automodBanLastPlayer(botData, trigger) {
    const { discordUserId, realmInfo, lastPlayerJoined } = botData;
    
    // Check if automod already triggered for this session
    if (botData.automodTriggered) {
        console.log(`[Automod] Already triggered for this session, skipping`);
        return false;
    }
    
    if (!automodConfig.enabled || !automodConfig.banOnCrash || !lastPlayerJoined) {
        console.log(`[Automod] Skipping - enabled=${automodConfig.enabled}, banOnCrash=${automodConfig.banOnCrash}, hasLastPlayer=${!!lastPlayerJoined}`);
        return false;
    }
    
    // Mark as triggered to prevent double-ban
    botData.automodTriggered = true;
    
    try {
        console.log(`[Automod] ═══════════════════════════════════════════════════`);
        console.log(`[Automod] ${automodConfig.type}: ${automodConfig.message}`);
        console.log(`[Automod] Banning: ${lastPlayerJoined.username} (${lastPlayerJoined.xuid})`);
        console.log(`[Automod] Trigger: ${trigger}`);
        console.log(`[Automod] Realm: ${realmInfo.name} (${realmInfo.id})`);
        console.log(`[Automod] ═══════════════════════════════════════════════════`);
        
        // Actually ban the player
        await blockPlayer(discordUserId, realmInfo.id, lastPlayerJoined.xuid);
        
        console.log(`[Automod] ✅ Successfully banned ${lastPlayerJoined.username} from ${realmInfo.name}`);
        
        // Emit event for logging to Discord
        botEvents.emit('automodBan', {
            discordUserId,
            realmInfo,
            player: lastPlayerJoined,
            reason: `${automodConfig.type}: ${automodConfig.message}`,
            trigger: trigger,
            success: true
        });
        
        return true;
    } catch (error) {
        console.error(`[Automod] ❌ Failed to ban ${lastPlayerJoined.username}:`, error.message);
        
        botEvents.emit('automodBan', {
            discordUserId,
            realmInfo,
            player: lastPlayerJoined,
            reason: `${automodConfig.type}: ${automodConfig.message}`,
            trigger: trigger,
            success: false,
            error: error.message
        });
        
        return false;
    }
}

/**
 * Send a command to the server
 * @param {object} client - Bedrock client
 * @param {string} command - Command to send (without leading /)
 */
function sendCommand(client, command) {
    client.queue('command_request', {
        command: command,
        origin: {
            type: 'player',
            uuid: '',
            request_id: ''
        },
        internal: false,
        version: 52
    });
}

/**
 * Create and connect a Minecraft bot to a realm
 * @param {string} odiscordUserId - Discord user ID (owner)
 * @param {object} realmInfo - Realm connection info
 * @param {string} authCacheDir - Path to auth cache for this user
 * @returns {Promise<object>} Bot client
 */
export async function connectToRealm(discordUserId, realmInfo, authCacheDir) {
    // Check if already connected
    if (activeBots.has(discordUserId)) {
        const existing = activeBots.get(discordUserId);
        if (existing.client && !existing.client.ended) {
            console.log(`[Bot] Already connected for user ${discordUserId}`);
            return existing;
        }
    }
    
    console.log(`[Bot] Connecting to realm ${realmInfo.name} (${realmInfo.id})...`);
    
    try {
        const client = bedrock.createClient({
            realms: {
                realmId: realmInfo.id.toString()
            },
            profilesFolder: authCacheDir,
            skipPing: true,
            conLog: (msg) => console.log(`[MC] ${msg}`)
        });
        
        const botData = {
            client,
            discordUserId,
            realmInfo,
            connectedAt: new Date(),
            players: [],
            status: 'connecting',
            lastPlayerJoined: null,  // Track last player who joined for automod
            automodTriggered: false  // Prevent double-ban
        };
        
        // Handle successful spawn
        client.on('spawn', async () => {
            console.log(`[Bot] Successfully spawned in realm ${realmInfo.name}`);
            botData.status = 'connected';
            botEvents.emit('connected', { discordUserId, realmInfo });
            
            // Auto-OP and Spectator via Realms API
            // Get the BOT's XUID from the Bedrock token cache, NOT the realm owner's XUID
            const botXuid = getBotXuidFromCache(authCacheDir);
            
            if (botXuid) {
                console.log(`[Bot] Setting up permissions for bot XUID: ${botXuid}`);
                
                // OP the player using Realms API (fire and forget - don't await to speed up)
                opPlayer(discordUserId, realmInfo.id, botXuid)
                    .then(() => console.log('[Bot] Successfully set to OP via Realms API'))
                    .catch(e => console.log('[Bot] OP result:', e.message));
                
                // Set gamemode to spectator after a short delay
                setTimeout(() => {
                    console.log('[Bot] Setting gamemode to spectator...');
                    sendCommand(client, '/gamemode spectator @s');
                    
                    // Keep enforcing spectator mode every 10 seconds (reduced frequency)
                    const spectatorInterval = setInterval(() => {
                        if (client.ended) {
                            clearInterval(spectatorInterval);
                            return;
                        }
                        sendCommand(client, '/gamemode spectator @s');
                    }, 10000);
                    
                    // Store interval so we can clear it on disconnect
                    botData.spectatorInterval = spectatorInterval;
                }, 1000);
            } else {
                console.log('[Bot] No bot XUID found in cache, trying spectator command anyway');
                setTimeout(() => {
                    sendCommand(client, 'gamemode spectator @s');
                }, 1000);
            }
        });
        
        // Handle player list updates
        client.on('player_list', async (packet) => {
            console.log(`[Player List] Type: ${packet.records?.type}, Records: ${JSON.stringify(packet.records?.records?.length || 0)}`);
            
            // Handle both add and remove types
            if (packet.records && packet.records.records) {
                const records = packet.records.records;
                const type = packet.records.type;
                
                if (type === 'add') {
                    // Players joining
                    for (const p of records) {
                        const device = getDeviceName(p.build_platform);
                        console.log(`[Player Join] ${p.username} (${p.xbox_user_id}) on ${device}`);
                        
                        // Build player object with skin data and raw packet data for device checks
                        const playerData = {
                            username: p.username,
                            xuid: p.xbox_user_id,
                            uuid: p.uuid,
                            device: device,
                            joinedAt: Date.now(),
                            skin: {
                                skin_data: p.skin?.skin_data,
                                skin_image_width: p.skin?.skin_image_width,
                                skin_image_height: p.skin?.skin_image_height,
                                skin_resource_patch: p.skin?.skin_resource_patch,
                                geometry_data: p.skin?.geometry_data,
                                geometry_data_engine_version: p.skin?.geometry_data_engine_version,
                                trusted_skin: p.skin?.trusted_skin
                            },
                            // Raw packet data for advanced device checks
                            rawData: {
                                build_platform: p.build_platform,
                                device_model: p.device_model,
                                device_id: p.device_id,
                                current_input_mode: p.current_input_mode,
                                default_input_mode: p.default_input_mode,
                                ui_profile: p.ui_profile,
                                gui_scale: p.gui_scale,
                                language_code: p.language_code,
                                platform_online_id: p.platform_online_id,
                                platform_offline_id: p.platform_offline_id,
                                self_signed_id: p.self_signed_id,
                                server_address: p.server_address,
                                third_party_name: p.third_party_name,
                                is_editor_mode: p.is_editor_mode,
                                trusted_skin: p.skin?.trusted_skin,
                                platform_chat_id: p.platform_chat_id,
                                game_version: p.game_version,
                                device_os: p.device_os,
                                tenant_id: p.tenant_id,
                                ad_role: p.ad_role,
                                is_persona_skin: p.skin?.is_persona_skin,
                                is_premium_skin: p.skin?.is_premium_skin,
                                is_trusted_host: p.is_trusted_host
                            }
                        };
                        
                        // Track as last player joined (for automod crash detection)
                        botData.lastPlayerJoined = playerData;
                        
                        // ═══════════════════════════════════════════════════════════════
                        // RUN AUTOMOD CHECKS ON JOIN
                        // ═══════════════════════════════════════════════════════════════
                        const automodResult = await checkAutomodRules(discordUserId, playerData, realmInfo);
                        
                        if (automodResult.shouldBan) {
                            console.log(`[Automod] 🚫 Banning ${p.username} - ${automodResult.rule}: ${automodResult.reason}`);
                            await executeAutomodAction(discordUserId, realmInfo, playerData, 'ban', automodResult.reason, automodResult.rule);
                        } else if (automodResult.shouldKick) {
                            console.log(`[Automod] 👢 Would kick ${p.username} - ${automodResult.rule}: ${automodResult.reason}`);
                            // For kicks, we ban since we can't kick via API easily
                            await executeAutomodAction(discordUserId, realmInfo, playerData, 'ban', automodResult.reason, automodResult.rule);
                        }
                        
                        botEvents.emit('playerJoin', {
                            discordUserId,
                            player: {
                                username: p.username,
                                xuid: p.xbox_user_id,
                                uuid: p.uuid,
                                device: device
                            }
                        });
                        
                        // Also add to players list
                        const existingIndex = botData.players.findIndex(pl => pl.xuid === p.xbox_user_id);
                        if (existingIndex === -1) {
                            botData.players.push({
                                username: p.username,
                                xuid: p.xbox_user_id,
                                uuid: p.uuid,
                                device: device
                            });
                        }
                    }
                } else if (type === 'remove') {
                    // Players leaving
                    for (const p of records) {
                        // Find the player in our list
                        const player = botData.players.find(pl => pl.uuid === p.uuid);
                        if (player) {
                            console.log(`[Player Leave] ${player.username} (${player.xuid})`);
                            botEvents.emit('playerLeave', {
                                discordUserId,
                                player: {
                                    username: player.username,
                                    xuid: player.xuid,
                                    uuid: player.uuid,
                                    device: player.device
                                }
                            });
                            
                            // Remove from players list
                            botData.players = botData.players.filter(pl => pl.uuid !== p.uuid);
                        }
                    }
                }
                
                // Also emit full list for backwards compatibility
                botEvents.emit('playerList', { discordUserId, players: botData.players });
            }
        });
        
        // Handle chat messages
        client.on('text', async (packet) => {
            // Log all text packets for debugging
            console.log(`[Text Packet] Type: ${packet.type}, Message: ${packet.message}, Source: ${packet.source_name}`);
            
            const config = getGuildConfig(discordUserId);
            const automod = config.automod || {};
            
            // Get player info for automod actions
            const senderName = packet.source_name || 'Unknown';
            const senderPlayer = botData.players.find(p => p.username === senderName);
            const senderXuid = senderPlayer?.xuid;
            
            // ═══════════════════════════════════════════════════════════════
            // CHAT-BASED AUTOMOD CHECKS
            // ═══════════════════════════════════════════════════════════════
            
            if (packet.message && senderXuid && senderName !== 'System') {
                
                // Detection #15: Unicode Exploit Check
                if (automod.antiUnicodeExploit) {
                    const unicodeCheck = checkUnicodeExploit(packet.message);
                    if (unicodeCheck.flagged) {
                        console.log(`[Automod] 🚫 Unicode exploit from ${senderName}: ${unicodeCheck.reason}`);
                        await executeAutomodAction(discordUserId, realmInfo, 
                            { username: senderName, xuid: senderXuid, device: senderPlayer?.device },
                            'ban', unicodeCheck.reason, 'Anti-Unicode Exploit');
                        return; // Don't process malicious message further
                    }
                }
                
                // Detection #17: Chat Flood Check
                if (automod.antiChatFlood) {
                    const settings = automod.antiChatFloodSettings || { maxMessages: 5, timeWindow: 10, duplicateThreshold: 3 };
                    const floodCheck = checkChatFlood(senderXuid, packet.message, settings);
                    if (floodCheck.flagged) {
                        console.log(`[Automod] 🚫 Chat flood from ${senderName}: ${floodCheck.reason}`);
                        // Kick for flooding (ban if HIGH severity)
                        const action = floodCheck.severity === 'HIGH' ? 'ban' : 'ban'; // We ban since we can't kick
                        await executeAutomodAction(discordUserId, realmInfo,
                            { username: senderName, xuid: senderXuid, device: senderPlayer?.device },
                            action, floodCheck.reason, 'Anti-Chat Flood');
                        return;
                    }
                }
                
                // Detection #18: Advertising Check
                if (automod.antiAdvertising) {
                    const adCheck = checkAdvertising(packet.message);
                    if (adCheck.flagged) {
                        console.log(`[Automod] 🚫 Advertising from ${senderName}: ${adCheck.reason}`);
                        await executeAutomodAction(discordUserId, realmInfo,
                            { username: senderName, xuid: senderXuid, device: senderPlayer?.device },
                            'ban', adCheck.reason, 'Anti-Advertising');
                        return;
                    }
                }
            }
            
            // Handle JSON formatted messages (from tellraw/say commands)
            if (packet.type === 'json' && packet.message) {
                try {
                    const json = JSON.parse(packet.message);
                    if (json.rawtext && json.rawtext.length > 0) {
                        // Combine all text parts
                        let fullText = json.rawtext.map(part => part.text || '').join('');
                        
                        // Remove Minecraft formatting codes (§ followed by a character)
                        fullText = fullText.replace(/§[0-9a-fk-or]/gi, '');
                        
                        // Try to extract rank, sender, and message from formats like "[Rank] Player: Message"
                        const rankChatMatch = fullText.match(/^\[([^\]]+)\]\s*([^:]+):\s*(.+)$/);
                        const simpleChatMatch = fullText.match(/^([^:]+):\s*(.+)$/);
                        
                        if (rankChatMatch) {
                            const rank = rankChatMatch[1].trim();
                            const sender = rankChatMatch[2].trim();
                            const message = rankChatMatch[3].trim();
                            console.log(`[Chat] [${rank}] ${sender}: ${message}`);
                            botEvents.emit('chat', {
                                discordUserId,
                                sender: sender,
                                message: message,
                                rank: rank,
                                type: 'json'
                            });
                        } else if (simpleChatMatch) {
                            const sender = simpleChatMatch[1].trim();
                            const message = simpleChatMatch[2].trim();
                            console.log(`[Chat] ${sender}: ${message}`);
                            botEvents.emit('chat', {
                                discordUserId,
                                sender: sender,
                                message: message,
                                rank: null,
                                type: 'json'
                            });
                        } else if (fullText.trim()) {
                            // Just emit the full text if we can't parse it
                            console.log(`[Chat] System: ${fullText}`);
                            botEvents.emit('chat', {
                                discordUserId,
                                sender: 'System',
                                message: fullText,
                                rank: null,
                                type: 'json'
                            });
                        }
                    }
                } catch (e) {
                    console.log(`[Chat] Failed to parse JSON message: ${e.message}`);
                }
            }
            
            // Handle regular chat messages
            if (packet.type === 'chat' && packet.source_name) {
                console.log(`[Chat] ${packet.source_name}: ${packet.message}`);
                botEvents.emit('chat', {
                    discordUserId,
                    sender: packet.source_name,
                    message: packet.message,
                    type: packet.type
                });
            }
            
            // Detect death messages (they come as 'translation' type)
            if (packet.type === 'translation' || packet.type === 'jukebox_popup') {
                const msg = (packet.message || '').toLowerCase();
                const deathPrefixes = ['death.', 'entity.'];
                
                if (deathPrefixes.some(prefix => msg.startsWith(prefix)) || msg.includes('.death.')) {
                    // Try to extract player name from params or message
                    const playerName = packet.parameters?.[0] || packet.source_name || 'Unknown';
                    console.log(`[Death] ${playerName}: ${packet.message}`);
                    botEvents.emit('death', {
                        discordUserId,
                        player: playerName,
                        message: packet.message,
                        cause: packet.message
                    });
                }
            }
        });
        
        // ═══════════════════════════════════════════════════════════════
        // PACKET-BASED AUTOMOD HANDLERS
        // ═══════════════════════════════════════════════════════════════
        
        // Detection #22: Inventory Manipulation Detection
        client.on('inventory_transaction', async (packet) => {
            const config = getGuildConfig(discordUserId);
            const automod = config.automod || {};
            
            if (!automod.antiInventoryExploit) return;
            
            // Try to identify the player
            const playerXuid = packet.transaction?.source?.entity_runtime_id ? 
                botData.players.find(p => p.runtimeId === packet.transaction?.source?.entity_runtime_id)?.xuid : null;
            
            const invCheck = checkInventoryManipulation(packet);
            if (invCheck.flagged) {
                console.log(`[Automod] 🚫 Inventory exploit detected: ${invCheck.reason}`);
                
                // If we can identify the player, ban them
                if (playerXuid) {
                    const player = botData.players.find(p => p.xuid === playerXuid);
                    if (player) {
                        await executeAutomodAction(discordUserId, realmInfo, player, 'ban', invCheck.reason, 'Anti-Inventory Exploit');
                    }
                } else if (botData.lastPlayerJoined) {
                    // Ban last player if we can't identify
                    console.log(`[Automod] Can't identify exploiter, banning last joined player`);
                    await executeAutomodAction(discordUserId, realmInfo, botData.lastPlayerJoined, 'ban', invCheck.reason, 'Anti-Inventory Exploit');
                }
            }
        });
        
        // Detection #16: Command Spam Detection
        client.on('command_request', async (packet) => {
            const config = getGuildConfig(discordUserId);
            const automod = config.automod || {};
            
            if (!automod.antiCommandSpam) return;
            
            // Get the player who sent the command
            const originPlayer = packet.origin?.player_unique_id ? 
                botData.players.find(p => p.uniqueId === packet.origin?.player_unique_id) : null;
            const playerXuid = originPlayer?.xuid || botData.lastPlayerJoined?.xuid;
            
            if (!playerXuid) return;
            
            const settings = automod.antiCommandSpamSettings || { maxCommands: 10, timeWindow: 5 };
            const spamCheck = checkCommandSpam(playerXuid, packet.command, settings);
            
            if (spamCheck.flagged) {
                const player = botData.players.find(p => p.xuid === playerXuid) || botData.lastPlayerJoined;
                console.log(`[Automod] 🚫 Command spam from ${player?.username}: ${spamCheck.reason}`);
                
                if (player) {
                    await executeAutomodAction(discordUserId, realmInfo, player, 'ban', spamCheck.reason, 'Anti-Command Spam');
                }
            }
        });
        
        // Detection #20 & #21: Generic Packet Validation & Rate Limiting
        // Hook into all packets for monitoring
        const originalEmit = client.emit.bind(client);
        client.emit = function(eventName, ...args) {
            const config = getGuildConfig(discordUserId);
            const automod = config.automod || {};
            
            // Only check specific packet types that could be exploited
            const monitoredPackets = [
                'move_player', 'player_action', 'animate', 'interact',
                'block_pick_request', 'mob_equipment', 'player_input'
            ];
            
            if (monitoredPackets.includes(eventName) && args[0]) {
                const packetData = args[0];
                
                // Try to get player XUID from packet
                const playerXuid = packetData.runtime_entity_id ? 
                    botData.players.find(p => p.runtimeId === packetData.runtime_entity_id)?.xuid : 
                    botData.lastPlayerJoined?.xuid;
                
                if (playerXuid) {
                    // Detection #21: Packet Rate Limiting
                    if (automod.antiPacketFlood) {
                        const rateCheck = checkPacketRate(playerXuid, eventName);
                        if (rateCheck.flagged) {
                            const player = botData.players.find(p => p.xuid === playerXuid) || botData.lastPlayerJoined;
                            console.log(`[Automod] 🚫 Packet flood from ${player?.username}: ${rateCheck.reason}`);
                            
                            // Only ban on CRITICAL severity (5x over limit)
                            if (rateCheck.severity === 'CRITICAL' && player) {
                                executeAutomodAction(discordUserId, realmInfo, player, 'ban', rateCheck.reason, 'Anti-Packet Flood');
                            }
                        }
                    }
                    
                    // Detection #20: Invalid Packet Detection
                    if (automod.antiInvalidPackets) {
                        const invalidCheck = checkInvalidPacket(playerXuid, eventName, packetData);
                        if (invalidCheck.flagged && (invalidCheck.severity === 'CRITICAL' || invalidCheck.anomalyCount > 10)) {
                            const player = botData.players.find(p => p.xuid === playerXuid) || botData.lastPlayerJoined;
                            console.log(`[Automod] 🚫 Invalid packets from ${player?.username}: ${invalidCheck.reason}`);
                            
                            if (player) {
                                executeAutomodAction(discordUserId, realmInfo, player, 'ban', invalidCheck.reason, 'Anti-Invalid Packets');
                            }
                        }
                    }
                }
            }
            
            return originalEmit(eventName, ...args);
        };
        
        // Handle disconnection - THIS IS THE MAIN CRASH DETECTION
        // Any unexpected disconnect while connected = assume crash and ban
        client.on('close', async () => {
            console.log(`[Bot] ⚠️ Connection closed to realm ${realmInfo.name}`);
            
            // Clear spectator interval to prevent memory leak
            if (botData.spectatorInterval) {
                clearInterval(botData.spectatorInterval);
                botData.spectatorInterval = null;
            }
            
            const reason = botData.disconnectReason || 'unknown';
            const wasConnected = botData.status === 'connected';
            
            // If we were connected and got disconnected unexpectedly = CRASH
            // Ban immediately, don't wait for specific error messages
            if (wasConnected && botData.lastPlayerJoined) {
                console.log(`[Bot] 🚨 UNEXPECTED DISCONNECT - Was connected, triggering automod`);
                botData.status = 'realm_crashed';
                
                // Ban IMMEDIATELY
                await automodBanLastPlayer(botData, 'unexpected_disconnect');
                
                botEvents.emit('realmCrashed', { discordUserId, realmInfo, reason, lastPlayer: botData.lastPlayerJoined });
            } else if (reason.includes('closed') || reason.includes('offline') || reason.includes('not accepting')) {
                botData.status = 'realm_closed';
                console.log(`[Bot] Realm ${realmInfo.name} appears to be CLOSED`);
                botEvents.emit('realmClosed', { discordUserId, realmInfo, reason, lastPlayer: botData.lastPlayerJoined });
            } else {
                botData.status = 'disconnected';
            }
            
            botEvents.emit('disconnected', { discordUserId, realmInfo, reason, status: botData.status });
        });
        
        // Handle errors - Also trigger automod on connection errors
        client.on('error', async (error) => {
            const errorMsg = (error?.message || String(error)).toLowerCase();
            console.error(`[Bot] ❌ Error:`, error?.message || error);
            
            // Clear spectator interval on error
            if (botData.spectatorInterval) {
                clearInterval(botData.spectatorInterval);
                botData.spectatorInterval = null;
            }
            
            // If we were connected and got an error, treat as crash
            if (botData.status === 'connected' && botData.lastPlayerJoined) {
                console.log(`[Bot] 🚨 ERROR WHILE CONNECTED - Triggering automod`);
                botData.status = 'realm_crashed';
                botData.disconnectReason = 'error';
                
                // Ban IMMEDIATELY
                await automodBanLastPlayer(botData, 'connection_error');
                
                botEvents.emit('realmCrashed', { discordUserId, realmInfo, reason: errorMsg, lastPlayer: botData.lastPlayerJoined });
            } else {
                botData.status = 'error';
                botData.disconnectReason = errorMsg;
            }
            
            botEvents.emit('error', { discordUserId, error, status: botData.status });
        });
        
        // Handle kick - Also trigger automod on crash-related kicks
        client.on('kick', async (reason) => {
            const kickMsg = (reason?.message || String(reason)).toLowerCase();
            console.log(`[Bot] 👢 Kicked from realm: ${reason?.message || reason}`);
            
            // Clear spectator interval on kick
            if (botData.spectatorInterval) {
                clearInterval(botData.spectatorInterval);
                botData.spectatorInterval = null;
            }
            
            // Store reason for close handler
            botData.disconnectReason = kickMsg;
            
            // Detect specific kick reasons
            if (kickMsg.includes('world closing') || kickMsg.includes('server closing') || kickMsg.includes('shutdown')) {
                botData.status = 'realm_closed';
                console.log(`[Bot] Realm ${realmInfo.name} is CLOSING`);
                botEvents.emit('realmClosed', { discordUserId, realmInfo, reason: kickMsg });
            } else if (kickMsg.includes('internal error') || kickMsg.includes('crash') || kickMsg.includes('exception')) {
                botData.status = 'realm_crashed';
                console.log(`[Bot] Realm ${realmInfo.name} CRASHED`);
                
                // Auto-ban last player who joined
                await automodBanLastPlayer(botData, 'kick_crash');
                
                botEvents.emit('realmCrashed', { discordUserId, realmInfo, reason: kickMsg, lastPlayer: botData.lastPlayerJoined });
            } else {
                botData.status = 'kicked';
            }
            
            botEvents.emit('kicked', { discordUserId, reason: reason?.message || reason, status: botData.status });
        });
        
        // Handle disconnect packet (server-initiated disconnection with reason)
        client.on('disconnect', (packet) => {
            const disconnectReason = (packet?.message || packet?.reason || 'unknown').toLowerCase();
            console.log(`[Bot] Received disconnect packet: ${disconnectReason}`);
            
            // Store reason for close handler
            botData.disconnectReason = disconnectReason;
            
            // Parse disconnect reasons to detect realm state
            if (disconnectReason.includes('world closed') || disconnectReason.includes('server closed') ||
                disconnectReason.includes('not accepting') || disconnectReason.includes('offline')) {
                console.log(`[Bot] Realm ${realmInfo.name} is CLOSED (disconnect packet)`);
                botEvents.emit('realmClosed', { discordUserId, realmInfo, reason: disconnectReason });
            } else if (disconnectReason.includes('crash') || disconnectReason.includes('internal') ||
                       disconnectReason.includes('exception') || disconnectReason.includes('server error')) {
                console.log(`[Bot] Realm ${realmInfo.name} CRASHED (disconnect packet)`);
                botEvents.emit('realmCrashed', { discordUserId, realmInfo, reason: disconnectReason });
            }
        });
        
        activeBots.set(discordUserId, botData);
        
        return botData;
        
    } catch (error) {
        console.error(`[Bot] Failed to connect:`, error);
        throw error;
    }
}

/**
 * Disconnect a bot from a realm
 * @param {string} discordUserId - Discord user ID
 * @returns {boolean} Whether disconnection was successful
 */
export function disconnectFromRealm(discordUserId) {
    // Clear any pending reconnection timer
    const reconnectTimer = reconnectTimers.get(discordUserId);
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimers.delete(discordUserId);
    }
    
    const botData = activeBots.get(discordUserId);
    
    if (botData) {
        console.log(`[Bot] Disconnecting from realm for user ${discordUserId}`);
        
        // Clear spectator interval
        if (botData.spectatorInterval) {
            clearInterval(botData.spectatorInterval);
            botData.spectatorInterval = null;
        }
        
        // Disconnect client
        if (botData.client) {
            try {
                botData.client.disconnect();
            } catch (error) {
                console.log(`[Bot] Error during disconnect:`, error?.message || error);
            }
        }
        
        activeBots.delete(discordUserId);
        return true;
    }
    
    return false;
}

/**
 * Get bot status for a user
 * @param {string} discordUserId - Discord user ID
 * @returns {object|null} Bot status
 */
export function getBotStatus(discordUserId) {
    const botData = activeBots.get(discordUserId);
    
    if (!botData) {
        return null;
    }
    
    return {
        status: botData.status,
        realmName: botData.realmInfo?.name,
        realmId: botData.realmInfo?.id,
        connectedAt: botData.connectedAt,
        players: botData.players,
        isConnected: botData.status === 'connected',
        packetStats: botData.packetStats || { received: 0, sent: 0 }
    };
}

/**
 * Send a chat message to the realm
 * @param {string} discordUserId - Discord user ID
 * @param {string} message - Message to send
 */
export function sendChatMessage(discordUserId, message) {
    const botData = activeBots.get(discordUserId);
    
    if (!botData || !botData.client || botData.status !== 'connected') {
        return false;
    }
    
    botData.client.queue('text', {
        type: 'chat',
        needs_translation: false,
        source_name: '',
        message: message,
        xuid: '',
        platform_chat_id: ''
    });
    
    return true;
}

/**
 * Run a command on the realm (requires operator)
 * @param {string} discordUserId - Discord user ID
 * @param {string} command - Command to run (without /)
 */
export function runCommand(discordUserId, command) {
    const botData = activeBots.get(discordUserId);
    
    if (!botData || !botData.client || botData.status !== 'connected') {
        return false;
    }
    
    botData.client.queue('command_request', {
        command: command,
        origin: {
            type: 'player',
            uuid: '',
            request_id: ''
        },
        internal: false,
        version: 52
    });
    
    return true;
}

/**
 * Get all active bots
 * @returns {Map} Active bots map
 */
export function getActiveBots() {
    return activeBots;
}
