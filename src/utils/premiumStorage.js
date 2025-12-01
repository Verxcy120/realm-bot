import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PREMIUM_FILE = path.join(__dirname, '../../data/premium.json');

// Ensure data directory exists
const dataDir = path.dirname(PREMIUM_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Load premium data from file
 * @returns {object} Premium data
 */
function loadPremiumData() {
    try {
        if (fs.existsSync(PREMIUM_FILE)) {
            return JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error('[Premium] Error loading premium data:', error);
    }
    return { guilds: {}, codes: {} };
}

/**
 * Save premium data to file
 * @param {object} data - Premium data
 */
function savePremiumData(data) {
    try {
        fs.writeFileSync(PREMIUM_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[Premium] Error saving premium data:', error);
    }
}

/**
 * Generate a random premium code
 * @returns {string} Generated code
 */
export function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Create a new premium code
 * @param {number} days - Number of days the code grants
 * @param {string} createdBy - Discord ID of creator
 * @returns {string} The generated code
 */
export function createPremiumCode(days, createdBy) {
    const data = loadPremiumData();
    const code = generateCode();
    
    data.codes[code] = {
        days,
        createdBy,
        createdAt: new Date().toISOString(),
        redeemed: false,
        redeemedBy: null,
        redeemedAt: null
    };
    
    savePremiumData(data);
    return code;
}

/**
 * Redeem a premium code for a guild
 * @param {string} code - The code to redeem
 * @param {string} guildId - The guild ID to apply premium to
 * @param {string} redeemedBy - Discord ID of user redeeming
 * @returns {object} Result { success, message, daysAdded, expiresAt }
 */
export function redeemCode(code, guildId, redeemedBy) {
    const data = loadPremiumData();
    
    // Check if code exists
    if (!data.codes[code]) {
        return { success: false, message: 'Invalid code. Please check and try again.' };
    }
    
    // Check if code already redeemed
    if (data.codes[code].redeemed) {
        return { success: false, message: 'This code has already been redeemed.' };
    }
    
    const codeData = data.codes[code];
    const daysToAdd = codeData.days;
    
    // Get current premium status for guild
    const currentPremium = data.guilds[guildId];
    let newExpiry;
    
    if (currentPremium && new Date(currentPremium.expiresAt) > new Date()) {
        // Extend existing premium
        newExpiry = new Date(currentPremium.expiresAt);
        newExpiry.setDate(newExpiry.getDate() + daysToAdd);
    } else {
        // New premium subscription
        newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + daysToAdd);
    }
    
    // Update guild premium status
    data.guilds[guildId] = {
        expiresAt: newExpiry.toISOString(),
        lastRedeemedBy: redeemedBy,
        lastRedeemedAt: new Date().toISOString()
    };
    
    // Mark code as redeemed
    data.codes[code].redeemed = true;
    data.codes[code].redeemedBy = redeemedBy;
    data.codes[code].redeemedAt = new Date().toISOString();
    data.codes[code].redeemedForGuild = guildId;
    
    savePremiumData(data);
    
    return {
        success: true,
        message: 'Premium activated successfully!',
        daysAdded: daysToAdd,
        expiresAt: newExpiry
    };
}

/**
 * Check if a guild has active premium
 * @param {string} guildId - The guild ID to check
 * @returns {object} { isPremium, expiresAt, daysRemaining }
 */
export function checkPremium(guildId) {
    const data = loadPremiumData();
    const guildPremium = data.guilds[guildId];
    
    if (!guildPremium) {
        return { isPremium: false, expiresAt: null, daysRemaining: 0 };
    }
    
    const expiresAt = new Date(guildPremium.expiresAt);
    const now = new Date();
    
    if (expiresAt <= now) {
        return { isPremium: false, expiresAt: null, daysRemaining: 0 };
    }
    
    const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    
    return {
        isPremium: true,
        expiresAt,
        daysRemaining
    };
}

/**
 * Get all codes (for admin viewing)
 * @returns {object} All codes data
 */
export function getAllCodes() {
    const data = loadPremiumData();
    return data.codes;
}

/**
 * Get all premium guilds (for admin viewing)
 * @returns {object} All guild premium data
 */
export function getAllPremiumGuilds() {
    const data = loadPremiumData();
    return data.guilds;
}
