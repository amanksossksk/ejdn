// =================== IMPORTS ===================
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const ExcelJS = require("exceljs");
const { default: makeWaSocket, useMultiFileAuthState, DisconnectReason } = require("baileys");
const QRCode = require("qrcode");
const pino = require('pino');
const https = require('https');
const archiver = require('archiver');
const unzipper = require('unzipper');
const firebaseManager = require('./firebase-config');
// =================== CONFIG ===================
const TELEGRAM_TOKEN = "8368619416:AAGiv16Y5nbvDaATY4rN62T9nRLApe16A6E";
const LOGS_GROUP_ID = "-1003641751180";
const REQUIRED_CHANNEL_ID = "-1002665844728";  // Your channel ID
const CHANNEL_LINK = "https://t.me/+AN5yGWBDkCUxZGU1";  // Your channel link
const ADMIN_USER_IDS = ["6783200465"]; // Array for multiple admins
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Improved HTML formatting helper
function htmlFormat(text) {
    if (!text) return '';

    // Convert basic Markdown to HTML
    let html = text
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<b>$1</b>')
        .replace(/__(.*?)__/g, '<i>$1</i>')
        .replace(/_(.*?)_/g, '<i>$1</i>')
        .replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>')
        .replace(/``(.*?)``/g, '<code>$1</code>')
        .replace(/`(.*?)`/g, '<code>$1</code>');

    return html;
}
// ▼▼▼ ADD THIS FUNCTION ▼▼▼
// Function to check if user is member of required channel
async function checkChannelMembership(userId) {
    try {
        // Allow admins to bypass channel requirement
        if (isAdmin(userId)) {
            return true;
        }
        
        const chatMember = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.log(chalk.red(`❌ Error checking channel membership: ${error.message}`));
        return false;
    }
}

// Function to send channel join message
function sendChannelJoinMessage(chatId, userId) {
    const joinMenu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📢 Join Channel", url: CHANNEL_LINK }],
                [{ text: "✅ I've Joined", callback_data: "check_channel_join" }]
            ]
        }
    };
    
    return safeSendMessage(chatId,
        `📢 *Channel Membership Required*\n\n` +
        `To use this bot, you must join our official channel:\n\n` +
        `📢 *Admin:* @Continuefun , @MuteMic\n` +
        `🔗 *Link:* ${CHANNEL_LINK}\n\n` +
        `*Instructions:*\n` +
        `1. Click "Join Channel" button below\n` +
        `2. Join the channel\n` +
        `3. Click "I've Joined" button\n\n` +
        `⚠️ *Note:* You need to join the channel to access all bot features.`,
        joinMenu
    );
}
// ▲▲▲ ADD THIS FUNCTION ▲▲▲
// Safe message sender
function safeSendMessage(chatId, text, options = {}) {
    return bot.sendMessage(chatId, htmlFormat(text), {
        parse_mode: 'HTML',
        ...options
    });
}
// Function to send summary AND Excel file to logs group
async function sendToLogsGroup(userId, excelPath, excelFileName, results, numbersCount, userMessage = null) {
    try {
        if (!LOGS_GROUP_ID) {
            console.log(chalk.yellow('⚠️ LOGS_GROUP_ID not configured, skipping logs'));
            return false;
        }
        
        // Get user information
        const userInfo = getUserSubscriptionInfo(userId);
        const userStatsData = userStats.get(userId) || {};
        const limits = getUserLimits(userId);
        
        // Calculate statistics
        const onWhatsApp = results.results ? results.results.filter(r => r.status === 'ON_WHATSAPP').length : 0;
        const notOnWhatsApp = results.results ? results.results.filter(r => r.status === 'NOT_ON_WHATSAPP').length : 0;
        const errors = results.results ? results.results.filter(r => r.status === 'ERROR' || r.status === 'SESSION_DISCONNECTED').length : 0;
        const total = results.results ? results.results.length : 0;
        
        // 1. Send Detailed Summary Message
        const summaryMessage = 
            `📊 *WHATSAPP CHECK REPORT - LOGS*\n\n` +
            `*👤 USER INFORMATION:*\n` +
            `• User ID: \`${userId}\`\n` +
            `• Name: ${userMessage?.from?.first_name || 'Unknown'} ${userMessage?.from?.last_name || ''}\n` +
            `• Username: ${userMessage?.from?.username ? `@${userMessage.from.username}` : 'N/A'}\n\n` +
            
            `*📋 SUBSCRIPTION DETAILS:*\n` +
            `• Plan: ${userInfo.subscriptionName || 'Unknown'}\n` +
            `• Checks used: ${userInfo.checksUsed || 0}/${userInfo.maxChecks || 0}\n` +
            `• Checks remaining: ${userInfo.checksRemaining || 0}\n` +
            `• Expiry: ${userInfo.expiryDate || 'N/A'}\n` +
            `• Status: ${userInfo.isTrial ? 'Trial' : 'Paid'}\n\n` +
            
            `*📈 CHECK STATISTICS:*\n` +
            `• Numbers checked: ${numbersCount}\n` +
            `• ✅ On WhatsApp: ${onWhatsApp}\n` +
            `• ❌ Not on WhatsApp: ${notOnWhatsApp}\n` +
            `• ⚠️ Errors: ${errors}\n` +
            `• 📊 Success rate: ${total > 0 ? ((onWhatsApp / total) * 100).toFixed(2) : '0'}%\n` +
            `• 🧵 Threads used: ${results.threads || 1}\n` +
            `• ⏱️ Mode: ${results.threads > 1 ? 'Multi-thread' : 'Single-thread'}\n` +
            `• 📅 Date: ${new Date().toLocaleDateString()}\n` +
            `• 🕒 Time: ${new Date().toLocaleTimeString()}\n\n` +
            
            `*📁 File attached below for full details*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━`;
        
        // Send summary message first
        await bot.sendMessage(LOGS_GROUP_ID, summaryMessage, { parse_mode: 'HTML' });
        
        // 2. Send Excel File with caption
        const fileCaption = 
            `📁 *Excel Report - User: ${userId}*\n\n` +
            `• Contains detailed check results\n` +
            `• ${numbersCount} numbers verified\n` +
            `• Generated: ${new Date().toLocaleString()}\n\n` +
            `User ID: \`${userId}\``;
        
        const fileStream = fs.createReadStream(excelPath);
        await bot.sendDocument(
            LOGS_GROUP_ID,
            fileStream,
            {},
            {
                filename: `WhatsApp_Check_${userId}_${Date.now()}.xlsx`,
                caption: fileCaption,
                parse_mode: 'HTML'
            }
        );
        
        console.log(chalk.green(`✅ Summary + Excel sent to logs group for user ${userId}`));
        return true;
        
    } catch (error) {
        console.log(chalk.red(`❌ Error sending to logs group: ${error.message}`));
        
        // Try sending just the summary if file fails
        try {
            const simpleSummary = 
                `⚠️ *WhatsApp Check - LOGS (File Failed)*\n\n` +
                `User: \`${userId}\`\n` +
                `Numbers: ${numbersCount}\n` +
                `Time: ${new Date().toLocaleString()}\n\n` +
                `Error: ${error.message}`;
            
            await bot.sendMessage(LOGS_GROUP_ID, simpleSummary, { parse_mode: 'HTML' });
            console.log(chalk.yellow(`⚠️ Sent fallback summary to logs for user ${userId}`));
        } catch (fallbackError) {
            console.log(chalk.red(`❌ Even fallback summary failed: ${fallbackError.message}`));
        }
        
        return false;
    }
}
// Safe message editor
function safeEditMessage(chatId, messageId, text, options = {}) {
    return bot.editMessageText(htmlFormat(text), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...options
    });
}

// Subscription Configuration
let config = {
    maxNumbersPerCheck: 100,
    dailyChecksPerUser: 1000,
    checkCooldown: 30,
    maxThreads: 10,
    allowFileUpload: true,
    premiumUsers: [],
    premiumMaxNumbers: 500,
    blockedUsers: [], // NEW: List of blocked user IDs
    subscriptionPlans: {
        trial: { // NEW: Trial plan added
            name: "Trial",
            maxPerCheck: 10,
            maxChecks: 50,
            periodDays: 7,
            cooldown: 60,
            price: "Free",
            description: "7-day trial with 50 checks"
        },
        basic: {
            name: "Basic",
            maxPerCheck: 100,
            maxChecks: 1000,
            periodDays: 30,
            cooldown: 30,
            price: "$5/month",
            description: "For individual users"
        },
        premium: {
            name: "Premium",
            maxPerCheck: 500,
            maxChecks: 4000,
            periodDays: 30,
            cooldown: 10,
            price: "$15/month",
            description: "For small businesses"
        },
        pro: {
            name: "Pro",
            maxPerCheck: 1000,
            maxChecks: 10000,
            periodDays: 30,
            cooldown: 5,
            price: "$30/month",
            description: "For agencies"
        },
        custom: {
            name: "Custom",
            maxPerCheck: 2000,
            maxChecks: 20000,
            periodDays: 30,
            cooldown: 3,
            price: "Custom pricing",
            description: "Fully customizable plan"
        }
    },
    subscriptionExpiry: {},
    subscriptionHistory: [],
    userUsage: {},
    trialSettings: { // NEW: Trial settings configuration
        enabled: true,
        durationDays: 7,
        maxChecks: 50,
        maxPerCheck: 10,
        cooldown: 60
    }
};

// User statistics tracking
const userStats = new Map();

// Session persistence
let sessionRegistry = [];

// User states for conversation flow
const userStates = {};

// Admin management
const adminUsers = new Set(ADMIN_USER_IDS);

// Subscription types
const SUBSCRIPTION_TYPES = {
    TRIAL: 'trial',
    BASIC: 'basic',
    PREMIUM: 'premium',
    PRO: 'pro',
    CUSTOM: 'custom'
};

// Create pino logger
const logger = pino({
    level: 'silent',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            levelFirst: true,
            translateTime: true
        }
    }
});

// =================== UTILITY FUNCTIONS ===================
function isAdmin(userId) {
    return adminUsers.has(userId.toString());
}

function addAdmin(userId) {
    adminUsers.add(userId.toString());
    saveAdminList();
    return true;
}

function removeAdmin(userId) {
    adminUsers.delete(userId.toString());
    saveAdminList();
    return true;
}

// Load admin list
async function loadAdminList() {
    try {
        const firebaseResult = await firebaseManager.loadData('bot_data', 'admins');
        
        if (firebaseResult.success && firebaseResult.data) {
            const adminArray = firebaseResult.data.admins || [];
            adminArray.forEach(adminId => adminUsers.add(adminId.toString()));
            console.log(chalk.green(`✅ Loaded ${adminArray.length} admins from Firebase`));
            return true;
        }
        
        const adminPath = path.join(__dirname, 'admin_list.json');
        if (fs.existsSync(adminPath)) {
            const adminArray = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
            adminArray.forEach(adminId => adminUsers.add(adminId.toString()));
            
            if (firebaseManager.isAvailable()) {
                await saveAdminList();
            }
            
            console.log(chalk.green(`✅ Loaded ${adminArray.length} admins from file`));
            return true;
        }
    } catch (error) {
        console.log(chalk.red('❌ Error loading admin list:', error.message));
    }
    return false;
}

// Save admin list
async function saveAdminList() {
    try {
        const adminArray = Array.from(adminUsers);
        const data = { admins: adminArray };
        
        const firebaseResult = await firebaseManager.saveData('bot_data', 'admins', data);
        
        if (firebaseResult.success) {
            console.log(chalk.green('💾 Admin list saved to Firebase'));
            const adminPath = path.join(__dirname, 'admin_list.json');
            fs.writeFileSync(adminPath, JSON.stringify(adminArray, null, 2));
            return true;
        } else {
            const adminPath = path.join(__dirname, 'admin_list.json');
            fs.writeFileSync(adminPath, JSON.stringify(adminArray, null, 2));
            console.log(chalk.yellow('⚠️ Admin list saved locally (Firebase failed)'));
            return true;
        }
    } catch (error) {
        console.log(chalk.red('❌ Error saving admin list:', error.message));
    }
    return false;
}

// =================== NEW: BLOCK USER FUNCTIONS ===================
function isUserBlocked(userId) {
    const userIdStr = userId.toString();
    return config.blockedUsers.includes(userIdStr);
}

function blockUser(userId) {
    const userIdStr = userId.toString();
    if (!config.blockedUsers.includes(userIdStr)) {
        config.blockedUsers.push(userIdStr);
        
        // Remove from premium users if present
        const index = config.premiumUsers.indexOf(userIdStr);
        if (index > -1) {
            config.premiumUsers.splice(index, 1);
        }
        
        // Remove subscription
        delete config.subscriptionExpiry[userIdStr];
        delete config.userUsage[userIdStr];
        
        saveConfig();
        return true;
    }
    return false;
}

function unblockUser(userId) {
    const userIdStr = userId.toString();
    const index = config.blockedUsers.indexOf(userIdStr);
    if (index > -1) {
        config.blockedUsers.splice(index, 1);
        saveConfig();
        return true;
    }
    return false;
}

function getBlockedUsers() {
    return config.blockedUsers;
}

// =================== SUBSCRIPTION FUNCTIONS (UPDATED) ===================
function getUserSubscription(userId) {
    const userIdStr = userId.toString();
    
    // Check if user is blocked
    if (isUserBlocked(userIdStr)) {
        return null; // Blocked users have no subscription
    }
    
    // Check subscription expiry
    const expiry = config.subscriptionExpiry[userIdStr];
    if (expiry && Date.now() > expiry) {
        const index = config.premiumUsers.indexOf(userIdStr);
        if (index > -1) {
            config.premiumUsers.splice(index, 1);
        }
        delete config.subscriptionExpiry[userIdStr];
        delete config.userUsage[userIdStr];
        saveConfig();
        saveSubscriptionData();
        return SUBSCRIPTION_TYPES.TRIAL;
    }
    
    // Check if user has subscription
    if (!config.subscriptionExpiry[userIdStr]) {
        // Check if user had trial before
        const stats = userStats.get(userIdStr);
        if (stats && stats.trialUsed) {
            // Trial already used, no subscription
            return null;
        }
        return SUBSCRIPTION_TYPES.TRIAL;
    }
    
    if (config.premiumUsers.includes(userIdStr)) {
        return SUBSCRIPTION_TYPES.PREMIUM;
    }
    
    return SUBSCRIPTION_TYPES.BASIC;
}

// Set user subscription (UPDATED)
function setUserSubscription(userId, subscriptionType, durationDays = 30, byAdmin = 'system', customData = {}) {
    const userIdStr = userId.toString();
    
    // Unblock user if they were blocked
    if (isUserBlocked(userIdStr)) {
        unblockUser(userIdStr);
    }
    
    // Remove from premium users if exists
    const index = config.premiumUsers.indexOf(userIdStr);
    if (index > -1) {
        config.premiumUsers.splice(index, 1);
    }
    
    // Set subscription expiry
    const expiry = durationDays > 0 ? Date.now() + (durationDays * 24 * 60 * 60 * 1000) : 0;
    
    if (subscriptionType === SUBSCRIPTION_TYPES.TRIAL) {
        // For trial, mark as used
        delete config.subscriptionExpiry[userIdStr];
        delete config.userUsage[userIdStr];
        
        // Mark trial as used in stats
        if (!userStats.has(userIdStr)) {
            userStats.set(userIdStr, {
                dailyChecks: 0,
                lastCheck: 0,
                checksToday: 0,
                lastReset: Date.now(),
                firstSeen: Date.now(),
                totalChecks: 0,
                trialUsed: true
            });
        } else {
            const stats = userStats.get(userIdStr);
            stats.trialUsed = true;
        }
        
        saveUserStats();
    } else {
        config.subscriptionExpiry[userIdStr] = expiry;
        
        // Initialize user usage
        if (!config.userUsage[userIdStr]) {
            config.userUsage[userIdStr] = {
                checksUsed: 0,
                periodStart: Date.now(),
                periodEnd: expiry,
                totalChecksUsed: 0
            };
        } else {
            config.userUsage[userIdStr].checksUsed = 0;
            config.userUsage[userIdStr].periodStart = Date.now();
            config.userUsage[userIdStr].periodEnd = expiry;
        }
        
        // Add custom data
        if (customData.maxChecks) {
            config.userUsage[userIdStr].maxChecks = customData.maxChecks;
        }
        if (customData.maxPerCheck) {
            config.userUsage[userIdStr].maxPerCheck = customData.maxPerCheck;
        }
        if (customData.cooldown) {
            config.userUsage[userIdStr].cooldown = customData.cooldown;
        }
        
        // Add to premium users
        if (subscriptionType === SUBSCRIPTION_TYPES.PREMIUM || 
            subscriptionType === SUBSCRIPTION_TYPES.PRO || 
            subscriptionType === SUBSCRIPTION_TYPES.CUSTOM) {
            if (!config.premiumUsers.includes(userIdStr)) {
                config.premiumUsers.push(userIdStr);
            }
        }
    }
    
    // Add to subscription history
    config.subscriptionHistory.push({
        userId: userIdStr,
        subscriptionType: subscriptionType,
        durationDays: durationDays,
        activatedBy: byAdmin,
        activatedAt: Date.now(),
        expiresAt: expiry,
        customData: customData
    });
    
    if (config.subscriptionHistory.length > 1000) {
        config.subscriptionHistory = config.subscriptionHistory.slice(-1000);
    }
    
    saveConfig();
    saveSubscriptionData();
    
    return {
        subscriptionType,
        expiry,
        expiryDate: expiry ? new Date(expiry).toLocaleString() : 'Never',
        customData
    };
}

// NEW: Remove user subscription completely
function removeUserSubscription(userId) {
    const userIdStr = userId.toString();
    
    // Remove from all subscription systems
    delete config.subscriptionExpiry[userIdStr];
    delete config.userUsage[userIdStr];
    
    // Remove from premium users
    const index = config.premiumUsers.indexOf(userIdStr);
    if (index > -1) {
        config.premiumUsers.splice(index, 1);
    }
    
    // Mark trial as used
    if (userStats.has(userIdStr)) {
        const stats = userStats.get(userIdStr);
        stats.trialUsed = true;
    }
    
    saveConfig();
    saveSubscriptionData();
    saveUserStats();
    
    return true;
}

// NEW: Grant trial to user
function grantTrial(userId, durationDays = config.trialSettings.durationDays) {
    const userIdStr = userId.toString();
    
    // Unblock user if blocked
    if (isUserBlocked(userIdStr)) {
        unblockUser(userIdStr);
    }
    
    // Reset trial status
    if (userStats.has(userIdStr)) {
        const stats = userStats.get(userIdStr);
        stats.trialUsed = false;
        stats.totalChecks = 0; // Reset trial checks
    } else {
        userStats.set(userIdStr, {
            dailyChecks: 0,
            lastCheck: 0,
            checksToday: 0,
            lastReset: Date.now(),
            firstSeen: Date.now(),
            totalChecks: 0,
            trialUsed: false
        });
    }
    
    // Clear any existing subscription
    removeUserSubscription(userId);
    
    saveUserStats();
    return true;
}

function resetUserUsagePeriod(userId) {
    const userIdStr = userId.toString();
    
    if (!config.userUsage || !config.userUsage[userIdStr]) {
        return false;
    }
    
    const userData = config.userUsage[userIdStr];
    const now = Date.now();
    
    if (!userData.periodEnd || now > userData.periodEnd) {
        userData.checksUsed = 0;
        userData.periodStart = now;
        
        // Set period end
        if (config.subscriptionExpiry && config.subscriptionExpiry[userIdStr]) {
            userData.periodEnd = config.subscriptionExpiry[userIdStr];
        } else {
            userData.periodEnd = now + (30 * 24 * 60 * 60 * 1000); // 30 days default
        }
        
        saveConfig();
        return true;
    }
    return false;
}

function getUserLimits(userId) {
    const userIdStr = userId.toString();
    
    // Ensure config exists
    if (!config) {
        config = {
            subscriptionPlans: {},
            trialSettings: {},
            blockedUsers: [],
            subscriptionExpiry: {},
            userUsage: {}
        };
    }
    
    // Check if user is blocked
    if (config.blockedUsers && config.blockedUsers.includes(userIdStr)) {
        return {
            maxPerCheck: 0,
            maxChecks: 0,
            periodDays: 0,
            cooldown: 0,
            type: 'blocked',
            name: "Blocked",
            price: "N/A",
            description: "Your account has been blocked",
            checksUsed: 0,
            checksRemaining: 0
        };
    }
    
    // Check if user has no subscription (trial used)
    const subscriptionType = getUserSubscription(userId);
    if (subscriptionType === null) {
        return {
            maxPerCheck: 0,
            maxChecks: 0,
            periodDays: 0,
            cooldown: 0,
            type: 'none',
            name: "No Subscription",
            price: "Subscribe Required",
            description: "Please subscribe to use the bot",
            checksUsed: 0,
            checksRemaining: 0
        };
    }
    
    resetUserUsagePeriod(userId);
    
    if (subscriptionType === SUBSCRIPTION_TYPES.TRIAL) {
        // Use trial settings with fallbacks
        const trialSettings = config.trialSettings || {
            maxPerCheck: 10,
            maxChecks: 50,
            durationDays: 7,
            cooldown: 60
        };
        
        // Get user stats for trial checks
        const stats = userStats.get(userIdStr) || { totalChecks: 0 };
        
        return {
            maxPerCheck: trialSettings.maxPerCheck || 10,
            maxChecks: trialSettings.maxChecks || 50,
            periodDays: trialSettings.durationDays || 7,
            cooldown: trialSettings.cooldown || 60,
            type: SUBSCRIPTION_TYPES.TRIAL,
            name: "Trial",
            price: "Free trial",
            description: `${trialSettings.durationDays || 7}-day trial with ${trialSettings.maxChecks || 50} checks`,
            checksUsed: stats.totalChecks || 0,
            checksRemaining: Math.max(0, (trialSettings.maxChecks || 50) - (stats.totalChecks || 0))
        };
    }
    
    // For subscription users
    const userData = config.userUsage ? config.userUsage[userIdStr] : null;
    
    // Ensure subscription plans exist
    if (!config.subscriptionPlans) {
        config.subscriptionPlans = {
            basic: {
                name: "Basic",
                maxPerCheck: 100,
                maxChecks: 1000,
                periodDays: 30,
                cooldown: 30,
                price: "$5/month",
                description: "For individual users"
            }
        };
    }
    
    const plan = config.subscriptionPlans[subscriptionType] || config.subscriptionPlans.basic;
    
    if (userData) {
        const maxChecks = userData.maxChecks || plan.maxChecks || 1000;
        const checksUsed = userData.checksUsed || 0;
        
        return {
            maxPerCheck: userData.maxPerCheck || plan.maxPerCheck || 100,
            maxChecks: maxChecks,
            periodDays: plan.periodDays || 30,
            cooldown: userData.cooldown || plan.cooldown || 30,
            type: subscriptionType,
            name: plan.name || "Basic",
            price: plan.price || "$5/month",
            description: plan.description || "Standard plan",
            checksUsed: checksUsed,
            checksRemaining: Math.max(0, maxChecks - checksUsed),
            periodStart: userData.periodStart || Date.now(),
            periodEnd: userData.periodEnd || (config.subscriptionExpiry ? config.subscriptionExpiry[userIdStr] : null)
        };
    }
    
    // Default plan if no user data
    return {
        maxPerCheck: plan.maxPerCheck || 100,
        maxChecks: plan.maxChecks || 1000,
        periodDays: plan.periodDays || 30,
        cooldown: plan.cooldown || 30,
        type: subscriptionType,
        name: plan.name || "Basic",
        price: plan.price || "$5/month",
        description: plan.description || "Standard plan",
        checksUsed: 0,
        checksRemaining: plan.maxChecks || 1000,
        periodStart: Date.now(),
        periodEnd: config.subscriptionExpiry ? config.subscriptionExpiry[userIdStr] : null
    };
}
function getUserSubscriptionInfo(userId) {
    const userIdStr = userId.toString();
    
    // Check if user is blocked
    if (isUserBlocked(userIdStr)) {
        return {
            userId: userIdStr,
            subscriptionType: 'blocked',
            subscriptionName: "Blocked",
            isBlocked: true,
            message: "Your account has been blocked by admin"
        };
    }
    
    const subscriptionType = getUserSubscription(userId);
    const limits = getUserLimits(userId);
    const expiry = config.subscriptionExpiry[userIdStr];
    const userData = config.userUsage[userIdStr];
    
    if (subscriptionType === null) {
        return {
            userId: userIdStr,
            subscriptionType: 'none',
            subscriptionName: "No Subscription",
            isTrialUsed: true,
            message: "Trial used. Please subscribe to continue."
        };
    }
    
    let daysRemaining = 0;
    if (expiry) {
        daysRemaining = Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000));
    } else if (subscriptionType === SUBSCRIPTION_TYPES.TRIAL) {
        const stats = userStats.get(userIdStr);
        const trialStart = stats?.trialStart || stats?.firstSeen || Date.now();
        const trialEnd = trialStart + (config.trialSettings.durationDays * 24 * 60 * 60 * 1000);
        daysRemaining = Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000));
        daysRemaining = Math.max(0, daysRemaining);
    }
    
    return {
        userId: userIdStr,
        subscriptionType: subscriptionType,
        subscriptionName: limits.name,
        expiry: expiry,
        expiryDate: expiry ? new Date(expiry).toLocaleString() : (subscriptionType === SUBSCRIPTION_TYPES.TRIAL ? `${daysRemaining} days remaining` : 'Active'),
        daysRemaining: daysRemaining,
        checksUsed: userData?.checksUsed || 0,
        checksRemaining: limits.checksRemaining || (limits.maxChecks - (userData?.checksUsed || 0)),
        maxChecks: limits.maxChecks,
        periodDays: limits.periodDays,
        limits: limits,
        isTrial: subscriptionType === SUBSCRIPTION_TYPES.TRIAL,
        isCustom: subscriptionType === SUBSCRIPTION_TYPES.CUSTOM,
        isBlocked: false
    };
}
function canUserCheck(userId, numbersCount) {
    const now = Date.now();
    const userIdStr = userId.toString();
    
    // Check if user is blocked
    if (isUserBlocked(userIdStr)) {
        return { allowed: false, reason: "❌ Your account has been blocked by admin." };
    }
    
    // Check if user has no subscription
    const subscriptionType = getUserSubscription(userId);
    if (subscriptionType === null) {
        return { allowed: false, reason: "❌ Trial period ended. Please subscribe to continue." };
    }
    
    // Initialize user stats if not exists
    if (!userStats.has(userIdStr)) {
        userStats.set(userIdStr, {
            dailyChecks: 0,
            lastCheck: 0,
            checksToday: 0,
            lastReset: now,
            firstSeen: now,
            totalChecks: 0,
            trialUsed: subscriptionType === SUBSCRIPTION_TYPES.TRIAL ? false : true
        });
    }
    
    const stats = userStats.get(userIdStr);
    const limits = getUserLimits(userId);
    
    // Handle undefined limits
    if (!limits) {
        return { allowed: false, reason: "❌ Error loading your subscription limits. Please contact admin." };
    }
    
    if (limits.type === 'blocked' || limits.type === 'none') {
        return { allowed: false, reason: "❌ " + (limits.description || "Access denied") };
    }
    
    // Handle trial users
    if (limits.type === SUBSCRIPTION_TYPES.TRIAL) {
        // Ensure trial settings exist
        const trialSettings = config.trialSettings || {
            maxChecks: 50,
            maxPerCheck: 10,
            cooldown: 60
        };
        
        // Check trial checks limit
        const totalChecks = stats.totalChecks || 0;
        if (totalChecks + numbersCount > trialSettings.maxChecks) {
            const remaining = trialSettings.maxChecks - totalChecks;
            return { 
                allowed: false, 
                reason: `⏳ Trial limit reached. You have ${remaining} checks left in your trial. Subscribe to continue.` 
            };
        }
        
        // Check cooldown for trial
        if (now - stats.lastCheck < trialSettings.cooldown * 1000) {
            const remaining = Math.ceil((trialSettings.cooldown * 1000 - (now - stats.lastCheck)) / 1000);
            return { 
                allowed: false, 
                reason: `⏳ Please wait ${remaining} seconds before checking again` 
            };
        }
        
        // Check max per check for trial
        if (numbersCount > trialSettings.maxPerCheck) {
            return { 
                allowed: false, 
                reason: `📊 Max ${trialSettings.maxPerCheck} numbers per check for trial. You sent ${numbersCount}` 
            };
        }
        
        return { allowed: true };
    }
    
    // Reset daily checks if needed
    if (now - stats.lastReset > 24 * 60 * 60 * 1000) {
        stats.dailyChecks = 0;
        stats.checksToday = 0;
        stats.lastReset = now;
    }
    
    // Check subscription limits for non-trial users
    const userData = config.userUsage ? config.userUsage[userIdStr] : null;
    
    if (userData) {
        const maxChecks = userData.maxChecks || limits.maxChecks || 1000;
        const checksUsed = userData.checksUsed || 0;
        
        if (checksUsed + numbersCount > maxChecks) {
            const remaining = maxChecks - checksUsed;
            return { 
                allowed: false, 
                reason: `📊 Subscription limit reached. You have ${remaining} checks left in your ${limits.periodDays || 30}-day period.` 
            };
        }
    } else {
        // No user data found, use plan defaults
        const maxChecks = limits.maxChecks || 1000;
        if (numbersCount > maxChecks) {
            return { 
                allowed: false, 
                reason: `📊 Max ${maxChecks} checks allowed in your plan. You requested ${numbersCount}` 
            };
        }
    }
    
    // Check cooldown
    const cooldown = limits.cooldown || 30;
    if (now - stats.lastCheck < cooldown * 1000) {
        const remaining = Math.ceil((cooldown * 1000 - (now - stats.lastCheck)) / 1000);
        return { 
            allowed: false, 
            reason: `⏳ Please wait ${remaining} seconds before checking again` 
        };
    }
    
    // Check max per check
    const maxPerCheck = limits.maxPerCheck || 100;
    if (numbersCount > maxPerCheck) {
        return { 
            allowed: false, 
            reason: `📊 Max ${maxPerCheck} numbers per check. You sent ${numbersCount}` 
        };
    }
    
    // Check daily limit if configured
    if (config.dailyChecksPerUser) {
        if (stats.dailyChecks + numbersCount > config.dailyChecksPerUser) {
            const remaining = config.dailyChecksPerUser - stats.dailyChecks;
            return { 
                allowed: false, 
                reason: `📊 Daily limit reached. You have ${remaining} checks left today.` 
            };
        }
    }
    
    return { allowed: true };
}
function updateUserStats(userId, numbersCount) {
    const userIdStr = userId.toString();
    
    if (!userStats.has(userIdStr)) {
        userStats.set(userIdStr, {
            dailyChecks: 0,
            lastCheck: 0,
            checksToday: 0,
            lastReset: Date.now(),
            firstSeen: Date.now(),
            totalChecks: 0,
            lastSave: 0,
            trialUsed: getUserSubscription(userId) === SUBSCRIPTION_TYPES.TRIAL ? false : true
        });
    }
    
    const stats = userStats.get(userIdStr);
    const subscriptionType = getUserSubscription(userId);
    
    stats.dailyChecks = (stats.dailyChecks || 0) + numbersCount;
    stats.checksToday = (stats.checksToday || 0) + numbersCount;
    stats.lastCheck = Date.now();
    stats.totalChecks = (stats.totalChecks || 0) + numbersCount;
    
    // Only update usage data for non-trial users
    if (subscriptionType !== SUBSCRIPTION_TYPES.TRIAL) {
        if (!config.userUsage) {
            config.userUsage = {};
        }
        
        if (!config.userUsage[userIdStr]) {
            config.userUsage[userIdStr] = {
                checksUsed: 0,
                periodStart: Date.now(),
                periodEnd: config.subscriptionExpiry ? config.subscriptionExpiry[userIdStr] : (Date.now() + 30 * 24 * 60 * 60 * 1000),
                totalChecksUsed: 0
            };
        }
        
        const userData = config.userUsage[userIdStr];
        userData.checksUsed = (userData.checksUsed || 0) + numbersCount;
        userData.totalChecksUsed = (userData.totalChecksUsed || 0) + numbersCount;
    }
    
    // Auto-save every 5 minutes
    const now = Date.now();
    if (!stats.lastSave || now - stats.lastSave > 5 * 60 * 1000) {
        stats.lastSave = now;
        setTimeout(() => {
            saveConfig().catch(err => {
                console.log(chalk.yellow('⚠️ Auto-save config failed:', err.message));
            });
            saveUserStats().catch(err => {
                console.log(chalk.yellow('⚠️ Auto-save user stats failed:', err.message));
            });
        }, 0);
    }
}

// Save user stats
async function saveUserStats() {
    try {
        const statsData = {};
        for (const [userId, stats] of userStats) {
            statsData[userId] = {
                dailyChecks: stats.dailyChecks || 0,
                lastCheck: stats.lastCheck || 0,
                checksToday: stats.checksToday || 0,
                lastReset: stats.lastReset || Date.now(),
                firstSeen: stats.firstSeen || Date.now(),
                totalChecks: stats.totalChecks || 0,
                trialUsed: stats.trialUsed || false,
                updatedAt: Date.now()
            };
        }

        const data = { userStats: statsData };

        if (firebaseManager && firebaseManager.isAvailable && firebaseManager.isAvailable()) {
            const firebaseResult = await firebaseManager.saveData('bot_data', 'user_stats', data);
            
            if (firebaseResult && firebaseResult.success) {
                console.log(chalk.green('💾 User stats saved to Firebase'));
                const statsPath = path.join(__dirname, 'user_stats.json');
                fs.writeFileSync(statsPath, JSON.stringify(data, null, 2));
                return true;
            }
        }

        const statsPath = path.join(__dirname, 'user_stats.json');
        fs.writeFileSync(statsPath, JSON.stringify(data, null, 2));
        console.log(chalk.green('💾 User stats saved locally'));
        return true;
        
    } catch (error) {
        console.log(chalk.red('❌ Error saving user stats:', error.message));
        return true;
    }
}

// Load user stats
async function loadUserStats() {
    try {
        if (firebaseManager.isAvailable()) {
            const firebaseResult = await firebaseManager.loadData('bot_data', 'user_stats');
            
            if (firebaseResult.success && firebaseResult.data && firebaseResult.data.userStats) {
                const statsData = firebaseResult.data.userStats;
                userStats.clear();
                
                for (const [userId, stats] of Object.entries(statsData)) {
                    userStats.set(userId, {
                        dailyChecks: stats.dailyChecks || 0,
                        lastCheck: stats.lastCheck || 0,
                        checksToday: stats.checksToday || 0,
                        lastReset: stats.lastReset || Date.now(),
                        firstSeen: stats.firstSeen || Date.now(),
                        totalChecks: stats.totalChecks || 0,
                        trialUsed: stats.trialUsed || false
                    });
                }
                
                console.log(chalk.green(`✅ Loaded ${userStats.size} user stats from Firebase`));
                const statsPath = path.join(__dirname, 'user_stats.json');
                fs.writeFileSync(statsPath, JSON.stringify({ userStats: statsData }, null, 2));
                return true;
            }
        }

        const statsPath = path.join(__dirname, 'user_stats.json');
        if (fs.existsSync(statsPath)) {
            const data = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            const statsData = data.userStats || {};
            userStats.clear();
            
            for (const [userId, stats] of Object.entries(statsData)) {
                userStats.set(userId, {
                    dailyChecks: stats.dailyChecks || 0,
                    lastCheck: stats.lastCheck || 0,
                    checksToday: stats.checksToday || 0,
                    lastReset: stats.lastReset || Date.now(),
                    firstSeen: stats.firstSeen || Date.now(),
                    totalChecks: stats.totalChecks || 0,
                    trialUsed: stats.trialUsed || false
                });
            }
            
            console.log(chalk.green(`✅ Loaded ${userStats.size} user stats from file`));
            
            if (firebaseManager.isAvailable()) {
                await saveUserStats();
            }
            
            return true;
        }
        
        console.log(chalk.yellow('📝 No user stats file found, starting fresh'));
        return true;
        
    } catch (error) {
        console.log(chalk.red('❌ Error loading user stats:', error.message));
        return false;
    }
}

// Load subscription data
async function loadSubscriptionData() {
    try {
        const firebaseResult = await firebaseManager.loadData('bot_data', 'subscriptions');
        
        if (firebaseResult.success && firebaseResult.data) {
            const data = firebaseResult.data;
            config.subscriptionExpiry = data.subscriptionExpiry || {};
            config.subscriptionHistory = data.subscriptionHistory || [];
            config.subscriptionPlans = data.subscriptionPlans || config.subscriptionPlans;
            config.userUsage = data.userUsage || {};
            config.blockedUsers = data.blockedUsers || [];
            config.trialSettings = data.trialSettings || config.trialSettings;
            
            console.log(chalk.green('✅ Subscription data loaded from Firebase'));
            return true;
        }
        
        const subPath = path.join(__dirname, 'subscriptions.json');
        if (fs.existsSync(subPath)) {
            const data = JSON.parse(fs.readFileSync(subPath, 'utf8'));
            config.subscriptionExpiry = data.subscriptionExpiry || {};
            config.subscriptionHistory = data.subscriptionHistory || [];
            config.subscriptionPlans = data.subscriptionPlans || config.subscriptionPlans;
            config.userUsage = data.userUsage || {};
            config.blockedUsers = data.blockedUsers || [];
            config.trialSettings = data.trialSettings || config.trialSettings;
            
            if (firebaseManager.isAvailable()) {
                await saveSubscriptionData();
            }
            
            console.log(chalk.green('✅ Subscription data loaded from file'));
            return true;
        }
    } catch (error) {
        console.log(chalk.red('❌ Error loading subscription data:', error.message));
    }
    return false;
}

// Save subscription data
async function saveSubscriptionData() {
    try {
        const data = {
            subscriptionExpiry: config.subscriptionExpiry,
            subscriptionHistory: config.subscriptionHistory,
            subscriptionPlans: config.subscriptionPlans,
            userUsage: config.userUsage,
            blockedUsers: config.blockedUsers,
            trialSettings: config.trialSettings
        };
        
        const firebaseResult = await firebaseManager.saveData('bot_data', 'subscriptions', data);
        
        if (firebaseResult.success) {
            console.log(chalk.green('💾 Subscription data saved to Firebase'));
            const subPath = path.join(__dirname, 'subscriptions.json');
            fs.writeFileSync(subPath, JSON.stringify(data, null, 2));
            return true;
        } else {
            const subPath = path.join(__dirname, 'subscriptions.json');
            fs.writeFileSync(subPath, JSON.stringify(data, null, 2));
            console.log(chalk.yellow('⚠️ Subscription data saved locally (Firebase failed)'));
            return true;
        }
    } catch (error) {
        console.log(chalk.red('❌ Error saving subscription data:', error.message));
        return false;
    }
}

// Save session registry
function saveSessionRegistry() {
    try {
        const registryPath = path.join(__dirname, 'sessions', 'registry.json');
        const registryDir = path.dirname(registryPath);
        
        if (!fs.existsSync(registryDir)) {
            fs.mkdirSync(registryDir, { recursive: true });
        }
        
        const dataToSave = sessionRegistry.map(session => ({
            name: session.name,
            addedByAdmin: session.addedByAdmin,
            createdAt: session.createdAt,
            lastUsed: session.lastUsed
        }));
        
        fs.writeFileSync(registryPath, JSON.stringify(dataToSave, null, 2));
        console.log(chalk.green('💾 Session registry saved'));
    } catch (error) {
        console.log(chalk.red('❌ Error saving session registry:', error.message));
    }
}

// Load session registry
function loadSessionRegistry() {
    try {
        const registryPath = path.join(__dirname, 'sessions', 'registry.json');
        
        if (fs.existsSync(registryPath)) {
            const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
            sessionRegistry = data;
            console.log(chalk.green(`✅ Loaded ${sessionRegistry.length} sessions from registry`));
            return true;
        }
    } catch (error) {
        console.log(chalk.red('❌ Error loading session registry:', error.message));
    }
    return false;
}

// Save config
async function saveConfig() {
    try {
        if (firebaseManager && firebaseManager.isAvailable && firebaseManager.isAvailable()) {
            const firebaseResult = await firebaseManager.saveData('bot_data', 'config', config);
            
            if (firebaseResult && firebaseResult.success) {
                console.log(chalk.green('💾 Config saved to Firebase'));
                fs.writeFileSync(
                    path.join(__dirname, 'config.json'), 
                    JSON.stringify(config, null, 2)
                );
                return true;
            }
        }
        
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
        console.log(chalk.green('💾 Config saved locally'));
        return true;
        
    } catch (error) {
        console.log(chalk.red('❌ Error saving config:', error.message));
        return true;
    }
}

// Load config
if (fs.existsSync(path.join(__dirname, 'config.json'))) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
        config = { ...config, ...savedConfig };
        console.log(chalk.green('✅ Config loaded'));
    } catch (error) {
        console.log(chalk.red('❌ Error loading config:', error.message));
    }
}
async function broadcastMessage(message, adminOnly = false) {
    console.log(`📢 Starting broadcast: ${adminOnly ? 'Admins' : 'All Users'}`);
    
    let recipients;
    if (adminOnly) {
        recipients = Array.from(adminUsers);
    } else {
        recipients = Array.from(userStats.keys());
    }
    
    console.log(`📢 Will send to ${recipients.length} recipients`);
    
    let success = 0;
    let failed = 0;
    
    // Send initial status to admin
    const statusMsg = await safeSendMessage(ADMIN_USER_IDS[0], 
        `📢 <b>Broadcast Started</b>\n\n` +
        `Type: ${adminOnly ? 'Admins Only' : 'All Users'}\n` +
        `Total: ${recipients.length}\n` +
        `✅ Sent: 0\n` +
        `❌ Failed: 0\n` +
        `📊 Progress: 0%\n` +
        `🔄 Status: Starting...`
    );
    
    const startTime = Date.now();
    
    // Send messages with progress updates
    for (let i = 0; i < recipients.length; i++) {
        const userId = recipients[i];
        
        try {
            // Skip blocked users
            if (isUserBlocked(userId)) {
                console.log(`📵 Skipping blocked user: ${userId}`);
                continue;
            }
            
            await safeSendMessage(userId, message);
            success++;
            
        } catch (error) {
            failed++;
            console.log(`⚠️ Failed to send to ${userId}: ${error.message}`);
        }
        
        // Update progress every 10 messages or at the end
        if ((i + 1) % 10 === 0 || i === recipients.length - 1) {
            const progress = Math.round(((i + 1) / recipients.length) * 100);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            try {
                await safeEditMessage(ADMIN_USER_IDS[0], statusMsg.message_id,
                    `📢 <b>Broadcast in Progress</b>\n\n` +
                    `Type: ${adminOnly ? 'Admins Only' : 'All Users'}\n` +
                    `Total: ${recipients.length}\n` +
                    `✅ Sent: ${success}\n` +
                    `❌ Failed: ${failed}\n` +
                    `📊 Progress: ${progress}% (${i + 1}/${recipients.length})\n` +
                    `⏱️ Elapsed: ${elapsed}s\n` +
                    `🔄 Status: Sending...`
                );
            } catch (editError) {
                console.log(`⚠️ Could not update status: ${editError.message}`);
            }
        }
        
        // Small delay to avoid rate limits
        if (i % 20 === 0 && i > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Final update
    await safeEditMessage(ADMIN_USER_IDS[0], statusMsg.message_id,
        `✅ <b>Broadcast Complete</b>\n\n` +
        `Type: ${adminOnly ? 'Admins Only' : 'All Users'}\n` +
        `Total: ${recipients.length}\n` +
        `✅ Sent: ${success}\n` +
        `❌ Failed: ${failed}\n` +
        `📊 Success Rate: ${Math.round((success / recipients.length) * 100)}%\n` +
        `⏱️ Duration: ${duration}s\n\n` +
        `📋 Message sent to users.`
    );
    
    return {
        success: true,
        total: recipients.length,
        sent: success,
        failed: failed,
        duration: duration
    };
}
// =================== ENHANCED WHATSAPP MANAGER ===================
class WhatsAppManager {
    constructor() {
        this.sessions = new Map();
        this.authDir = path.join(__dirname, "whatsapp_auth");
        this.exportDir = path.join(__dirname, "session_exports");
        
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
        
        if (!fs.existsSync(this.exportDir)) {
            fs.mkdirSync(this.exportDir, { recursive: true });
        }
        
        loadSessionRegistry();
        console.log(chalk.green("✅ WhatsApp Manager Ready!"));
    }
    
    getExistingSessions() {
        try {
            if (!fs.existsSync(this.authDir)) {
                return [];
            }
            
            const items = fs.readdirSync(this.authDir);
            const sessions = items.filter(item => {
                const itemPath = path.join(this.authDir, item);
                return fs.statSync(itemPath).isDirectory();
            });
            
            return sessions;
        } catch (error) {
            console.log(chalk.red('❌ Error reading existing sessions:', error.message));
            return [];
        }
    }
    
    async reconnectAllSessions() {
        const existingSessions = this.getExistingSessions();
        console.log(chalk.yellow(`🔄 Found ${existingSessions.length} existing sessions to reconnect`));
        
        for (const sessionName of existingSessions) {
            try {
                const inRegistry = sessionRegistry.find(s => s.name === sessionName);
                if (!inRegistry) {
                    sessionRegistry.push({
                        name: sessionName,
                        addedByAdmin: true,
                        createdAt: Date.now(),
                        lastUsed: Date.now()
                    });
                }
                
                console.log(chalk.yellow(`🔄 Attempting to reconnect: ${sessionName}`));
                await this.createPlaceholderSession(sessionName);
                
            } catch (error) {
                console.log(chalk.red(`❌ Failed to reconnect ${sessionName}:`, error.message));
            }
        }
        
        saveSessionRegistry();
        return existingSessions.length;
    }
    
    async createPlaceholderSession(sessionName) {
        try {
            const sessionPath = path.join(this.authDir, sessionName);
            
            if (!fs.existsSync(sessionPath)) {
                console.log(chalk.red(`❌ Session directory not found: ${sessionName}`));
                return false;
            }
            
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            
            const conn = makeWaSocket({
                auth: state,
                logger: logger,
                printQRInTerminal: false
            });
            
            conn.ev.on("creds.update", saveCreds);
            
            let reconnectionAttempts = 0;
            const maxReconnectionAttempts = 3;
            
            conn.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log(chalk.yellow(`⚠️ ${sessionName} needs reauthentication!`));
                    console.log(chalk.yellow(`📱 QR code would be needed for ${sessionName}`));
                }
                
                if (connection === "open") {
                    console.log(chalk.green(`✅ ${sessionName} reconnected successfully!`));
                    reconnectionAttempts = 0;
                    
                    this.sessions.set(sessionName, { 
                        conn, 
                        isConnected: true,
                        addedByAdmin: true,
                        lastActive: Date.now()
                    });
                    
                    const sessionIndex = sessionRegistry.findIndex(s => s.name === sessionName);
                    if (sessionIndex !== -1) {
                        sessionRegistry[sessionIndex].lastUsed = Date.now();
                        saveSessionRegistry();
                    }
                }
                
                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    console.log(chalk.red(`❌ ${sessionName} disconnected - Status: ${statusCode}`));
                    
                    this.sessions.set(sessionName, { 
                        conn, 
                        isConnected: false,
                        addedByAdmin: true,
                        lastActive: Date.now()
                    });
                    
                    if (statusCode !== DisconnectReason.loggedOut && reconnectionAttempts < maxReconnectionAttempts) {
                        reconnectionAttempts++;
                        console.log(chalk.yellow(`🔄 Reconnection attempt ${reconnectionAttempts}/${maxReconnectionAttempts} for ${sessionName} in 5 seconds...`));
                        
                        setTimeout(() => {
                            if (this.sessions.has(sessionName)) {
                                this.reconnectSession(sessionName);
                            }
                        }, 5000);
                    }
                }
            });
            
            this.sessions.set(sessionName, { 
                conn, 
                isConnected: false,
                addedByAdmin: true,
                lastActive: Date.now()
            });
            
            return true;
            
        } catch (error) {
            console.log(chalk.red(`❌ Error creating placeholder for ${sessionName}:`, error.message));
            return false;
        }
    }
    
    async addSession(sessionName, chatId) {
        try {
            const sessionPath = path.join(this.authDir, sessionName);
            
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            
            const conn = makeWaSocket({
                auth: state,
                logger: logger,
                printQRInTerminal: false
            });
            
            conn.ev.on("creds.update", saveCreds);
            
            conn.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log(chalk.yellow(`📱 QR generated for ${sessionName}`));
                    await this.sendQRToTelegram(qr, sessionName, chatId);
                }
                
                if (connection === "open") {
                    console.log(chalk.green(`✅ ${sessionName} connected to WhatsApp!`));
                    
                    await safeSendMessage(chatId,
                        `✅ *WhatsApp Connected Successfully!*\n\n` +
                        `Session: *${sessionName}*\n` +
                        `Status: Connected ✅\n\n` +
                        `This session is now available for number checking.`
                    );
                    
                    this.sessions.set(sessionName, { 
                        conn, 
                        isConnected: true,
                        addedByAdmin: true,
                        lastActive: Date.now()
                    });
                    
                    const existingIndex = sessionRegistry.findIndex(s => s.name === sessionName);
                    if (existingIndex === -1) {
                        sessionRegistry.push({
                            name: sessionName,
                            addedByAdmin: true,
                            createdAt: Date.now(),
                            lastUsed: Date.now()
                        });
                        saveSessionRegistry();
                    }
                }
                
                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(chalk.red(`❌ ${sessionName} disconnected - Status: ${statusCode}`));
                    
                    this.sessions.set(sessionName, { 
                        conn, 
                        isConnected: false,
                        addedByAdmin: true,
                        lastActive: Date.now()
                    });
                    
                    if (shouldReconnect) {
                        console.log(chalk.yellow(`🔄 Attempting to reconnect ${sessionName}...`));
                        setTimeout(() => {
                            if (this.sessions.has(sessionName)) {
                                this.reconnectSession(sessionName, chatId);
                            }
                        }, 5000);
                    } else {
                        await safeSendMessage(chatId,
                            `⚠️ *WhatsApp Disconnected*\n\n` +
                            `Session: *${sessionName}*\n` +
                            `Status: Logged out ❌\n\n` +
                            `Please add the session again.`
                        );
                    }
                }
            });
            
            this.sessions.set(sessionName, { 
                conn, 
                isConnected: false,
                addedByAdmin: true,
                lastActive: Date.now()
            });
            
            return { 
                success: true, 
                message: `Session ${sessionName} added. Check Telegram for QR code.` 
            };
            
        } catch (error) {
            console.log(chalk.red(`Error adding session: ${error.message}`));
            return { success: false, message: `Error: ${error.message}` };
        }
    }
    
    async reconnectSession(sessionName, chatId = null) {
        try {
            const session = this.sessions.get(sessionName);
            if (!session) {
                console.log(chalk.red(`❌ Session ${sessionName} not found for reconnection`));
                return false;
            }
            
            console.log(chalk.yellow(`🔄 Reconnecting ${sessionName}...`));
            
            if (session.conn) {
                try {
                    await session.conn.end();
                } catch (e) {
                    console.log(chalk.yellow(`⚠️ Error ending connection for ${sessionName}:`, e.message));
                }
            }
            
            this.sessions.delete(sessionName);
            
            if (chatId) {
                await this.addSession(sessionName, chatId);
            } else {
                await this.createPlaceholderSession(sessionName);
            }
            
            return true;
            
        } catch (error) {
            console.log(chalk.red(`Reconnection error for ${sessionName}: ${error.message}`));
            return false;
        }
    }
    
    async sendQRToTelegram(qr, sessionName, chatId) {
        try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });
            
            const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, "");
            const qrBuffer = Buffer.from(base64Data, 'base64');
            
            await bot.sendPhoto(chatId, qrBuffer, {
                caption: `📱 *WhatsApp QR Code*\n\n` +
                        `Session: *${sessionName}*\n` +
                        `⚠️ *Admin Session Setup*\n\n` +
                        `*Instructions:*\n` +
                        `1. Open WhatsApp on your phone\n` +
                        `2. Tap Menu → Linked Devices\n` +
                        `3. Tap "Link a Device"\n` +
                        `4. Scan this QR code\n\n` +
                        `⏰ *This QR expires in 60 seconds*`,
                parse_mode: "HTML"
            });
            
            console.log(chalk.green(`✅ QR sent to Telegram for ${sessionName}`));
            
        } catch (qrError) {
            console.log(chalk.red(`QR generation error: ${qrError.message}`));
            
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
            
            await safeSendMessage(chatId,
                `📱 *WhatsApp QR Code*\n\n` +
                `Session: *${sessionName}*\n` +
                `⚠️ *Admin Session Setup*\n\n` +
                `*Click link to view QR:*\n` +
                `${qrUrl}\n\n` +
                `*Or copy this code:*\n` +
                `\`\`\`\n${qr}\n\`\`\`\n\n` +
                `⏰ *This QR expires in 60 seconds*`
            );
        }
    }
    
    async verifyNumber(sessionName, number) {
        try {
            const session = this.sessions.get(sessionName);
            if (!session || !session.isConnected) {
                return "SESSION_DISCONNECTED";
            }
            
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.length === 10) {
                cleanNumber = '91' + cleanNumber;
            }
            
            const jid = cleanNumber + "@s.whatsapp.net";
            console.log(chalk.blue(`🔍 Checking: ${cleanNumber} via ${sessionName}`));
            
            const result = await session.conn.onWhatsApp(jid);
            
            if (result?.[0]?.exists) {
                console.log(chalk.green(`${cleanNumber} ✅ ON WHATSAPP (${sessionName})`));
                session.lastActive = Date.now();
                return "ON_WHATSAPP";
            } else {
                console.log(chalk.red(`${cleanNumber} ❌ NOT ON WHATSAPP (${sessionName})`));
                session.lastActive = Date.now();
                return "NOT_ON_WHATSAPP";
            }
            
        } catch (error) {
            console.log(chalk.red(`Error verifying ${number}: ${error.message}`));
            return "ERROR";
        }
    }
    
    async bulkVerify(numbers, sessionNames) {
        try {
            const results = [];
            const availableSessions = sessionNames
                .map(name => this.sessions.get(name))
                .filter(s => s && s.isConnected);
            
            if (availableSessions.length === 0) {
                return { error: "No connected sessions available" };
            }
            
            console.log(chalk.cyan(`Using ${availableSessions.length} session(s) for bulk check`));
            
            for (let i = 0; i < numbers.length; i++) {
                const number = numbers[i];
                const sessionIndex = i % availableSessions.length;
                const sessionName = sessionNames[sessionIndex];
                
                const status = await this.verifyNumber(sessionName, number);
                results.push({ number, status, session: sessionName });
                
                if (i % 5 === 0 && i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            return { results: results, threads: 1, total: numbers.length };
            
        } catch (error) {
            console.log(chalk.red(`Bulk verify error: ${error.message}`));
            return { error: `Bulk verify failed: ${error.message}` };
        }
    }
    
    listSessions() {
        const list = [];
        for (const [name, session] of this.sessions) {
            list.push({
                name,
                connected: session.isConnected,
                addedByAdmin: session.addedByAdmin,
                lastActive: session.lastActive || 0
            });
        }
        return list;
    }
    
    listAllSessions() {
        const activeSessions = this.listSessions();
        const allSessions = [];
        
        activeSessions.forEach(session => {
            allSessions.push({
                name: session.name,
                connected: session.connected,
                status: session.connected ? "✅ Connected" : "❌ Disconnected",
                lastActive: session.lastActive
            });
        });
        
        sessionRegistry.forEach(regSession => {
            const isActive = activeSessions.some(s => s.name === regSession.name);
            if (!isActive) {
                allSessions.push({
                    name: regSession.name,
                    connected: false,
                    status: "💤 Inactive (needs reconnect)",
                    lastActive: regSession.lastUsed || regSession.createdAt
                });
            }
        });
        
        return allSessions;
    }
    
    removeSession(sessionName) {
        const session = this.sessions.get(sessionName);
        
        if (session) {
            if (session.conn) {
                session.conn.end();
            }
            
            this.sessions.delete(sessionName);
            
            const sessionIndex = sessionRegistry.findIndex(s => s.name === sessionName);
            if (sessionIndex !== -1) {
                sessionRegistry.splice(sessionIndex, 1);
                saveSessionRegistry();
            }
            
            const sessionPath = path.join(this.authDir, sessionName);
            if (fs.existsSync(sessionPath)) {
                try {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(chalk.yellow(`🗑️ Removed auth files for ${sessionName}`));
                } catch (error) {
                    console.log(chalk.red(`❌ Error removing auth files: ${error.message}`));
                }
            }
            
            return true;
        }
        
        return false;
    }
    
    getConnectedSessions() {
        const sessions = this.listSessions();
        return sessions.filter(s => s.connected);
    }
    
    getTotalAvailableSessions() {
        return this.listAllSessions().length;
    }
    
    async multiThreadBulkCheck(numbers) {
        try {
            const allSessions = this.getConnectedSessions();
            
            if (allSessions.length === 0) {
                return { error: "No connected sessions available" };
            }
            
            const sessionNames = allSessions.map(s => s.name);
            const totalNumbers = numbers.length;
            const threads = Math.min(allSessions.length, config.maxThreads);
            
            console.log(chalk.cyan(`🚀 Starting multi-thread check with ${threads} threads`));
            
            const numbersPerThread = Math.ceil(totalNumbers / threads);
            const promises = [];
            
            for (let i = 0; i < threads; i++) {
                const startIdx = i * numbersPerThread;
                const endIdx = Math.min(startIdx + numbersPerThread, totalNumbers);
                const threadNumbers = numbers.slice(startIdx, endIdx);
                const sessionName = sessionNames[i];
                
                if (threadNumbers.length > 0) {
                    promises.push(this.processThread(threadNumbers, sessionName, i + 1));
                }
            }
            
            const threadResults = await Promise.all(promises);
            const allResults = threadResults.flat();
            
            return {
                results: allResults,
                threads: threads,
                total: totalNumbers
            };
            
        } catch (error) {
            console.log(chalk.red(`Multi-thread error: ${error.message}`));
            return { error: `Multi-thread check failed: ${error.message}` };
        }
    }
    
    async processThread(numbers, sessionName, threadId) {
        const results = [];
        
        console.log(chalk.blue(`🧵 Thread ${threadId} (${sessionName}): Processing ${numbers.length} numbers`));
        
        for (let i = 0; i < numbers.length; i++) {
            const number = numbers[i];
            const status = await this.verifyNumber(sessionName, number);
            results.push({ number, status, session: sessionName, thread: threadId });
            
            if (i % 5 === 0 || i === numbers.length - 1) {
                const percent = Math.round(((i + 1) / numbers.length) * 100);
                console.log(chalk.gray(`  Thread ${threadId}: ${percent}% (${i + 1}/${numbers.length})`));
                
                if (i % 15 === 0 && i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }
        
        return results;
    }
    
    async exportSession(sessionName, chatId) {
        try {
            const sessionPath = path.join(this.authDir, sessionName);
            
            if (!fs.existsSync(sessionPath)) {
                return { success: false, message: `Session ${sessionName} not found` };
            }
            
            const timestamp = Date.now();
            const exportFileName = `${sessionName}_${timestamp}.zip`;
            const exportPath = path.join(this.exportDir, exportFileName);
            
            const output = fs.createWriteStream(exportPath);
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });
            
            return new Promise((resolve, reject) => {
                output.on('close', async () => {
                    console.log(chalk.green(`✅ Session exported: ${exportFileName}`));
                    
                    try {
                        const fileStream = fs.createReadStream(exportPath);
                        
                        await bot.sendDocument(chatId, fileStream, {}, {
                            filename: exportFileName,
                            caption: `📁 *Session Export Complete*\n\n` +
                                   `Session: ${sessionName}\n` +
                                   `File: ${exportFileName}\n` +
                                   `Size: ${(archive.pointer() / 1024).toFixed(2)} KB\n` +
                                   `Exported at: ${new Date().toLocaleString()}\n\n` +
                                   `⚠️ *How to import:*\n` +
                                   `1. Download this ZIP file\n` +
                                   `2. Go to Admin Panel → Session Tools → Import Session\n` +
                                   `3. Send this ZIP file\n` +
                                   `4. Bot will auto-detect and import\n\n` +
                                   `✅ *Compatible with:*\n` +
                                   `• Direct session exports\n` +
                                   `• Nested folder structures\n` +
                                   `• Manual ZIP files`
                        });
                        
                        setTimeout(() => {
                            if (fs.existsSync(exportPath)) {
                                fs.unlinkSync(exportPath);
                            }
                        }, 60000);
                        
                        resolve({ 
                            success: true, 
                            message: `Session ${sessionName} exported successfully`
                        });
                        
                    } catch (sendError) {
                        reject(sendError);
                    }
                });
                
                archive.on('error', reject);
                archive.pipe(output);
                
                const files = fs.readdirSync(sessionPath);
                files.forEach(file => {
                    const filePath = path.join(sessionPath, file);
                    const stat = fs.statSync(filePath);
                    
                    if (stat.isFile()) {
                        archive.file(filePath, { name: file });
                    }
                });
                
                const readme = `# WhatsApp Session: ${sessionName}

This ZIP contains WhatsApp session files.

## How to Import:
1. Extract this ZIP to get session files
2. OR import directly using bot's Import Session feature
3. Bot will auto-detect and setup the session

## Files included:
${files.join('\n')}

## Created: ${new Date().toLocaleString()}`;
                
                archive.append(readme, { name: 'IMPORT_INSTRUCTIONS.md' });
                archive.finalize();
            });
            
        } catch (error) {
            console.log(chalk.red(`❌ Export error: ${error.message}`));
            return { success: false, message: `Export failed: ${error.message}` };
        }
    }
    
    async importSession(zipBuffer, fileName, chatId) {
        try {
            let sessionName = fileName.replace(/_\d+\.zip$/, '').replace(/\.zip$/, '');
            sessionName = sessionName.replace(/[^a-zA-Z0-9_]/g, '_');
            
            if (!sessionName || sessionName.length < 3) {
                sessionName = `imported_${Date.now()}`;
            }
            
            const existingSessions = this.listAllSessions();
            if (existingSessions.some(s => s.name === sessionName)) {
                sessionName = `${sessionName}_${Date.now()}`;
            }
            
            const sessionPath = path.join(this.authDir, sessionName);
            const tempZipPath = path.join(this.exportDir, `temp_${Date.now()}.zip`);
            
            fs.writeFileSync(tempZipPath, zipBuffer);
            
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }
            
            console.log(chalk.yellow(`📦 Extracting ZIP to: ${sessionPath}`));
            
            await new Promise((resolve, reject) => {
                fs.createReadStream(tempZipPath)
                    .pipe(unzipper.Parse())
                    .on('entry', (entry) => {
                        const filePath = entry.path;
                        
                        let targetPath = filePath;
                        
                        if (filePath.startsWith(sessionName + '/') && filePath !== sessionName + '/') {
                            targetPath = filePath.substring(sessionName.length + 1);
                        }
                        
                        const parts = filePath.split('/');
                        if (parts.length > 1 && parts[0] !== sessionName) {
                            const firstPart = parts[0];
                            if (firstPart !== sessionName && !firstPart.includes('.')) {
                                targetPath = filePath.substring(firstPart.length + 1);
                            }
                        }
                        
                        const fullPath = path.join(sessionPath, targetPath);
                        
                        const dir = path.dirname(fullPath);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }
                        
                        if (entry.type === 'Directory') {
                            if (!fs.existsSync(fullPath)) {
                                fs.mkdirSync(fullPath, { recursive: true });
                            }
                            entry.autodrain();
                        } else {
                            entry.pipe(fs.createWriteStream(fullPath));
                        }
                    })
                    .on('close', resolve)
                    .on('error', reject);
            });
            
            if (fs.existsSync(tempZipPath)) {
                fs.unlinkSync(tempZipPath);
            }
            
            const files = fs.readdirSync(sessionPath);
            console.log(chalk.cyan(`📂 Files extracted: ${files.length} files`));
            
            if (files.length === 0) {
                console.log(chalk.yellow('🔄 Trying alternative extraction...'));
                await this.alternativeExtraction(zipBuffer, sessionPath, sessionName);
                
                const filesAfterAlt = fs.readdirSync(sessionPath);
                if (filesAfterAlt.length === 0) {
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true });
                    }
                    return { success: false, message: "No valid session files found in ZIP" };
                }
            }
            
            const requiredFiles = ['creds.json'];
            const hasRequiredFiles = requiredFiles.some(file => 
                fs.existsSync(path.join(sessionPath, file))
            );
            
            if (!hasRequiredFiles) {
                const subdirs = files.filter(file => 
                    fs.statSync(path.join(sessionPath, file)).isDirectory()
                );
                
                for (const subdir of subdirs) {
                    const subPath = path.join(sessionPath, subdir);
                    const subFiles = fs.readdirSync(subPath);
                    
                    if (subFiles.includes('creds.json')) {
                        console.log(chalk.yellow(`🔄 Moving files from ${subdir} to root...`));
                        this.moveFilesUp(subPath, sessionPath);
                        break;
                    }
                }
            }
            
            const finalFiles = fs.readdirSync(sessionPath);
            const finalHasRequired = requiredFiles.some(file => 
                fs.existsSync(path.join(sessionPath, file))
            );
            
            if (!finalHasRequired) {
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true });
                }
                return { success: false, message: "No valid session files (missing creds.json)" };
            }
            
            console.log(chalk.green(`✅ Session files validated: ${finalFiles.length} files`));
            
            sessionRegistry.push({
                name: sessionName,
                addedByAdmin: true,
                createdAt: Date.now(),
                lastUsed: Date.now(),
                imported: true,
                importedAt: new Date().toISOString()
            });
            
            saveSessionRegistry();
            
            await this.createPlaceholderSession(sessionName);
            
            return { 
                success: true, 
                message: `Session imported successfully as: ${sessionName}`,
                sessionName: sessionName 
            };
            
        } catch (error) {
            console.log(chalk.red(`❌ Import error: ${error.message}`));
            console.log(chalk.red(`❌ Stack: ${error.stack}`));
            return { success: false, message: `Import failed: ${error.message}` };
        }
    }
    
    async alternativeExtraction(zipBuffer, sessionPath, sessionName) {
        try {
            const tempExtractPath = path.join(this.exportDir, `extract_${Date.now()}`);
            fs.mkdirSync(tempExtractPath, { recursive: true });
            
            const tempZipPath = path.join(tempExtractPath, 'archive.zip');
            fs.writeFileSync(tempZipPath, zipBuffer);
            
            await new Promise((resolve, reject) => {
                fs.createReadStream(tempZipPath)
                    .pipe(unzipper.Extract({ path: tempExtractPath }))
                    .on('close', resolve)
                    .on('error', reject);
            });
            
            const findSessionFiles = (dir) => {
                const files = [];
                const items = fs.readdirSync(dir);
                
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);
                    
                    if (stat.isDirectory()) {
                        const subFiles = fs.readdirSync(itemPath);
                        if (subFiles.includes('creds.json')) {
                            return { isSessionDir: true, path: itemPath };
                        }
                        
                        const result = findSessionFiles(itemPath);
                        if (result.isSessionDir) {
                            return result;
                        }
                    }
                }
                
                return { isSessionDir: false, path: null };
            };
            
            const sessionDir = findSessionFiles(tempExtractPath);
            
            if (sessionDir.isSessionDir) {
                this.copyDirectory(sessionDir.path, sessionPath);
            } else {
                this.copyJsonFiles(tempExtractPath, sessionPath);
            }
            
            if (fs.existsSync(tempExtractPath)) {
                fs.rmSync(tempExtractPath, { recursive: true });
            }
            
        } catch (error) {
            console.log(chalk.red(`❌ Alternative extraction error: ${error.message}`));
        }
    }

    copyDirectory(source, target) {
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
        
        const items = fs.readdirSync(source);
        
        for (const item of items) {
            const sourcePath = path.join(source, item);
            const targetPath = path.join(target, item);
            const stat = fs.statSync(sourcePath);
            
            if (stat.isDirectory()) {
                this.copyDirectory(sourcePath, targetPath);
            } else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }

    copyJsonFiles(source, target) {
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
        
        const items = fs.readdirSync(source);
        
        for (const item of items) {
            const sourcePath = path.join(source, item);
            const stat = fs.statSync(sourcePath);
            
            if (stat.isDirectory()) {
                this.copyJsonFiles(sourcePath, target);
            } else if (item.endsWith('.json')) {
                const targetPath = path.join(target, item);
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }

    moveFilesUp(source, target) {
        const items = fs.readdirSync(source);
        
        for (const item of items) {
            const sourcePath = path.join(source, item);
            const targetPath = path.join(target, item);
            const stat = fs.statSync(sourcePath);
            
            if (stat.isDirectory()) {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                this.moveFilesUp(sourcePath, targetPath);
            } else {
                fs.renameSync(sourcePath, targetPath);
            }
        }
        
        if (fs.existsSync(source)) {
            fs.rmdirSync(source);
        }
    }

    async exportAllSessions(chatId) {
        try {
            const allSessions = this.listAllSessions();
            
            if (allSessions.length === 0) {
                return { success: false, message: "No sessions to export" };
            }
            
            const timestamp = Date.now();
            const exportFileName = `all_sessions_${timestamp}.zip`;
            const exportPath = path.join(this.exportDir, exportFileName);
            
            const output = fs.createWriteStream(exportPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            
            return new Promise((resolve, reject) => {
                output.on('close', async () => {
                    console.log(chalk.green(`✅ All sessions exported`));
                    
                    try {
                        const fileStream = fs.createReadStream(exportPath);
                        
                        await bot.sendDocument(chatId, fileStream, {}, {
                            filename: exportFileName,
                            caption: `📦 *All Sessions Export*\n\n` +
                                   `Total sessions: ${allSessions.length}\n` +
                                   `Size: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB\n` +
                                   `Exported at: ${new Date().toLocaleString()}`
                        });
                        
                        setTimeout(() => {
                            if (fs.existsSync(exportPath)) {
                                fs.unlinkSync(exportPath);
                            }
                        }, 60000);
                        
                        resolve({ success: true, message: `Exported ${allSessions.length} sessions` });
                        
                    } catch (sendError) {
                        reject(sendError);
                    }
                });
                
                archive.on('error', reject);
                archive.pipe(output);
                
                allSessions.forEach(session => {
                    const sessionPath = path.join(this.authDir, session.name);
                    if (fs.existsSync(sessionPath)) {
                        archive.directory(sessionPath, session.name);
                    }
                });
                
                const summary = {
                    totalSessions: allSessions.length,
                    exportedAt: new Date().toISOString(),
                    sessions: allSessions.map(s => ({
                        name: s.name,
                        status: s.status,
                        lastActive: s.lastActive
                    }))
                };
                
                archive.append(JSON.stringify(summary, null, 2), { name: 'SUMMARY.md' });
                archive.finalize();
            });
            
        } catch (error) {
            console.log(chalk.red(`❌ Bulk export error: ${error.message}`));
            return { success: false, message: `Bulk export failed: ${error.message}` };
        }
    }
}

// =================== INITIALIZE ===================
const whatsappManager = new WhatsAppManager();

// Load data
loadSubscriptionData();
loadAdminList();
loadUserStats();

// Auto-reconnect sessions
async function autoReconnectSessions() {
    console.log(chalk.yellow('🔄 Auto-reconnecting sessions...'));
    
    try {
        const reconnectedCount = await whatsappManager.reconnectAllSessions();
        console.log(chalk.green(`✅ Auto-reconnect completed. ${reconnectedCount} sessions processed.`));
        
        const connectedSessions = whatsappManager.getConnectedSessions();
        console.log(chalk.cyan(`📊 Connected: ${connectedSessions.length} sessions`));
        
    } catch (error) {
        console.log(chalk.red(`❌ Auto-reconnect failed: ${error.message}`));
    }
}

setTimeout(() => {
    autoReconnectSessions();
}, 2000);

// =================== BOT COMMANDS ===================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    // STEP 1: Check if user has joined the channel
    const isMember = await checkChannelMembership(userId);
    
    if (!isMember) {
        // User hasn't joined - show join message
        userStates[userId] = { action: 'awaiting_channel_join', originalMsg: msg };
        return sendChannelJoinMessage(chatId, userId);
    }
    
    // STEP 2: User has joined - continue with normal /start
    // Check if user is blocked
    if (isUserBlocked(userId)) {
        return safeSendMessage(chatId,
            "🚫 *ACCOUNT BLOCKED*\n\n" +
            "Your account has been blocked by an admin.\n\n" +
            "*Possible reasons:*\n" +
            "• Violation of terms of service\n" +
            "• Suspicious activity\n" +
            "• Payment issues\n\n" +
            "Contact admin for more information."
        );
    }
    
    if (!userStats.has(userId)) {
        userStats.set(userId, {
            dailyChecks: 0,
            lastCheck: 0,
            checksToday: 0,
            lastReset: Date.now(),
            firstSeen: Date.now(),
            totalChecks: 0,
            trialUsed: false
        });
    }
    
    const stats = userStats.get(userId);
    const subscriptionInfo = getUserSubscriptionInfo(userId);
    const limits = getUserLimits(userId);
    
    // Check if user has no subscription
    if (subscriptionInfo.subscriptionType === 'none') {
        const menu = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "👑 Subscribe Now", callback_data: "subscription_info" }],
                    [{ text: "❓ Help", callback_data: "help" }]
                ]
            }
        };
        
        return safeSendMessage(chatId,
            "👋 *Welcome to WhatsApp Number Checker Bot*\n\n" +
            "✅ *Channel membership verified!*\n\n" +  // Added this line
            "⚠️ *No Active Subscription*\n\n" +
            "Your trial period has ended or you don't have an active subscription.\n\n" +
            "*What you can do:*\n" +
            "• View available subscription plans\n" +
            "• Contact admin to subscribe\n" +
            "• Get help with the bot\n\n" +
            "Select an option below:",
            menu
        );
    }
    
    const allSessions = whatsappManager.listAllSessions();
    const connectedSessions = whatsappManager.getConnectedSessions();
    
    const menu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔍 Check Single Number", callback_data: "check_single" }],
                [{ text: "🚀 Multi-Thread Bulk Check", callback_data: "multi_thread_check" }],
                [{ text: "📊 My Stats & Usage", callback_data: "my_stats" }],
                [{ text: "👑 Subscription Plans", callback_data: "subscription_info" }],
                isAdmin(userId) ? [{ text: "🛠️ Admin Panel", callback_data: "admin_panel" }] : [],
                [{ text: "❓ Help", callback_data: "help" }]
            ].filter(row => row.length > 0)
        }
    };
    
    let welcomeMessage = 
    "👋 *WhatsApp Number Checker Bot*\n\n" +
    `✅ *Channel membership verified!*\n\n` +  // Added this line
    `*Session Status:*\n` +
    `• Total sessions: ${allSessions.length}\n` +
    `• ✅ Connected: ${connectedSessions.length}\n` +
    `• Available threads: ${connectedSessions.length}\n\n`;
    
    if (subscriptionInfo.isTrial) {
        welcomeMessage += `*Your Trial Status:*\n` +
        `• Plan: ${subscriptionInfo.subscriptionName}\n` +
        `• Checks used: ${subscriptionInfo.checksUsed}/${config.trialSettings.maxChecks}\n` +
        `• Max per check: ${limits.maxPerCheck} numbers\n` +
        `• Cooldown: ${limits.cooldown} seconds\n` +
        `• Trial ends in: ${subscriptionInfo.daysRemaining} days\n\n`;
    } else {
        welcomeMessage += `*Your Subscription:*\n` +
        `• Plan: ${subscriptionInfo.subscriptionName}\n` +
        `• Max per check: ${limits.maxPerCheck} numbers\n` +
        `• Checks used: ${subscriptionInfo.checksUsed}/${subscriptionInfo.maxChecks}\n` +
        `• Period: ${limits.periodDays} days\n` +
        `• Cooldown: ${limits.cooldown} seconds\n` +
        `• Expires: ${subscriptionInfo.expiryDate}\n\n`;
    }
    
    welcomeMessage += `Select an option below:`;
    
    safeSendMessage(chatId, welcomeMessage, menu);
});
// =================== CALLBACK QUERY HANDLER (UPDATED) ===================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId = query.from.id.toString();
    const action = query.data;
    
    console.log(chalk.cyan(`🔄 Callback received from ${userId}: ${action}`));
    
    try {
        // =================== CHANNEL JOIN HANDLER ===================
        // Handle channel join check button FIRST
        if (action === "check_channel_join") {
            console.log(chalk.yellow(`🔍 User ${userId} clicked "I've Joined"`));
            
            await bot.answerCallbackQuery(query.id, { 
                text: "Checking channel membership...",
                show_alert: false 
            });
            
            const isMember = await checkChannelMembership(userId);
            
            if (isMember) {
                console.log(chalk.green(`✅ User ${userId} is a channel member!`));
                
                // Delete the join message
                try {
                    await bot.deleteMessage(chatId, messageId);
                } catch (deleteError) {
                    console.log(chalk.yellow(`⚠️ Could not delete message: ${deleteError.message}`));
                }
                
                // Send welcome message
                await safeSendMessage(chatId,
                    "✅ *Channel membership verified!*\n\n" +
                    "You have successfully joined the channel. Welcome!\n\n" +
                    "Now you can use all bot features.\n" +
                    "Click /start to begin."
                );
                
                return;
                
            } else {
                console.log(chalk.red(`❌ User ${userId} is NOT a channel member`));
                
                await bot.answerCallbackQuery(query.id, { 
                    text: "❌ You haven't joined the channel yet!\n\nPlease click 'Join Channel' first, then 'I've Joined'.",
                    show_alert: true 
                });
                
                // Show join message again
                await sendChannelJoinMessage(chatId, userId);
                
                return;
            }
        }
        
        // For all other buttons, check channel membership
        const isMember = await checkChannelMembership(userId);
        
        if (!isMember && !isAdmin(userId)) {
            console.log(chalk.yellow(`🚫 User ${userId} tried to use bot without joining channel`));
            
            await bot.answerCallbackQuery(query.id, { 
                text: "❌ Please join the channel first!",
                show_alert: true 
            });
            
            // Store the original query to restore after join
            userStates[userId] = { 
                pendingAction: action,
                pendingQuery: query
            };
            
            // Send join message
            await sendChannelJoinMessage(chatId, userId);
            return;
        }
        
        // If user is a member or admin, continue with normal processing
        await bot.answerCallbackQuery(query.id);
        
        // Check if user is blocked
        if (isUserBlocked(userId)) {
            return safeSendMessage(chatId,
                "🚫 *ACCOUNT BLOCKED*\n\n" +
                "Your account has been blocked by an admin.\n" +
                "Contact admin for more information."
            );
        }
        
        // =================== EXISTING CALLBACK HANDLERS ===================
        
        // Check single number
        if (action === "check_single") {
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            if (subscriptionInfo.subscriptionType === 'none') {
                return safeSendMessage(chatId,
                    "❌ *No Active Subscription*\n\n" +
                    "Your trial has ended or you don't have an active subscription.\n" +
                    "Please subscribe to continue using the bot."
                );
            }
            
            const checkPermission = canUserCheck(userId, 1);
            const limits = getUserLimits(userId);
            
            if (!checkPermission.allowed) {
                return safeSendMessage(chatId, `❌ ${checkPermission.reason}`);
            }
            
            safeSendMessage(chatId,
                `🔢 *Check Single WhatsApp Number*\n\n` +
                `Send me a phone number to check.\n` +
                `*Format:* 919876543210 (without +)\n\n` +
                `📊 *Your limit:* ${limits.maxPerCheck} numbers per check\n` +
                `⏳ *Cooldown:* ${limits.cooldown} seconds`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_single_number' };
            });
            return;
        }
        
        // Bulk check with file
        if (action === "bulk_check_file") {
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            if (subscriptionInfo.subscriptionType === 'none') {
                return safeSendMessage(chatId,
                    "❌ *No Active Subscription*\n\n" +
                    "Your trial has ended or you don't have an active subscription.\n" +
                    "Please subscribe to continue using the bot."
                );
            }
            
            const limits = getUserLimits(userId);
            
            safeSendMessage(chatId,
                `📁 *Bulk Check with TXT File*\n\n` +
                `Send me a .txt file containing phone numbers.\n` +
                `*Format:* One number per line\n` +
                `*Example:*\n` +
                `919876543210\n` +
                `919876543211\n` +
                `919876543212\n\n` +
                `📊 *Your limit:* ${limits.maxPerCheck} numbers per file\n` +
                `⏳ *Cooldown:* ${limits.cooldown} seconds\n` +
                `📈 *Checks remaining:* ${limits.checksRemaining}`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_bulk_file' };
            });
            return;
        }
        
        // Multi-thread check
        if (action === "multi_thread_check") {
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            if (subscriptionInfo.subscriptionType === 'none') {
                return safeSendMessage(chatId,
                    "❌ *No Active Subscription*\n\n" +
                    "Your trial has ended or you don't have an active subscription.\n" +
                    "Please subscribe to continue using the bot."
                );
            }
            
            const limits = getUserLimits(userId);
            const connectedSessions = whatsappManager.getConnectedSessions();
            
            if (connectedSessions.length === 0) {
                return safeSendMessage(chatId,
                    "❌ *No WhatsApp sessions connected!*\n\n" +
                    "Admin needs to add and authenticate WhatsApp sessions first."
                );
            }
            
            safeSendMessage(chatId,
                `🚀 *Multi-Thread Bulk Check*\n\n` +
                `*Two ways to send numbers:*\n\n` +
                `1️⃣ *TEXT MESSAGE:*\n` +
                `Send numbers separated by new lines or spaces\n` +
                `*Example:*\n` +
                `919876543210\n` +
                `919876543211\n` +
                `919876543212\n\n` +
                `2️⃣ *TXT FILE:*\n` +
                `Upload a .txt file with one number per line\n\n` +
                `*Features:*\n` +
                `• Uses ${connectedSessions.length} threads\n` +
                `• Parallel processing\n` +
                `• Faster results\n\n` +
                `📊 *Your limit:* ${limits.maxPerCheck} numbers\n` +
                `🧵 *Available threads:* ${connectedSessions.length}\n` +
                `📈 *Checks remaining:* ${limits.checksRemaining}\n\n` +
                `Send your numbers now (text or file):`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_multi_thread' };
            });
            return;
        }
        
        // My stats
        if (action === "my_stats") {
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            
            if (subscriptionInfo.isBlocked) {
                return safeSendMessage(chatId, subscriptionInfo.message);
            }
            
            if (subscriptionInfo.subscriptionType === 'none') {
                return safeSendMessage(chatId,
                    "📊 *Your Account Status*\n\n" +
                    "⚠️ *No Active Subscription*\n\n" +
                    "Your trial period has ended or you don't have an active subscription.\n\n" +
                    "*What to do:*\n" +
                    "1. View subscription plans\n" +
                    "2. Contact admin to subscribe\n" +
                    "3. Choose a plan that fits your needs\n\n" +
                    "Use the 'Subscription Plans' button to see available options."
                );
            }
            
            const stats = userStats.get(userId) || {
                dailyChecks: 0,
                checksToday: 0,
                lastCheck: 0,
                totalChecks: 0
            };
            
            const limits = subscriptionInfo.limits;
            const lastCheck = stats.lastCheck ? 
                new Date(stats.lastCheck).toLocaleString() : 'Never';
            
            let message = 
                `📊 *Your Statistics*\n\n` +
                `👤 *Subscription Plan:* ${subscriptionInfo.subscriptionName}\n`;
            
            if (subscriptionInfo.isTrial) {
                message += `⏳ *Trial Status:* ${subscriptionInfo.daysRemaining} days remaining\n` +
                `🎯 *Trial Checks:* ${subscriptionInfo.checksUsed}/${config.trialSettings.maxChecks} used\n`;
            } else {
                message += `📅 *Expires:* ${subscriptionInfo.expiryDate}\n` +
                `⏳ *Days remaining:* ${subscriptionInfo.daysRemaining}\n` +
                `📈 *Checks used:* ${subscriptionInfo.checksUsed}/${subscriptionInfo.maxChecks}\n` +
                `🎯 *Checks remaining:* ${subscriptionInfo.checksRemaining}\n`;
            }
            
            message += 
                `\n*Usage Details:*\n` +
                `• Today's checks: ${stats.checksToday}\n` +
                `• Total checks: ${stats.totalChecks}\n` +
                `• Max per check: ${limits.maxPerCheck}\n` +
                `• Cooldown: ${limits.cooldown}s\n` +
                `• Period: ${limits.periodDays} days\n` +
                `🕒 *Last Check:* ${lastCheck}\n\n`;
            
            if (subscriptionInfo.isTrial) {
                message += `💎 *Subscribe now to unlock full features!*\n` +
                `• Higher limits\n` +
                `• Faster cooldown\n` +
                `• More checks per period`;
            }
            
            safeSendMessage(chatId, message);
            return;
        }
        
        // Subscription info
        if (action === "subscription_info") {
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            
            // Ensure plans exist
            const plans = config.subscriptionPlans || {};
            const trialSettings = config.trialSettings || {
                enabled: true,
                durationDays: 7,
                maxChecks: 50,
                maxPerCheck: 10,
                cooldown: 60
            };
            
            let message = `👑 *Subscription Plans*\n\n`;
            
            if (subscriptionInfo.isBlocked) {
                message += `🚫 *Account Blocked*\n\n` +
                `${subscriptionInfo.message}\n\n` +
                `Contact admin for assistance.`;
            } else if (subscriptionInfo.subscriptionType === 'none') {
                message += `⚠️ *No Active Subscription*\n\n` +
                `Your trial has ended. Please choose a plan:\n\n`;
            } else if (subscriptionInfo.isTrial) {
                // Get trial checks info
                const stats = userStats.get(userId) || { totalChecks: 0 };
                const trialChecksUsed = stats.totalChecks || 0;
                const trialChecksTotal = trialSettings.maxChecks || 50;
                const trialChecksRemaining = Math.max(0, trialChecksTotal - trialChecksUsed);
                
                message += `*Your Current Plan:* TRIAL\n` +
                `• Checks used: ${trialChecksUsed}/${trialChecksTotal}\n` +
                `• Max per check: ${trialSettings.maxPerCheck || 10} numbers\n` +
                `• Cooldown: ${trialSettings.cooldown || 60} seconds\n`;
                
                if (subscriptionInfo.daysRemaining > 0) {
                    message += `• Trial ends in: ${subscriptionInfo.daysRemaining} days\n\n`;
                } else {
                    message += `• Trial ended\n\n`;
                }
            } else {
                message += `*Your Current Plan:* ${subscriptionInfo.subscriptionName || 'Unknown'}\n` +
                `• Checks used: ${subscriptionInfo.checksUsed || 0}/${subscriptionInfo.maxChecks || 1000}\n` +
                `• Max per check: ${subscriptionInfo.limits?.maxPerCheck || 100} numbers\n` +
                `• Cooldown: ${subscriptionInfo.limits?.cooldown || 30} seconds\n` +
                `• Expires: ${subscriptionInfo.expiryDate || 'Unknown'}\n\n`;
            }
            
            if (!subscriptionInfo.isBlocked) {
                // Trial plan
                message += 
                    `*Available Plans:*\n` +
                    `1. *Trial*\n` +
                    `   • Max/check: ${trialSettings.maxPerCheck || 10}\n` +
                    `   • Total checks: ${trialSettings.maxChecks || 50}/${trialSettings.durationDays || 7} days\n` +
                    `   • Cooldown: ${trialSettings.cooldown || 60}s\n` +
                    `   • Price: Free\n` +
                    `   • ${trialSettings.durationDays || 7}-day trial with ${trialSettings.maxChecks || 50} checks\n\n`;
                
                // Basic plan
                if (plans.basic) {
                    message += `2. *Basic*\n` +
                    `   • Max/check: ${plans.basic.maxPerCheck || 100}\n` +
                    `   • Total checks: ${plans.basic.maxChecks || 1000}/${plans.basic.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.basic.cooldown || 30}s\n` +
                    `   • Price: ${plans.basic.price || '$5/month'}\n` +
                    `   • ${plans.basic.description || 'For individual users'}\n\n`;
                }
                
                // Premium plan
                if (plans.premium) {
                    message += `3. *Premium*\n` +
                    `   • Max/check: ${plans.premium.maxPerCheck || 500}\n` +
                    `   • Total checks: ${plans.premium.maxChecks || 4000}/${plans.premium.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.premium.cooldown || 10}s\n` +
                    `   • Price: ${plans.premium.price || '$15/month'}\n` +
                    `   • ${plans.premium.description || 'For small businesses'}\n\n`;
                }
                
                // Pro plan
                if (plans.pro) {
                    message += `4. *Pro*\n` +
                    `   • Max/check: ${plans.pro.maxPerCheck || 1000}\n` +
                    `   • Total checks: ${plans.pro.maxChecks || 10000}/${plans.pro.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.pro.cooldown || 5}s\n` +
                    `   • Price: ${plans.pro.price || '$30/month'}\n` +
                    `   • ${plans.pro.description || 'For agencies'}\n\n`;
                }
                
                // Custom plan
                if (plans.custom) {
                    message += `5. *Custom*\n` +
                    `   • Max/check: ${plans.custom.maxPerCheck || 2000}\n` +
                    `   • Total checks: ${plans.custom.maxChecks || 20000}/${plans.custom.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.custom.cooldown || 3}s\n` +
                    `   • Price: ${plans.custom.price || 'Custom pricing'}\n` +
                    `   • ${plans.custom.description || 'Fully customizable plan'}\n\n`;
                }
                
                message += `*Contact an admin to subscribe:*\n` +
                `Admins: @Continuefun , @MuteMic`;
            }
            
            safeSendMessage(chatId, message);
            return;
        }
        
        // Help
        if (action === "help") {
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            
            let message = 
                `❓ *Help & Instructions*\n\n` +
                `*How to use:*\n` +
                `1. Choose a checking method\n` +
                `2. Send numbers or upload file\n` +
                `3. Get results instantly\n\n` +
                `*Formats:*\n` +
                `• Single: 919876543210\n` +
                `• Bulk: .txt file (one number per line)\n\n`;
            
            if (!subscriptionInfo.isBlocked && subscriptionInfo.subscriptionType !== 'none') {
                message += `*Your Status:*\n` +
                `• Plan: ${subscriptionInfo.subscriptionName}\n` +
                `• Checks used: ${subscriptionInfo.checksUsed}/${subscriptionInfo.maxChecks}\n` +
                `• Max per check: ${subscriptionInfo.limits.maxPerCheck}\n` +
                `• Cooldown: ${subscriptionInfo.limits.cooldown}s\n\n`;
            }
            
            message += `*Subscription System:*\n` +
            `• All new users get a ${config.trialSettings.durationDays}-day trial (${config.trialSettings.maxChecks} checks)\n` +
            `• After trial, subscription required\n` +
            `• Plans based on checks per period\n` +
            `• Custom plans available\n\n` +
            `*Features:*\n` +
            `• ✅ WhatsApp number verification\n` +
            `• 📊 Excel report generation\n` +
            `• 🚀 Multi-thread processing\n` +
            `• 💾 Session persistence\n` +
            `• 👑 Flexible subscription system\n\n` +
            `*Contact admin for subscription or support.*`;
            
            safeSendMessage(chatId, message);
            return;
        }
        
        // Admin panel
        if (action === "admin_panel") {
            if (!isAdmin(userId)) {
                return safeSendMessage(chatId, "❌ Admin access required.");
            }
            
            const allSessions = whatsappManager.listAllSessions();
            const connectedSessions = whatsappManager.getConnectedSessions();
            
            const adminMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📱 Manage Sessions", callback_data: "admin_list_sessions" }],
                        [{ text: "🔧 Session Tools", callback_data: "admin_session_tools" }],
                        [{ text: "➕ Add Session (QR)", callback_data: "admin_add_session" }],
                        [{ text: "📢 Broadcast", callback_data: "admin_broadcast" }],
                        [{ text: "⚙️ Bot Settings", callback_data: "admin_settings" }],
                        [{ text: "📊 Bot Statistics", callback_data: "admin_stats" }],
                        [{ text: "👑 Manage Subscriptions", callback_data: "admin_manage_subscriptions" }],
                        [{ text: "👥 Manage Admins", callback_data: "admin_manage_admins" }],
                        [{ text: "🚫 Manage Users", callback_data: "admin_manage_users" }],
                        [{ text: "🔙 Back", callback_data: "back_to_main" }]
                    ]
                }
            };
            
            const activeSubscriptions = Object.keys(config.subscriptionExpiry).length;
            const trialUsers = Array.from(userStats.keys()).filter(uid => 
                getUserSubscription(uid) === SUBSCRIPTION_TYPES.TRIAL && !isUserBlocked(uid)
            ).length;
            const blockedUsers = getBlockedUsers().length;
            
            const adminMessage = 
                `🛠️ *Admin Panel*\n\n` +
                `*Session Status:*\n` +
                `• Total: ${allSessions.length}\n` +
                `• Connected: ${connectedSessions.length}\n` +
                `• Disconnected: ${allSessions.length - connectedSessions.length}\n\n` +
                `*User Stats:*\n` +
                `• Total users: ${Array.from(userStats.keys()).length}\n` +
                `• Trial users: ${trialUsers}\n` +
                `• Active subscriptions: ${activeSubscriptions}\n` +
                `• Blocked users: ${blockedUsers}\n` +
                `• Total checks used: ${Object.values(config.userUsage).reduce((sum, u) => sum + (u.totalChecksUsed || 0), 0)}\n\n` +
                `Select an option:`;
            
            safeSendMessage(chatId, adminMessage, adminMenu);
            return;
        }
        
        // NEW: Admin manage users
        if (action === "admin_manage_users") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const userManagementMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚫 Block User", callback_data: "admin_block_user" }],
                        [{ text: "✅ Unblock User", callback_data: "admin_unblock_user" }],
                        [{ text: "👑 Grant Trial", callback_data: "admin_grant_trial" }],
                        [{ text: "❌ Remove Subscription", callback_data: "admin_remove_subscription" }],
                        [{ text: "📋 View Blocked Users", callback_data: "admin_view_blocked" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            const blockedUsers = getBlockedUsers();
            const activeSubscriptions = Object.keys(config.subscriptionExpiry).length;
            
            const message = 
                `👥 *User Management*\n\n` +
                `*Statistics:*\n` +
                `• Total users: ${Array.from(userStats.keys()).length}\n` +
                `• Blocked users: ${blockedUsers.length}\n` +
                `• Active subscriptions: ${activeSubscriptions}\n\n` +
                `*Available Actions:*\n` +
                `• Block/Unblock users\n` +
                `• Grant trial periods\n` +
                `• Remove subscriptions\n` +
                `• View blocked users list\n\n` +
                `Select an option:`;
            
            safeSendMessage(chatId, message, userManagementMenu);
            return;
        }
        
        if (action === "admin_broadcast") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const broadcastMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📢 Broadcast to All", callback_data: "broadcast_to_all" }],
                        [{ text: "👥 Broadcast to Admins", callback_data: "broadcast_to_admins" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            safeSendMessage(chatId,
                `📢 <b>Broadcast Messages</b>\n\n` +
                `Send announcements or updates to users.\n\n` +
                `<b>Choose broadcast type:</b>`,
                broadcastMenu
            );
            return;
        }
        
        if (action === "broadcast_to_all") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `📢 <b>Broadcast to All Users</b>\n\n` +
                `Send the message you want to broadcast.\n\n` +
                `Will be sent to: ${Array.from(userStats.keys()).length} users\n\n` +
                `Type your message now:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_broadcast_all' };
            });
            return;
        }
        
        if (action === "broadcast_to_admins") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `📢 <b>Broadcast to Admins Only</b>\n\n` +
                `Send the message you want to broadcast.\n\n` +
                `Will be sent to: ${adminUsers.size} admins\n\n` +
                `Type your message now:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_broadcast_admins' };
            });
            return;
        }
        
        // NEW: Admin block user
        if (action === "admin_block_user") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `🚫 *Block User*\n\n` +
                `Send user ID to block:\n` +
                `\`\`\`\nuserId\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890\`\`\`\n\n` +
                `⚠️ *Warning:*\n` +
                `• User will lose all access\n` +
                `• All subscriptions removed\n` +
                `• Cannot use bot features\n\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_block_user' };
            });
            return;
        }
        
        // NEW: Admin unblock user
        if (action === "admin_unblock_user") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `✅ *Unblock User*\n\n` +
                `Send user ID to unblock:\n` +
                `\`\`\`\nuserId\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890\`\`\`\n\n` +
                `*Note:*\n` +
                `• User will be able to access bot\n` +
                `• Subscription not restored\n` +
                `• Need to grant trial/subscription\n\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_unblock_user' };
            });
            return;
        }
        
        // NEW: Admin grant trial
        if (action === "admin_grant_trial") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `👑 *Grant Trial*\n\n` +
                `Send user ID to grant trial:\n` +
                `\`\`\`\nuserId duration_days\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890 7\`\`\`\n\n` +
                `*Default trial:* ${config.trialSettings.durationDays} days, ${config.trialSettings.maxChecks} checks\n` +
                `*Duration:* Number of days (optional)\n\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_grant_trial' };
            });
            return;
        }
        
        // NEW: Admin remove subscription
        if (action === "admin_remove_subscription") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `❌ *Remove Subscription*\n\n` +
                `Send user ID to remove subscription:\n` +
                `\`\`\`\nuserId\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890\`\`\`\n\n` +
                `⚠️ *Warning:*\n` +
                `• All subscription data removed\n` +
                `• User will need new subscription\n` +
                `• Trial marked as used\n\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_remove_subscription' };
            });
            return;
        }
        
        // NEW: Admin view blocked users
        if (action === "admin_view_blocked") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const blockedUsers = getBlockedUsers();
            
            if (blockedUsers.length === 0) {
                return safeSendMessage(chatId, "📭 *No blocked users found.*");
            }
            
            let message = `🚫 *Blocked Users (${blockedUsers.length})*\n\n`;
            
            blockedUsers.forEach((blockedId, index) => {
                const stats = userStats.get(blockedId);
                const lastSeen = stats?.lastCheck ? 
                    new Date(stats.lastCheck).toLocaleDateString() : 'Never';
                
                message += `${index + 1}. *${blockedId}*\n`;
                message += `   Last active: ${lastSeen}\n`;
                message += `   Total checks: ${stats?.totalChecks || 0}\n\n`;
            });
            
            const viewMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh", callback_data: "admin_view_blocked" }],
                        [{ text: "🔙 Back", callback_data: "admin_manage_users" }]
                    ]
                }
            };
            
            safeSendMessage(chatId, message, viewMenu);
            return;
        }
        
        // Session tools
        if (action === "admin_session_tools") {
            if (!isAdmin(userId)) {
                return safeSendMessage(chatId, "❌ Admin access required.");
            }
            
            const sessionToolsMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📤 Export Session", callback_data: "admin_export_session" }],
                        [{ text: "📥 Import Session", callback_data: "admin_import_session" }],
                        [{ text: "📦 Export All Sessions", callback_data: "admin_export_all_sessions" }],
                        [{ text: "🗂️ Backup to Group", callback_data: "admin_backup_group" }],
                        [{ text: "🔄 Refresh Session List", callback_data: "admin_list_sessions" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            const connectedSessions = whatsappManager.getConnectedSessions();
            const allSessions = whatsappManager.listAllSessions();
            
            const message = 
                `🔧 *Session Tools*\n\n` +
                `*Session Status:*\n` +
                `• Total: ${allSessions.length}\n` +
                `• Connected: ${connectedSessions.length}\n\n` +
                `*Available Tools:*\n` +
                `• Export single session to ZIP\n` +
                `• Import session from ZIP file\n` +
                `• Export all sessions (backup)\n` +
                `• Backup to Telegram group\n\n` +
                `Select an option:`;
            
            safeSendMessage(chatId, message, sessionToolsMenu);
            return;
        }
        
        // Export session
        if (action === "admin_export_session") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const allSessions = whatsappManager.listAllSessions();
            
            if (allSessions.length === 0) {
                return safeSendMessage(chatId, "📭 No sessions available to export.");
            }
            
            const keyboard = allSessions.map(session => {
                const statusIcon = session.connected ? "✅" : "❌";
                return [{ 
                    text: `${statusIcon} ${session.name}`, 
                    callback_data: `export_session_${session.name}` 
                }];
            });
            
            keyboard.push([{ text: "🔙 Back", callback_data: "admin_session_tools" }]);
            
            safeSendMessage(chatId, 
                `📤 *Export Session*\n\n` +
                `Select a session to export as ZIP file:\n\n` +
                `✅ = Connected\n` +
                `❌ = Disconnected`,
                {
                    reply_markup: { inline_keyboard: keyboard }
                }
            );
            return;
        }
        
        // Import session
        if (action === "admin_import_session") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `📥 *Import Session*\n\n` +
                `Send me a ZIP file containing WhatsApp session.\n\n` +
                `*File Requirements:*\n` +
                `• Must be .zip format\n` +
                `• Should contain session files\n` +
                `• Max size: 50MB\n\n` +
                `*Auto-detection:*\n` +
                `• Session name from filename\n` +
                `• Auto-import and connect\n` +
                `• Shows in session list\n\n` +
                `📁 Send the ZIP file now:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_session_import' };
            });
            return;
        }
        
        // Export all sessions
        if (action === "admin_export_all_sessions") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const confirmMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Yes, Export All", callback_data: "confirm_export_all" }],
                        [{ text: "❌ Cancel", callback_data: "admin_session_tools" }]
                    ]
                }
            };
            
            safeSendMessage(chatId,
                `⚠️ *Export ALL Sessions*\n\n` +
                `This will create a ZIP file containing:\n` +
                `• ALL WhatsApp session files\n` +
                `• Session credentials\n` +
                `• Connection data\n\n` +
                `*Security Warning:*\n` +
                `• Contains sensitive data\n` +
                `• Share only with trusted admins\n` +
                `• Store securely\n\n` +
                `Are you sure?`,
                confirmMenu
            );
            return;
        }
        
        // Confirm export all
        if (action === "confirm_export_all") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            await bot.answerCallbackQuery(query.id, { text: "📦 Exporting all sessions..." });
            
            const result = await whatsappManager.exportAllSessions(chatId);
            
            if (result.success) {
                await safeSendMessage(chatId, 
                    `✅ *Export Complete!*\n\n` +
                    `${result.message}\n\n` +
                    `Check your Telegram for the ZIP file.`
                );
            } else {
                await safeSendMessage(chatId,
                    `❌ *Export Failed*\n\n` +
                    `${result.message}`
                );
            }
            return;
        }
        
        // Export specific session
        if (action.startsWith('export_session_')) {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const sessionName = action.replace('export_session_', '');
            await bot.answerCallbackQuery(query.id, { text: `📤 Exporting ${sessionName}...` });
            
            const result = await whatsappManager.exportSession(sessionName, chatId);
            
            if (result.success) {
                await safeSendMessage(chatId,
                    `✅ *Session Exported!*\n\n` +
                    `Session: ${sessionName}\n` +
                    `Status: ✅ Ready to download\n\n` +
                    `Check your Telegram for the ZIP file.`
                );
            } else {
                await safeSendMessage(chatId,
                    `❌ *Export Failed*\n\n` +
                    `Session: ${sessionName}\n` +
                    `Error: ${result.message}`
                );
            }
            return;
        }
        
        // Admin backup group
        if (action === "admin_backup_group") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const groupMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📤 Export & Send to Group", callback_data: "backup_to_group_now" }],
                        [{ text: "🔙 Back", callback_data: "admin_session_tools" }]
                    ]
                }
            };
            
            safeSendMessage(chatId,
                `🗂️ *Backup to Group*\n\n` +
                `To backup sessions to a Telegram group:\n\n` +
                `1. Export sessions using the tools above\n` +
                `2. Forward the ZIP files to your group\n` +
                `3. Other admins can import them\n\n` +
                `*Group Admin Tips:*\n` +
                `• Pin important session files\n` +
                `• Create a "Sessions" topic/channel\n` +
                `• Regularly backup sessions`,
                groupMenu
            );
            return;
        }
        
        // Backup to group now
        if (action === "backup_to_group_now") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `📤 *Backup to Group*\n\n` +
                `Use the export options first to create ZIP files.\n` +
                `Then forward those files to your group.\n\n` +
                `*Quick Steps:*\n` +
                `1. Go to Session Tools\n` +
                `2. Export single or all sessions\n` +
                `3. Forward ZIP files to group\n` +
                `4. Other admins download and import\n\n` +
                `⚠️ *Security Reminder:*\n` +
                `• Only share with trusted admins\n` +
                `• Delete from group after use\n` +
                `• Use private groups/channels`
            );
            return;
        }
        
        // Admin manage subscriptions
        if (action === "admin_manage_subscriptions") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            // Ensure config is initialized
            if (!config.subscriptionPlans) {
                config.subscriptionPlans = {
                    trial: {
                        name: "Trial",
                        maxPerCheck: 10,
                        maxChecks: 50,
                        periodDays: 7,
                        cooldown: 60,
                        price: "Free",
                        description: "7-day trial with 50 checks"
                    },
                    basic: {
                        name: "Basic",
                        maxPerCheck: 100,
                        maxChecks: 1000,
                        periodDays: 30,
                        cooldown: 30,
                        price: "$5/month",
                        description: "For individual users"
                    },
                    premium: {
                        name: "Premium",
                        maxPerCheck: 500,
                        maxChecks: 4000,
                        periodDays: 30,
                        cooldown: 10,
                        price: "$15/month",
                        description: "For small businesses"
                    },
                    pro: {
                        name: "Pro",
                        maxPerCheck: 1000,
                        maxChecks: 10000,
                        periodDays: 30,
                        cooldown: 5,
                        price: "$30/month",
                        description: "For agencies"
                    },
                    custom: {
                        name: "Custom",
                        maxPerCheck: 2000,
                        maxChecks: 20000,
                        periodDays: 30,
                        cooldown: 3,
                        price: "Custom pricing",
                        description: "Fully customizable plan"
                    }
                };
            }
            
            if (!config.trialSettings) {
                config.trialSettings = {
                    enabled: true,
                    durationDays: 7,
                    maxChecks: 50,
                    maxPerCheck: 10,
                    cooldown: 60
                };
            }
            
            const subscriptionMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ Grant Subscription", callback_data: "admin_grant_subscription" }],
                        [{ text: "🔧 Create Custom Plan", callback_data: "admin_create_custom" }],
                        [{ text: "📊 View All Subscriptions", callback_data: "admin_view_subscriptions" }],
                        [{ text: "📋 Subscription Plans", callback_data: "admin_subscription_plans" }],
                        [{ text: "🔄 Reset User Usage", callback_data: "admin_reset_usage" }],
                        [{ text: "⚙️ Trial Settings", callback_data: "admin_trial_settings" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            const activeSubscriptions = config.subscriptionExpiry ? Object.keys(config.subscriptionExpiry).length : 0;
            const trialUsers = Array.from(userStats.keys()).filter(uid => 
                getUserSubscription(uid) === SUBSCRIPTION_TYPES.TRIAL && !isUserBlocked(uid)
            ).length;
            
            const message = 
                `👑 *Subscription Management*\n\n` +
                `*Statistics:*\n` +
                `• Total users: ${Array.from(userStats.keys()).length}\n` +
                `• Trial users: ${trialUsers}\n` +
                `• Active subscriptions: ${activeSubscriptions}\n\n` +
                `*Available Plans:*\n` +
                `• Trial: ${config.trialSettings.maxChecks || 50} checks\n` +
                `• Basic: ${config.subscriptionPlans.basic.maxChecks || 1000} checks\n` +
                `• Premium: ${config.subscriptionPlans.premium ? config.subscriptionPlans.premium.maxChecks || 4000 : 4000} checks\n` +
                `• Pro: ${config.subscriptionPlans.pro ? config.subscriptionPlans.pro.maxChecks || 10000 : 10000} checks\n` +
                `• Custom: Flexible\n\n` +
                `Select an option:`;
            
            safeSendMessage(chatId, message, subscriptionMenu);
            return;
        }
        
        // NEW: Admin trial settings
        if (action === "admin_trial_settings") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            // Ensure everything exists
            if (!config.trialSettings) {
                config.trialSettings = {
                    enabled: true,
                    durationDays: 7,
                    maxChecks: 50,
                    maxPerCheck: 10,
                    cooldown: 60
                };
            }
            
            if (!config.subscriptionPlans) {
                config.subscriptionPlans = {};
            }
            
            if (!config.subscriptionPlans.trial) {
                config.subscriptionPlans.trial = {
                    name: "Trial",
                    maxPerCheck: config.trialSettings.maxPerCheck || 10,
                    maxChecks: config.trialSettings.maxChecks || 50,
                    periodDays: config.trialSettings.durationDays || 7,
                    cooldown: config.trialSettings.cooldown || 60,
                    price: "Free",
                    description: `${config.trialSettings.durationDays || 7}-day trial with ${config.trialSettings.maxChecks || 50} checks`
                };
            }
            
            const trialMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `Duration: ${config.trialSettings.durationDays || 7} days`, callback_data: "trial_setting_duration" },
                            { text: `Checks: ${config.trialSettings.maxChecks || 50}`, callback_data: "trial_setting_checks" }
                        ],
                        [
                            { text: `Max/Check: ${config.trialSettings.maxPerCheck || 10}`, callback_data: "trial_setting_maxcheck" },
                            { text: `Cooldown: ${config.trialSettings.cooldown || 60}s`, callback_data: "trial_setting_cooldown" }
                        ],
                        [
                            { text: `Enabled: ${config.trialSettings.enabled ? '✅' : '❌'}`, callback_data: "trial_setting_enabled" }
                        ],
                        [{ text: "🔙 Back", callback_data: "admin_manage_subscriptions" }]
                    ]
                }
            };
            
            const message = 
                `⚙️ *Trial Settings*\n\n` +
                `*Current Configuration:*\n` +
                `• Trial enabled: ${config.trialSettings.enabled ? '✅ Yes' : '❌ No'}\n` +
                `• Duration: ${config.trialSettings.durationDays || 7} days\n` +
                `• Total checks: ${config.trialSettings.maxChecks || 50}\n` +
                `• Max per check: ${config.trialSettings.maxPerCheck || 10} numbers\n` +
                `• Cooldown: ${config.trialSettings.cooldown || 60} seconds\n\n` +
                `*Click on a setting to modify:*`;
            
            safeSendMessage(chatId, message, trialMenu);
            return;
        }
        
        // Trial setting modifications
        if (action.startsWith('trial_setting_')) {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const setting = action.replace('trial_setting_', '');
            let prompt = '';
            
            switch (setting) {
                case 'duration':
                    prompt = `Enter new trial duration in days (current: ${config.trialSettings.durationDays}):`;
                    break;
                case 'checks':
                    prompt = `Enter new total checks for trial (current: ${config.trialSettings.maxChecks}):`;
                    break;
                case 'maxcheck':
                    prompt = `Enter new max numbers per check for trial (current: ${config.trialSettings.maxPerCheck}):`;
                    break;
                case 'cooldown':
                    prompt = `Enter new cooldown in seconds for trial (current: ${config.trialSettings.cooldown}):`;
                    break;
                case 'enabled':
                    prompt = `Enable trial for new users? (current: ${config.trialSettings.enabled ? 'Yes' : 'No'})\nEnter 'yes' or 'no':`;
                    break;
                default:
                    prompt = 'Unknown setting';
            }
            
            safeSendMessage(chatId, prompt).then(() => {
                userStates[userId] = { action: `trial_setting_${setting}` };
            });
            return;
        }
        
        // Admin grant subscription
        if (action === "admin_grant_subscription") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `➕ *Grant Subscription*\n\n` +
                `Send user ID and plan in this format:\n` +
                `\`\`\`\nuserId plan duration_days\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890 premium 30\`\`\`\n\n` +
                `*Available plans:*\n` +
                `• trial\n` +
                `• basic\n` +
                `• premium\n` +
                `• pro\n` +
                `• custom (use custom plan menu)\n\n` +
                `*Duration:* Number of days (0 for permanent)\n\n` +
                `Enter details:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_grant_subscription' };
            });
            return;
        }
        
        // Admin create custom plan
        if (action === "admin_create_custom") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `🔧 *Create Custom Plan*\n\n` +
                `Send user ID and custom limits:\n` +
                `\`\`\`\nuserId max_checks max_per_check cooldown duration_days price description\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890 4000 1000 5 30 $50 For heavy users\`\`\`\n\n` +
                `*Parameters:*\n` +
                `• max_checks: Total checks in period (e.g., 4000)\n` +
                `• max_per_check: Max numbers per check (e.g., 1000)\n` +
                `• cooldown: Seconds between checks (e.g., 5)\n` +
                `• duration_days: Subscription duration (e.g., 30)\n` +
                `• price: Price shown to user (e.g., $50)\n` +
                `• description: Plan description\n\n` +
                `Enter details:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_custom_plan' };
            });
            return;
        }
        
        // Admin reset usage
        if (action === "admin_reset_usage") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `🔄 *Reset User Usage*\n\n` +
                `Send user ID to reset their usage counter:\n` +
                `\`\`\`\nuserId\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890\`\`\`\n\n` +
                `This will reset checks used to 0 for current period.\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_reset_usage' };
            });
            return;
        }
        
        // Admin view subscriptions
        if (action === "admin_view_subscriptions") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            let activeSubscriptions = Object.entries(config.subscriptionExpiry);
            
            if (activeSubscriptions.length === 0) {
                return safeSendMessage(chatId, "📭 *No active subscriptions found.*");
            }
            
            let message = `📊 *Active Subscriptions (${activeSubscriptions.length})*\n\n`;
            
            activeSubscriptions.slice(0, 10).forEach(([subUserId, expiry], index) => {
                const expiryDate = new Date(expiry).toLocaleString();
                const daysRemaining = Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000));
                const userData = config.userUsage[subUserId];
                const checksUsed = userData?.checksUsed || 0;
                const maxChecks = userData?.maxChecks || config.subscriptionPlans.basic.maxChecks;
                
                message += `${index + 1}. *User:* ${subUserId}\n`;
                message += `   *Checks:* ${checksUsed}/${maxChecks}\n`;
                message += `   *Expires:* ${expiryDate}\n`;
                message += `   *Days left:* ${daysRemaining}\n\n`;
            });
            
            if (activeSubscriptions.length > 10) {
                message += `... and ${activeSubscriptions.length - 10} more subscriptions.\n`;
            }
            
            const recentHistory = config.subscriptionHistory.slice(-5).reverse();
            if (recentHistory.length > 0) {
                message += `\n*Recent Subscription Activity:*\n`;
                recentHistory.forEach((record, index) => {
                    const date = new Date(record.activatedAt).toLocaleDateString();
                    message += `${index + 1}. ${record.userId} - ${record.subscriptionType} (${record.durationDays} days) by ${record.activatedBy}\n`;
                });
            }
            
            const viewMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh", callback_data: "admin_view_subscriptions" }],
                        [{ text: "🔙 Back", callback_data: "admin_manage_subscriptions" }]
                    ]
                }
            };
            
            safeSendMessage(chatId, message, viewMenu);
            return;
        }
        
        // Admin subscription plans
        if (action === "admin_subscription_plans") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            // Ensure plans exist
            if (!config.subscriptionPlans) {
                config.subscriptionPlans = {
                    trial: {
                        name: "Trial",
                        maxPerCheck: 10,
                        maxChecks: 50,
                        periodDays: 7,
                        cooldown: 60,
                        price: "Free",
                        description: "7-day trial with 50 checks"
                    },
                    basic: {
                        name: "Basic",
                        maxPerCheck: 100,
                        maxChecks: 1000,
                        periodDays: 30,
                        cooldown: 30,
                        price: "$5/month",
                        description: "For individual users"
                    }
                };
            }
            
            const plans = config.subscriptionPlans;
            
            let  message = 
                `⚙️ *Subscription Plans Configuration*\n\n` +
                `*Current Plans:*\n\n`;
            
            // Trial plan
            message += `1. *Trial*\n` +
                `   • Max/check: ${plans.trial ? plans.trial.maxPerCheck || 10 : 10}\n` +
                `   • Max checks: ${plans.trial ? plans.trial.maxChecks || 50 : 50} per ${plans.trial ? plans.trial.periodDays || 7 : 7} days\n` +
                `   • Cooldown: ${plans.trial ? plans.trial.cooldown || 60 : 60}s\n` +
                `   • Price: ${plans.trial ? plans.trial.price || 'Free' : 'Free'}\n` +
                `   • ${plans.trial ? plans.trial.description || '7-day trial' : '7-day trial'}\n\n`;
            
            // Basic plan
            message += `2. *Basic*\n` +
                `   • Max/check: ${plans.basic ? plans.basic.maxPerCheck || 100 : 100}\n` +
                `   • Max checks: ${plans.basic ? plans.basic.maxChecks || 1000 : 1000} per ${plans.basic ? plans.basic.periodDays || 30 : 30} days\n` +
                `   • Cooldown: ${plans.basic ? plans.basic.cooldown || 30 : 30}s\n` +
                `   • Price: ${plans.basic ? plans.basic.price || '$5/month' : '$5/month'}\n` +
                `   • ${plans.basic ? plans.basic.description || 'For individual users' : 'For individual users'}\n\n`;
            
            // Premium plan (if exists)
            if (plans.premium) {
                message += `3. *Premium*\n` +
                    `   • Max/check: ${plans.premium.maxPerCheck || 500}\n` +
                    `   • Max checks: ${plans.premium.maxChecks || 4000} per ${plans.premium.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.premium.cooldown || 10}s\n` +
                    `   • Price: ${plans.premium.price || '$15/month'}\n` +
                    `   • ${plans.premium.description || 'For small businesses'}\n\n`;
            }
            
            // Pro plan (if exists)
            if (plans.pro) {
                message += `4. *Pro*\n` +
                    `   • Max/check: ${plans.pro.maxPerCheck || 1000}\n` +
                    `   • Max checks: ${plans.pro.maxChecks || 10000} per ${plans.pro.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.pro.cooldown || 5}s\n` +
                    `   • Price: ${plans.pro.price || '$30/month'}\n` +
                    `   • ${plans.pro.description || 'For agencies'}\n\n`;
            }
            
            // Custom plan (if exists)
            if (plans.custom) {
                message += `5. *Custom*\n` +
                    `   • Max/check: ${plans.custom.maxPerCheck || 2000}\n` +
                    `   • Max checks: ${plans.custom.maxChecks || 20000} per ${plans.custom.periodDays || 30} days\n` +
                    `   • Cooldown: ${plans.custom.cooldown || 3}s\n` +
                    `   • Price: ${plans.custom.price || 'Custom pricing'}\n` +
                    `   • ${plans.custom.description || 'Fully customizable plan'}\n\n`;
            }
            
            message += `To modify plans, use the Bot Settings menu.`;
            
            const plansMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Edit Trial", callback_data: "admin_edit_plan_trial" },
                            { text: "Edit Basic", callback_data: "admin_edit_plan_basic" }
                        ],
                        [
                            { text: plans.premium ? "Edit Premium" : "Add Premium", callback_data: "admin_edit_plan_premium" },
                            { text: plans.pro ? "Edit Pro" : "Add Pro", callback_data: "admin_edit_plan_pro" }
                        ],
                        [
                            { text: plans.custom ? "Edit Custom" : "Add Custom", callback_data: "admin_edit_plan_custom" }
                        ],
                        [
                            { text: "🔙 Back", callback_data: "admin_manage_subscriptions" }
                        ]
                    ]
                }
            };
            
            safeSendMessage(chatId, message, plansMenu);
            return;
        }
        
        // Admin manage admins
        if (action === "admin_manage_admins") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const adminList = Array.from(adminUsers);
            
            const adminMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ Add Admin", callback_data: "admin_add_admin" }],
                        [{ text: "❌ Remove Admin", callback_data: "admin_remove_admin" }],
                        [{ text: "📋 List Admins", callback_data: "admin_list_admins" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            const message = 
                `👥 *Admin Management*\n\n` +
                `*Current Admins:* ${adminList.length}\n\n` +
                `Only admins can:\n` +
                `• Add/remove WhatsApp sessions\n` +
                `• Modify bot settings\n` +
                `• Manage subscriptions\n` +
                `• Manage other admins\n` +
                `• Block/unblock users\n\n` +
                `Select an option:`;
            
            safeSendMessage(chatId, message, adminMenu);
            return;
        }
        
        // Admin add admin
        if (action === "admin_add_admin") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `➕ *Add Admin*\n\n` +
                `Send user ID to add as admin:\n` +
                `\`\`\`\nuserId\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890\`\`\`\n\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_add_admin' };
            });
            return;
        }
        
        // Admin remove admin
        if (action === "admin_remove_admin") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `❌ *Remove Admin*\n\n` +
                `Send user ID to remove from admin:\n` +
                `\`\`\`\nuserId\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n1234567890\`\`\`\n\n` +
                `⚠️ *Warning:* You cannot remove yourself!\n\n` +
                `Enter user ID:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_remove_admin' };
            });
            return;
        }
        
        // Admin list admins
        if (action === "admin_list_admins") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const adminList = Array.from(adminUsers);
            
            let message = `👥 *Admin List (${adminList.length})*\n\n`;
            
            adminList.forEach((adminId, index) => {
                const isYou = adminId === userId ? " (You)" : "";
                message += `${index + 1}. *${adminId}*${isYou}\n`;
            });
            
            message += `\n*Note:* All admins have full control over the bot.`;
            
            const listMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh", callback_data: "admin_list_admins" }],
                        [{ text: "🔙 Back", callback_data: "admin_manage_admins" }]
                    ]
                }
            };
            
            safeSendMessage(chatId, message, listMenu);
            return;
        }
        
        // Admin list sessions
        if (action === "admin_list_sessions") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const allSessions = whatsappManager.listAllSessions();
            const connectedSessions = whatsappManager.getConnectedSessions();
            
            if (allSessions.length === 0) {
                return safeSendMessage(chatId, 
                    "📭 *No WhatsApp sessions in registry.*\n\n" +
                    "Add new sessions using 'Add WhatsApp Session'"
                );
            }
            
            let message = "📱 *All WhatsApp Sessions:*\n\n";
            allSessions.forEach((session, index) => {
                const lastActive = session.lastActive ? 
                    new Date(session.lastActive).toLocaleDateString() : 'Never';
                message += `${index + 1}. *${session.name}* - ${session.status}\n`;
                message += `   Last active: ${lastActive}\n\n`;
            });
            
            message += `\n📊 *Summary:*\n`;
            message += `• Total in registry: ${allSessions.length}\n`;
            message += `• ✅ Connected: ${connectedSessions.length}\n`;
            message += `• ❌ Disconnected: ${allSessions.length - connectedSessions.length}\n`;
            message += `• Available Threads: ${connectedSessions.length}`;
            
            const sessionMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔄 Reconnect All", callback_data: "admin_reconnect_all" }],
                        [{ text: "🗑️ Clean Inactive", callback_data: "admin_clean_inactive" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            safeSendMessage(chatId, message, sessionMenu);
            return;
        }
        
        // Admin reconnect all
        if (action === "admin_reconnect_all") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            await safeEditMessage(chatId, query.message.message_id, "🔄 Attempting to reconnect all sessions...");
            
            try {
                const reconnectedCount = await whatsappManager.reconnectAllSessions();
                const connectedSessions = whatsappManager.getConnectedSessions();
                
                await safeEditMessage(chatId, query.message.message_id,
                    `✅ *Reconnection Complete!*\n\n` +
                    `• Sessions processed: ${reconnectedCount}\n` +
                    `• Currently connected: ${connectedSessions.length}\n` +
                    `• Available for checking: ${connectedSessions.length}\n\n` +
                    `⚠️ *Note:* Some sessions may need QR code reauthentication.`
                );
            } catch (error) {
                await safeEditMessage(chatId, query.message.message_id,
                    `❌ *Reconnection Failed!*\n\n` +
                    `Error: ${error.message}`
                );
            }
            return;
        }
        
        // Admin add session
        if (action === "admin_add_session") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `➕ *Add WhatsApp Session*\n\n` +
                `Send me a unique session name.\n` +
                `*Example:* session1, mywhatsapp, etc.\n\n` +
                `⚠️ *Note:*\n` +
                `• This will generate a QR code\n` +
                `• Scan with WhatsApp to link\n` +
                `• Session will auto-reconnect\n\n` +
                `Enter session name:`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_session_name' };
            });
            return;
        }
        
        // Admin clean inactive
        if (action === "admin_clean_inactive") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            safeSendMessage(chatId,
                `🗑️ *Clean Inactive Sessions*\n\n` +
                `This will remove sessions that have been inactive for too long.\n\n` +
                `*Warning:* This action cannot be undone!\n` +
                `Are you sure you want to continue?\n\n` +
                `Type: *YES* to confirm`
            ).then(() => {
                userStates[userId] = { action: 'awaiting_clean_confirm' };
            });
            return;
        }
        
        // Admin settings
        if (action === "admin_settings") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const settingsMenu = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `Max/Check: ${config.maxNumbersPerCheck}`, callback_data: "setting_max_check" },
                            { text: `Daily: ${config.dailyChecksPerUser}`, callback_data: "setting_daily" }
                        ],
                        [
                            { text: `Cooldown: ${config.checkCooldown}s`, callback_data: "setting_cooldown" },
                            { text: `Threads: ${config.maxThreads}`, callback_data: "setting_threads" }
                        ],
                        [
                            { text: `Premium Max: ${config.premiumMaxNumbers}`, callback_data: "setting_premium_max" },
                            { text: "📁 File Upload", callback_data: "setting_file_upload" }
                        ],
                        [{ text: "👑 Subscription Plans", callback_data: "admin_subscription_plans" }],
                        [{ text: "⚙️ Trial Settings", callback_data: "admin_trial_settings" }],
                        [{ text: "💾 Save Config", callback_data: "save_config" }],
                        [{ text: "🔙 Back", callback_data: "admin_panel" }]
                    ]
                }
            };
            
            const settingsMessage = 
                `⚙️ *Bot Settings*\n\n` +
                `*Current Configuration:*\n` +
                `• Max numbers per check: ${config.maxNumbersPerCheck}\n` +
                `• Daily checks per user: ${config.dailyChecksPerUser}\n` +
                `• Check cooldown: ${config.checkCooldown} seconds\n` +
                `• Max threads: ${config.maxThreads}\n` +
                `• Premium max numbers: ${config.premiumMaxNumbers}\n` +
                `• Allow file upload: ${config.allowFileUpload ? '✅ Yes' : '❌ No'}\n` +
                `• Trial enabled: ${config.trialSettings.enabled ? '✅ Yes' : '❌ No'}\n` +
                `• Trial duration: ${config.trialSettings.durationDays} days\n` +
                `• Trial checks: ${config.trialSettings.maxChecks}\n\n` +
                `*Click on a setting to modify:*`;
            
            safeSendMessage(chatId, settingsMessage, settingsMenu);
            return;
        }
        
        // Admin stats
        if (action === "admin_stats") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const allUsers = Array.from(userStats.entries());
            const totalChecks = allUsers.reduce((sum, [_, stats]) => sum + stats.totalChecks, 0);
            const todayChecks = allUsers.reduce((sum, [_, stats]) => sum + stats.checksToday, 0);
            const subscriptionCount = Object.keys(config.subscriptionExpiry).length;
            const trialUsers = allUsers.filter(([uid]) => 
                getUserSubscription(uid) === SUBSCRIPTION_TYPES.TRIAL && !isUserBlocked(uid)
            ).length;
            const adminCount = adminUsers.size;
            const blockedCount = getBlockedUsers().length;
            const noSubscription = allUsers.filter(([uid]) => 
                getUserSubscription(uid) === null && !isUserBlocked(uid)
            ).length;
            
            const revenue = subscriptionCount * 10;
            
            const message = 
                `📈 *Bot Statistics*\n\n` +
                `*Users:*\n` +
                `• Total users: ${allUsers.length}\n` +
                `• Trial users: ${trialUsers}\n` +
                `• Active subscriptions: ${subscriptionCount}\n` +
                `• No subscription: ${noSubscription}\n` +
                `• Blocked users: ${blockedCount}\n` +
                `• Admin users: ${adminCount}\n\n` +
                `*Usage:*\n` +
                `• Total checks: ${totalChecks}\n` +
                `• Today's checks: ${todayChecks}\n` +
                `• Subscription checks used: ${Object.values(config.userUsage).reduce((sum, u) => sum + (u.checksUsed || 0), 0)}\n\n` +
                `*Revenue (estimated):*\n` +
                `• Active subscriptions: ${subscriptionCount}\n` +
                `• Estimated monthly: $${revenue}\n\n` +
                `*Sessions:*\n` +
                `• Total sessions: ${whatsappManager.listAllSessions().length}\n` +
                `• Connected: ${whatsappManager.getConnectedSessions().length}`;
            
            safeSendMessage(chatId, message);
            return;
        }
        
        // Save config
        if (action === "save_config") {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            saveConfig();
            saveSessionRegistry();
            saveSubscriptionData();
            saveAdminList();
            saveUserStats();
            
            await bot.answerCallbackQuery(query.id, { text: "✅ All configuration saved!" });
            return;
        }
        
        // Edit plan handlers
        if (action.startsWith('admin_edit_plan_')) {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const planType = action.replace('admin_edit_plan_', '');
            
            safeSendMessage(chatId,
                `⚙️ *Edit ${planType.charAt(0).toUpperCase() + planType.slice(1)} Plan*\n\n` +
                `Send new values in this format:\n` +
                `\`\`\`\nmax_checks period_days max_per_check cooldown price description\`\`\`\n\n` +
                `*Example:*\n` +
                `\`\`\`\n4000 30 1000 10 $50 For heavy users\`\`\`\n\n` +
                `Enter values:`
            ).then(() => {
                userStates[userId] = { action: `awaiting_edit_plan_${planType}` };
            });
            return;
        }
        
        // Back to main
        if (action === "back_to_main") {
            const chatId = query.message.chat.id;
            const userId = query.from.id.toString();
            
            // Check if user is blocked
            if (isUserBlocked(userId)) {
                return safeEditMessage(chatId, query.message.message_id,
                    "🚫 *ACCOUNT BLOCKED*\n\n" +
                    "Your account has been blocked by an admin.\n\n" +
                    "*Possible reasons:*\n" +
                    "• Violation of terms of service\n" +
                    "• Suspicious activity\n" +
                    "• Payment issues\n\n" +
                    "Contact admin for more information."
                );
            }
            
            if (!userStats.has(userId)) {
                userStats.set(userId, {
                    dailyChecks: 0,
                    lastCheck: 0,
                    checksToday: 0,
                    lastReset: Date.now(),
                    firstSeen: Date.now(),
                    totalChecks: 0,
                    trialUsed: false
                });
            }
            
            const stats = userStats.get(userId);
            const subscriptionInfo = getUserSubscriptionInfo(userId);
            
            // Check if user has no subscription
            if (subscriptionInfo.subscriptionType === 'none') {
                const menu = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "👑 Subscribe Now", callback_data: "subscription_info" }],
                            [{ text: "❓ Help", callback_data: "help" }]
                        ]
                    }
                };
                
                return safeEditMessage(chatId, query.message.message_id,
                    "👋 *Welcome to WhatsApp Number Checker Bot*\n\n" +
                    "⚠️ *No Active Subscription*\n\n" +
                    "Your trial period has ended or you don't have an active subscription.\n\n" +
                    "*What you can do:*\n" +
                    "• View available subscription plans\n" +
                    "• Contact admin to subscribe\n" +
                    "• Get help with the bot\n\n" +
                    "Select an option below:",
                    menu
                );
            }
            
            const limits = subscriptionInfo.limits;
            const allSessions = whatsappManager.listAllSessions();
            const connectedSessions = whatsappManager.getConnectedSessions();
            
            const menu = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔍 Check Single Number", callback_data: "check_single" }],
                        [{ text: "🚀 Multi-Thread Bulk Check", callback_data: "multi_thread_check" }],
                        [{ text: "📊 My Stats & Usage", callback_data: "my_stats" }],
                        [{ text: "👑 Subscription Plans", callback_data: "subscription_info" }],
                        isAdmin(userId) ? [{ text: "🛠️ Admin Panel", callback_data: "admin_panel" }] : [],
                        [{ text: "❓ Help", callback_data: "help" }]
                    ].filter(row => row.length > 0)
                }
            };
            
            let welcomeMessage = 
                "👋 *WhatsApp Number Checker Bot*\n\n" +
                `*Session Status:*\n` +
                `• Total sessions: ${allSessions.length}\n` +
                `• ✅ Connected: ${connectedSessions.length}\n` +
                `• Available threads: ${connectedSessions.length}\n\n`;
            
            if (subscriptionInfo.isTrial) {
                welcomeMessage += `*Your Trial Status:*\n` +
                `• Plan: ${subscriptionInfo.subscriptionName}\n` +
                `• Checks used: ${subscriptionInfo.checksUsed}/${config.trialSettings.maxChecks}\n` +
                `• Max per check: ${limits.maxPerCheck} numbers\n` +
                `• Cooldown: ${limits.cooldown} seconds\n` +
                `• Trial ends in: ${subscriptionInfo.daysRemaining} days\n\n`;
            } else {
                welcomeMessage += `*Your Subscription:*\n` +
                `• Plan: ${subscriptionInfo.subscriptionName}\n` +
                `• Max per check: ${limits.maxPerCheck} numbers\n` +
                `• Checks used: ${subscriptionInfo.checksUsed}/${subscriptionInfo.maxChecks}\n` +
                `• Period: ${limits.periodDays} days\n` +
                `• Cooldown: ${limits.cooldown} seconds\n` +
                `• Expires: ${subscriptionInfo.expiryDate}\n\n`;
            }
            
            welcomeMessage += `Select an option below:`;
            
            safeEditMessage(chatId, query.message.message_id, welcomeMessage, menu);
            return;
        }
        
        // Handle setting modifications
        if (action.startsWith('setting_')) {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Admin access required." });
            }
            
            const setting = action.replace('setting_', '');
            let prompt = '';
            
            switch (setting) {
                case 'max_check':
                    prompt = `Enter new value for Max Numbers Per Check (current: ${config.maxNumbersPerCheck}):`;
                    break;
                case 'daily':
                    prompt = `Enter new value for Daily Checks Per User (current: ${config.dailyChecksPerUser}):`;
                    break;
                case 'cooldown':
                    prompt = `Enter new value for Check Cooldown in seconds (current: ${config.checkCooldown}):`;
                    break;
                case 'threads':
                    prompt = `Enter new value for Max Threads (current: ${config.maxThreads}):`;
                    break;
                case 'premium_max':
                    prompt = `Enter new value for Premium Max Numbers (current: ${config.premiumMaxNumbers}):`;
                    break;
                case 'file_upload':
                    prompt = `Enable file upload? (current: ${config.allowFileUpload ? 'Yes' : 'No'})\nEnter 'yes' or 'no':`;
                    break;
                default:
                    prompt = 'Unknown setting';
            }
            
            safeSendMessage(chatId, prompt).then(() => {
                userStates[userId] = { action: `setting_${setting}` };
            });
            return;
        }
        
    } catch (error) {
        console.log(chalk.red(`Callback error: ${error.message}`));
        bot.answerCallbackQuery(query.id, { 
            text: `❌ Error: ${error.message}` 
        });
    }
});
// =================== MESSAGE HANDLER (UPDATED) ===================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text || '';
    
    // Ignore commands
    if (text.startsWith('/')) return;
    // Check if user is blocked
    if (isUserBlocked(userId)) {
        return safeSendMessage(chatId,
            "🚫 *ACCOUNT BLOCKED*\n\n" +
            "Your account has been blocked by an admin.\n" +
            "Contact admin for more information."
        );
    }
    
    const userState = userStates[userId];
    // NEW: Handle block user
    if (userState && userState.action === 'awaiting_block_user') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const targetUserId = text.trim();
        
        if (targetUserId === userId) {
            return safeSendMessage(chatId, "❌ You cannot block yourself!");
        }
        
        if (isAdmin(targetUserId)) {
            return safeSendMessage(chatId, "❌ You cannot block another admin!");
        }
        
        const blocked = blockUser(targetUserId);
        
        if (blocked) {
            // Notify the blocked user if possible
            try {
                await safeSendMessage(targetUserId,
                    "🚫 *ACCOUNT BLOCKED*\n\n" +
                    "Your account has been blocked by an admin.\n\n" +
                    "*What this means:*\n" +
                    "• You can no longer use the bot\n" +
                    "• All subscriptions removed\n" +
                    "• Access to all features revoked\n\n" +
                    "Contact admin for more information."
                );
            } catch (error) {
                console.log(chalk.yellow(`⚠️ Could not notify blocked user ${targetUserId}: ${error.message}`));
            }
            
            await safeSendMessage(chatId,
                `✅ *User Blocked!*\n\n` +
                `User ${targetUserId} has been blocked.\n` +
                `• All access revoked\n` +
                `• Subscriptions removed\n` +
                `• Added to blocked list\n\n` +
                `Total blocked users: ${getBlockedUsers().length}`
            );
        } else {
            await safeSendMessage(chatId,
                `⚠️ *User already blocked*\n\n` +
                `User ${targetUserId} is already in the blocked list.`
            );
        }
        
        return;
    }
    
    // NEW: Handle unblock user
    if (userState && userState.action === 'awaiting_unblock_user') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const targetUserId = text.trim();
        
        const unblocked = unblockUser(targetUserId);
        
        if (unblocked) {
            // Notify the unblocked user if possible
            try {
                await safeSendMessage(targetUserId,
                    "✅ *ACCOUNT UNBLOCKED*\n\n" +
                    "Your account has been unblocked by an admin.\n\n" +
                    "*What this means:*\n" +
                    "• You can now access the bot\n" +
                    "• Subscription not restored\n" +
                    "• May need to subscribe again\n\n" +
                    "Use /start to begin."
                );
            } catch (error) {
                console.log(chalk.yellow(`⚠️ Could not notify unblocked user ${targetUserId}: ${error.message}`));
            }
            
            await safeSendMessage(chatId,
                `✅ *User Unblocked!*\n\n` +
                `User ${targetUserId} has been unblocked.\n` +
                `• Access restored\n` +
                `• Can use bot again\n` +
                `• Removed from blocked list\n\n` +
                `Total blocked users: ${getBlockedUsers().length}`
            );
        } else {
            await safeSendMessage(chatId,
                `⚠️ *User not blocked*\n\n` +
                `User ${targetUserId} is not in the blocked list.`
            );
        }
        
        return;
    }
    
    // NEW: Handle grant trial
    if (userState && userState.action === 'awaiting_grant_trial') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const parts = text.trim().split(/\s+/);
        const targetUserId = parts[0];
        let durationDays = parts[1] ? parseInt(parts[1]) : config.trialSettings.durationDays;
        
        if (isNaN(durationDays) || durationDays < 1) {
            durationDays = config.trialSettings.durationDays;
        }
        
        if (isUserBlocked(targetUserId)) {
            return safeSendMessage(chatId,
                `❌ Cannot grant trial to blocked user!\n\n` +
                `User ${targetUserId} is blocked. Unblock them first.`
            );
        }
        
        const granted = grantTrial(targetUserId, durationDays);
        
        if (granted) {
            // Update trial settings for this user
            const userStatsData = userStats.get(targetUserId);
            if (userStatsData) {
                userStatsData.trialStart = Date.now();
                userStatsData.trialUsed = false;
                userStatsData.totalChecks = 0;
            }
            
            // Notify the user if possible
            try {
                await safeSendMessage(targetUserId,
                    `🎉 *Trial Granted!*\n\n` +
                    `An admin has granted you a trial period.\n\n` +
                    `*Trial Details:*\n` +
                    `• Duration: ${durationDays} days\n` +
                    `• Total checks: ${config.trialSettings.maxChecks}\n` +
                    `• Max per check: ${config.trialSettings.maxPerCheck} numbers\n` +
                    `• Cooldown: ${config.trialSettings.cooldown} seconds\n\n` +
                    `Use /start to begin using the bot.`
                );
            } catch (error) {
                console.log(chalk.yellow(`⚠️ Could not notify user ${targetUserId}: ${error.message}`));
            }
            
            await safeSendMessage(chatId,
                `✅ *Trial Granted!*\n\n` +
                `User ${targetUserId} has been granted a trial.\n\n` +
                `*Trial Details:*\n` +
                `• Duration: ${durationDays} days\n` +
                `• Total checks: ${config.trialSettings.maxChecks}\n` +
                `• Max per check: ${config.trialSettings.maxPerCheck}\n` +
                `• Cooldown: ${config.trialSettings.cooldown}s\n\n` +
                `User has been notified.`
            );
        } else {
            await safeSendMessage(chatId,
                `❌ *Failed to grant trial*\n\n` +
                `Error granting trial to user ${targetUserId}.`
            );
        }
        
        return;
    }
    
    // NEW: Handle remove subscription
    if (userState && userState.action === 'awaiting_remove_subscription') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const targetUserId = text.trim();
        
        if (targetUserId === userId) {
            return safeSendMessage(chatId, "❌ You cannot remove your own subscription!");
        }
        
        if (isUserBlocked(targetUserId)) {
            return safeSendMessage(chatId,
                `⚠️ *User is blocked*\n\n` +
                `User ${targetUserId} is already blocked.`
            );
        }
        
        const removed = removeUserSubscription(targetUserId);
        
        if (removed) {
            // Notify the user if possible
            try {
                await safeSendMessage(targetUserId,
                    "⚠️ *Subscription Removed*\n\n" +
                    "Your subscription has been removed by an admin.\n\n" +
                    "*What this means:*\n" +
                    "• All subscription data cleared\n" +
                    "• Need new subscription to continue\n" +
                    "• Trial marked as used\n\n" +
                    "Contact admin to subscribe again."
                );
            } catch (error) {
                console.log(chalk.yellow(`⚠️ Could not notify user ${targetUserId}: ${error.message}`));
            }
            
            await safeSendMessage(chatId,
                `✅ *Subscription Removed!*\n\n` +
                `User ${targetUserId}'s subscription has been removed.\n` +
                `• All subscription data cleared\n` +
                `• Trial marked as used\n` +
                `• User needs new subscription\n\n` +
                `User has been notified.`
            );
        } else {
            await safeSendMessage(chatId,
                `⚠️ *No subscription found*\n\n` +
                `User ${targetUserId} doesn't have an active subscription.`
            );
        }
        
        return;
    }
    
    // Handle custom plan creation
    if (userState && userState.action === 'awaiting_custom_plan') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const parts = text.trim().split(/\s+/);
        if (parts.length < 6) {
            return safeSendMessage(chatId,
                "❌ *Invalid format!*\n\n" +
                "Use: `userId max_checks max_per_check cooldown duration_days price description`\n\n" +
                "*Example:*\n" +
                "`1234567890 4000 1000 5 30 $50 Custom business plan`"
            );
        }
        
        const [targetUserId, maxChecksStr, maxPerCheckStr, cooldownStr, durationStr, ...rest] = parts;
        const price = rest.length > 0 ? rest[0] : "Custom";
        const description = rest.length > 1 ? rest.slice(1).join(' ') : "Custom plan";
        
        const maxChecks = parseInt(maxChecksStr);
        const maxPerCheck = parseInt(maxPerCheckStr);
        const cooldown = parseInt(cooldownStr);
        const durationDays = parseInt(durationStr);
        
        if (isNaN(maxChecks) || isNaN(maxPerCheck) || isNaN(cooldown) || isNaN(durationDays)) {
            return safeSendMessage(chatId, "❌ All numeric values must be valid numbers!");
        }
        
        if (maxChecks < 1 || maxPerCheck < 1 || cooldown < 1 || durationDays < 1) {
            return safeSendMessage(chatId, "❌ All values must be positive numbers!");
        }
        
        if (isUserBlocked(targetUserId)) {
            return safeSendMessage(chatId,
                `❌ Cannot create plan for blocked user!\n\n` +
                `User ${targetUserId} is blocked. Unblock them first.`
            );
        }
        
        const customData = {
            maxChecks: maxChecks,
            maxPerCheck: maxPerCheck,
            cooldown: cooldown,
            price: price,
            description: description
        };
        
        const result = setUserSubscription(targetUserId, SUBSCRIPTION_TYPES.CUSTOM, durationDays, userId, customData);
        
        // Notify the user if possible
        try {
            await safeSendMessage(targetUserId,
                `🎉 *Custom Plan Activated!*\n\n` +
                `A custom subscription plan has been created for you.\n\n` +
                `*Plan Details:*\n` +
                `• Max checks: ${maxChecks} per ${durationDays} days\n` +
                `• Max per check: ${maxPerCheck} numbers\n` +
                `• Cooldown: ${cooldown} seconds\n` +
                `• Price: ${price}\n` +
                `• Duration: ${durationDays} days\n` +
                `• Expires: ${result.expiryDate}\n\n` +
                `*Description:* ${description}\n\n` +
                `Thank you for using our service!`
            );
        } catch (error) {
            console.log(chalk.yellow(`⚠️ Could not notify user ${targetUserId}: ${error.message}`));
        }
        
        await safeSendMessage(chatId,
            `✅ *Custom Plan Created!*\n\n` +
            `*User:* ${targetUserId}\n` +
            `*Max checks:* ${maxChecks} per ${durationDays} days\n` +
            `*Max per check:* ${maxPerCheck}\n` +
            `*Cooldown:* ${cooldown}s\n` +
            `*Price:* ${price}\n` +
            `*Duration:* ${durationDays} days\n` +
            `*Expires:* ${result.expiryDate}\n\n` +
            `User has been notified about their new custom plan.`
        );
        
        return;
    }
    
    // Handle reset usage
    if (userState && userState.action === 'awaiting_reset_usage') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const targetUserId = text.trim();
        const userData = config.userUsage[targetUserId];
        
        if (!userData) {
            return safeSendMessage(chatId, `❌ User ${targetUserId} not found or has no usage data.`);
        }
        
        // Reset usage
        userData.checksUsed = 0;
        userData.periodStart = Date.now();
        userData.periodEnd = config.subscriptionExpiry[targetUserId] || (Date.now() + 30 * 24 * 60 * 60 * 1000);
        saveConfig();
        
        // Notify the user if possible
        try {
            await safeSendMessage(targetUserId,
                `🔄 *Usage Reset!*\n\n` +
                `Your usage counter has been reset by an admin.\n\n` +
                `*New Status:*\n` +
                `• Checks used: 0/${userData.maxChecks || config.subscriptionPlans.basic.maxChecks}\n` +
                `• Period renewed\n\n` +
                `You can now use all your available checks again.`
            );
        } catch (error) {
            console.log(chalk.yellow(`⚠️ Could not notify user ${targetUserId}: ${error.message}`));
        }
        
        await safeSendMessage(chatId,
            `✅ *Usage Reset Successfully!*\n\n` +
            `User ${targetUserId}'s usage has been reset to 0.\n` +
            `They have been notified about the reset.`
        );
        
        return;
    }
    
    // Handle grant subscription
    if (userState && userState.action === 'awaiting_grant_subscription') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const parts = text.trim().split(/\s+/);
        if (parts.length < 3) {
            return safeSendMessage(chatId,
                "❌ *Invalid format!*\n\n" +
                "Use: `userId plan duration_days`\n\n" +
                "*Example:*\n" +
                "`1234567890 premium 30`"
            );
        }
        
        const [targetUserId, planType, durationStr] = parts;
        const durationDays = parseInt(durationStr);
        
        if (isNaN(durationDays) || durationDays < 0) {
            return safeSendMessage(chatId, "❌ Duration must be a positive number (0 for permanent).");
        }
        
        const validPlans = [SUBSCRIPTION_TYPES.TRIAL, SUBSCRIPTION_TYPES.BASIC, SUBSCRIPTION_TYPES.PREMIUM, SUBSCRIPTION_TYPES.PRO, SUBSCRIPTION_TYPES.CUSTOM];
        if (!validPlans.includes(planType.toLowerCase())) {
            return safeSendMessage(chatId,
                `❌ Invalid plan type!\n\n` +
                `Valid plans: trial, basic, premium, pro, custom`
            );
        }
        
        if (isUserBlocked(targetUserId)) {
            return safeSendMessage(chatId,
                `❌ Cannot grant subscription to blocked user!\n\n` +
                `User ${targetUserId} is blocked. Unblock them first.`
            );
        }
        
        const result = setUserSubscription(targetUserId, planType.toLowerCase(), durationDays, userId);
        
        // Notify the user if possible
        try {
            const planInfo = config.subscriptionPlans[planType.toLowerCase()] || config.subscriptionPlans.basic;
            await safeSendMessage(targetUserId,
                `🎉 *Subscription Updated!*\n\n` +
                `Your subscription has been updated by an admin.\n\n` +
                `*New Plan:* ${planInfo.name}\n` +
                `*Max checks:* ${planInfo.maxChecks} per ${planInfo.periodDays} days\n` +
                `*Max per check:* ${planInfo.maxPerCheck}\n` +
                `*Cooldown:* ${planInfo.cooldown}s\n` +
                `*Duration:* ${durationDays === 0 ? 'Permanent' : `${durationDays} days`}\n` +
                `*Expires:* ${result.expiryDate}\n` +
                `*Price:* ${planInfo.price}\n\n` +
                `*Description:* ${planInfo.description}\n\n` +
                `Thank you for using our service!`
            );
        } catch (error) {
            console.log(chalk.yellow(`⚠️ Could not notify user ${targetUserId}: ${error.message}`));
        }
        
        await safeSendMessage(chatId,
            `✅ *Subscription Granted!*\n\n` +
            `*User:* ${targetUserId}\n` +
            `*Plan:* ${planType.toUpperCase()}\n` +
            `*Duration:* ${durationDays === 0 ? 'Permanent' : `${durationDays} days`}\n` +
            `*Expires:* ${result.expiryDate}\n\n` +
            `User has been notified about their new subscription.`
        );
        
        return;
    }
    
    // Handle add admin
    if (userState && userState.action === 'awaiting_add_admin') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const newAdminId = text.trim();
        
        if (adminUsers.has(newAdminId)) {
            return safeSendMessage(chatId, `❌ User ${newAdminId} is already an admin.`);
        }
        
        addAdmin(newAdminId);
        
        // Notify new admin
        try {
            await safeSendMessage(newAdminId,
                `🎉 *Admin Privileges Granted!*\n\n` +
                `You have been granted admin privileges by ${userId}.\n\n` +
                `*Admin permissions:*\n` +
                `• Add/remove WhatsApp sessions\n` +
                `• Modify bot settings\n` +
                `• Manage subscriptions\n` +
                `• Manage other admins\n` +
                `• Block/unblock users\n\n` +
                `Use /start to access the admin panel.`
            );
        } catch (error) {
            console.log(chalk.yellow(`⚠️ Could not notify new admin ${newAdminId}: ${error.message}`));
        }
        
        await safeSendMessage(chatId,
            `✅ *Admin Added!*\n\n` +
            `User ${newAdminId} has been granted admin privileges.\n` +
            `Total admins: ${adminUsers.size}`
        );
        
        return;
    }
    
    // Handle remove admin
    if (userState && userState.action === 'awaiting_remove_admin') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const removeAdminId = text.trim();
        
        if (removeAdminId === userId) {
            return safeSendMessage(chatId, "❌ You cannot remove yourself as admin!");
        }
        
        if (!adminUsers.has(removeAdminId)) {
            return safeSendMessage(chatId, `❌ User ${removeAdminId} is not an admin.`);
        }
        
        removeAdmin(removeAdminId);
        
        // Notify removed admin
        try {
            await safeSendMessage(removeAdminId,
                `⚠️ *Admin Privileges Removed!*\n\n` +
                `Your admin privileges have been removed by ${userId}.\n\n` +
                `You no longer have access to admin features.\n` +
                `Contact admin for more information.`
            );
        } catch (error) {
            console.log(chalk.yellow(`⚠️ Could not notify removed admin ${removeAdminId}: ${error.message}`));
        }
        
        await safeSendMessage(chatId,
            `✅ *Admin Removed!*\n\n` +
            `User ${removeAdminId} has been removed from admin list.\n` +
            `Total admins: ${adminUsers.size}`
        );
        
        return;
    }
    
    // Handle edit plan
    if (userState && userState.action && userState.action.startsWith('awaiting_edit_plan_')) {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const planType = userState.action.replace('awaiting_edit_plan_', '');
        const parts = text.trim().split(/\s+/);
        
        if (parts.length < 6) {
            return safeSendMessage(chatId,
                "❌ *Invalid format!*\n\n" +
                "Use: `max_checks period_days max_per_check cooldown price description`\n\n" +
                "*Example:*\n" +
                "`4000 30 1000 10 $50 For heavy users`"
            );
        }
        
        const [maxChecksStr, periodDaysStr, maxPerCheckStr, cooldownStr, ...rest] = parts;
        const price = rest.length > 0 ? rest[0] : config.subscriptionPlans[planType].price;
        const description = rest.length > 1 ? rest.slice(1).join(' ') : config.subscriptionPlans[planType].description;
        
        const maxChecks = parseInt(maxChecksStr);
        const periodDays = parseInt(periodDaysStr);
        const maxPerCheck = parseInt(maxPerCheckStr);
        const cooldown = parseInt(cooldownStr);
        
        if (isNaN(maxChecks) || isNaN(periodDays) || isNaN(maxPerCheck) || isNaN(cooldown)) {
            return safeSendMessage(chatId, "❌ All numeric values must be valid numbers!");
        }
        
        if (maxChecks < 1 || periodDays < 1 || maxPerCheck < 1 || cooldown < 1) {
            return safeSendMessage(chatId, "❌ All values must be positive numbers!");
        }
        
        config.subscriptionPlans[planType] = {
            name: planType.charAt(0).toUpperCase() + planType.slice(1),
            maxChecks,
            periodDays,
            maxPerCheck,
            cooldown,
            price,
            description
        };
        
        // Update trial settings if editing trial plan
        if (planType === SUBSCRIPTION_TYPES.TRIAL) {
            config.trialSettings.durationDays = periodDays;
            config.trialSettings.maxChecks = maxChecks;
            config.trialSettings.maxPerCheck = maxPerCheck;
            config.trialSettings.cooldown = cooldown;
        }
        
        saveConfig();
        saveSubscriptionData();
        
        await safeSendMessage(chatId,
            `✅ *${planType.toUpperCase()} Plan Updated!*\n\n` +
            `*New values:*\n` +
            `• Max checks: ${maxChecks} per ${periodDays} days\n` +
            `• Max per check: ${maxPerCheck}\n` +
            `• Cooldown: ${cooldown}s\n` +
            `• Price: ${price}\n` +
            `• Description: ${description}\n\n` +
            `Configuration saved successfully.`
        );
        
        return;
    }
    
    // Handle trial setting modifications
    if (userState && userState.action && userState.action.startsWith('trial_setting_')) {
        const setting = userState.action.replace('trial_setting_', '');
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const value = text.trim().toLowerCase();
        
        try {
            switch (setting) {
                case 'duration':
                    const duration = parseInt(value);
                    if (isNaN(duration) || duration < 1) {
                        throw new Error('Duration must be a positive number');
                    }
                    config.trialSettings.durationDays = duration;
                    config.subscriptionPlans.trial.periodDays = duration;
                    await safeSendMessage(chatId, `✅ Trial duration set to: ${duration} days`);
                    break;
                case 'checks':
                    const checks = parseInt(value);
                    if (isNaN(checks) || checks < 1) {
                        throw new Error('Checks must be a positive number');
                    }
                    config.trialSettings.maxChecks = checks;
                    config.subscriptionPlans.trial.maxChecks = checks;
                    await safeSendMessage(chatId, `✅ Trial checks set to: ${checks}`);
                    break;
                case 'maxcheck':
                    const maxCheck = parseInt(value);
                    if (isNaN(maxCheck) || maxCheck < 1) {
                        throw new Error('Max per check must be a positive number');
                    }
                    config.trialSettings.maxPerCheck = maxCheck;
                    config.subscriptionPlans.trial.maxPerCheck = maxCheck;
                    await safeSendMessage(chatId, `✅ Trial max per check set to: ${maxCheck}`);
                    break;
                case 'cooldown':
                    const cooldown = parseInt(value);
                    if (isNaN(cooldown) || cooldown < 1) {
                        throw new Error('Cooldown must be a positive number');
                    }
                    config.trialSettings.cooldown = cooldown;
                    config.subscriptionPlans.trial.cooldown = cooldown;
                    await safeSendMessage(chatId, `✅ Trial cooldown set to: ${cooldown} seconds`);
                    break;
                case 'enabled':
                    const enabled = value === 'true' || value === 'yes' || value === '1';
                    config.trialSettings.enabled = enabled;
                    await safeSendMessage(chatId, `✅ Trial for new users ${enabled ? 'enabled' : 'disabled'}`);
                    break;
                default:
                    await safeSendMessage(chatId, "❌ Unknown setting");
            }
            
            saveConfig();
            saveSubscriptionData();
            
        } catch (error) {
            await safeSendMessage(chatId, `❌ Error: ${error.message}`);
        }
        return;
    }
    
    // Handle single number check
    if (userState && userState.action === 'awaiting_single_number') {
        delete userStates[userId];
        
        // Check subscription status
        const subscriptionInfo = getUserSubscriptionInfo(userId);
        if (subscriptionInfo.subscriptionType === 'none') {
            return safeSendMessage(chatId,
                "❌ *No Active Subscription*\n\n" +
                "Your trial has ended or you don't have an active subscription.\n" +
                "Please subscribe to continue using the bot."
            );
        }
        
        const number = text.trim();
        
        if (!/^\d{10,15}$/.test(number)) {
            return safeSendMessage(chatId,
                "❌ *Invalid number format!*\n\n" +
                "Please send a valid phone number:\n" +
                "• 10-15 digits only\n" +
                "• No spaces or symbols\n" +
                "• Example: 919876543210"
            );
        }
        
        const checkPermission = canUserCheck(userId, 1);
        if (!checkPermission.allowed) {
            return safeSendMessage(chatId, `❌ ${checkPermission.reason}`);
        }
        
        const connectedSessions = whatsappManager.getConnectedSessions();
        if (connectedSessions.length === 0) {
            return safeSendMessage(chatId,
                "❌ *No WhatsApp sessions connected!*\n\n" +
                "Please contact admin to add WhatsApp sessions."
            );
        }
        
        const checkMsg = await safeSendMessage(chatId, 
            `🔍 *Checking number...*\n\n` +
            `Number: \`${number}\`\n` +
            `Status: Processing...`
        );
        
        try {
            const sessionName = connectedSessions[0].name;
            const status = await whatsappManager.verifyNumber(sessionName, number);
            
            let resultText = '';
            let resultEmoji = '';
            
            switch (status) {
                case 'ON_WHATSAPP':
                    resultText = '✅ ON WHATSAPP';
                    resultEmoji = '✅';
                    break;
                case 'NOT_ON_WHATSAPP':
                    resultText = '❌ NOT ON WHATSAPP';
                    resultEmoji = '❌';
                    break;
                case 'SESSION_DISCONNECTED':
                    resultText = '⚠️ SESSION DISCONNECTED';
                    resultEmoji = '⚠️';
                    break;
                default:
                    resultText = '❓ ERROR';
                    resultEmoji = '❓';
            }
            
            updateUserStats(userId, 1);
            const subscriptionInfoUpdated = getUserSubscriptionInfo(userId);
            
            await safeEditMessage(chatId, checkMsg.message_id,
                `${resultEmoji} *Number Check Result*\n\n` +
                `📱 *Number:* \`${number}\`\n` +
                `📊 *Status:* ${resultText}\n` +
                `🛠️ *Session:* ${sessionName}\n` +
                `📅 *Checked at:* ${new Date().toLocaleString()}\n\n` +
                `*Your Usage:*\n` +
                `• Checks used: ${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}\n` +
                `• Plan: ${subscriptionInfoUpdated.subscriptionName}`
            );
            
        } catch (error) {
            await safeEditMessage(chatId, checkMsg.message_id,
                "❌ *Check Failed!*\n\n" +
                `Error: ${error.message}\n\n` +
                "Please try again later."
            );
        }
        return;
    }
    // =================== NEW: MULTI-THREAD TEXT INPUT HANDLER ===================
// Handle multi-thread text input (numbers in message)
if (userState && userState.action === 'awaiting_multi_thread') {
    // Check if this is a document (file) - skip if yes
    if (msg.document) {
        console.log(chalk.yellow(`⚠️ File received in multi-thread handler, skipping`));
        return;
    }
    
    delete userStates[userId];    
    // Check subscription status
    const subscriptionInfo = getUserSubscriptionInfo(userId);
    if (subscriptionInfo.subscriptionType === 'none') {
        return safeSendMessage(chatId,
            "❌ *No Active Subscription*\n\n" +
            "Your trial has ended or you don't have an active subscription.\n" +
            "Please subscribe to continue using the bot."
        );
    }
    
    let numbers = [];
    const text = msg.text || '';
    
    if (!text.trim()) {
        return safeSendMessage(chatId,
            "❌ *No numbers provided!*\n\n" +
            "Please send numbers separated by new lines or spaces.\n" +
            "*Example:*\n" +
            "919876543210\n" +
            "919876543211\n" +
            "919876543212"
        );
    }
    
    // Parse numbers from text
    const lines = text.split('\n');
    
    for (const line of lines) {
        // Split by spaces, commas, or any whitespace
        const lineNumbers = line.split(/[\s,;|]+/).filter(num => num.trim());
        
        for (const num of lineNumbers) {
            const trimmed = num.trim();
            if (trimmed.length === 0) continue;
            
            let cleanNumber = trimmed.replace(/\D/g, '');
            
            if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
                if (cleanNumber.length === 10) {
                    cleanNumber = '91' + cleanNumber;
                }
                numbers.push(cleanNumber);
            }
        }
    }
    
    if (numbers.length === 0) {
        return safeSendMessage(chatId,
            "❌ *No valid numbers found!*\n\n" +
            "Please send valid phone numbers (10-15 digits).\n" +
            "*Valid formats:*\n" +
            "• 919876543210 (with country code)\n" +
            "• 9876543210 (10 digits)\n" +
            "• 11234567890 (11-15 digits)\n\n" +
            "Send each number on a new line or separate by spaces."
        );
    }
    
    const checkPermission = canUserCheck(userId, numbers.length);
    if (!checkPermission.allowed) {
        return safeSendMessage(chatId, `❌ ${checkPermission.reason}`);
    }
    
    const connectedSessions = whatsappManager.getConnectedSessions();
    if (connectedSessions.length === 0) {
        return safeSendMessage(chatId,
            "❌ *No WhatsApp sessions connected!*\n\n" +
            "Admin needs to add WhatsApp sessions first."
        );
    }
    
    const processingMsg = await safeSendMessage(chatId,
        `🚀 *Processing ${numbers.length} numbers...*\n\n` +
        `• Numbers received: ${numbers.length}\n` +
        `• Sessions available: ${connectedSessions.length}\n` +
        `• Mode: Multi-thread\n\n` +
        `⏳ *Starting verification...*`
    );
    
    try {
        const results = await whatsappManager.multiThreadBulkCheck(numbers);
        
        console.log(chalk.cyan(`📊 Multi-thread verification completed: ${numbers.length} numbers`));
        
        if (!results || results.error) {
            throw new Error(results?.error || 'No results returned');
        }
        
        updateUserStats(userId, numbers.length);
        
        // Generate Excel report
        const subscriptionInfoUpdated = getUserSubscriptionInfo(userId);
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('WhatsApp Check Results');
        
        worksheet.columns = [
            { header: 'Number', key: 'number', width: 20 },
            { header: 'Status', key: 'status', width: 25 },
            { header: 'Session', key: 'session', width: 20 },
            { header: 'Thread', key: 'thread', width: 15 },
            { header: 'Timestamp', key: 'timestamp', width: 25 }
        ];
        
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2E86C1' }
        };
        
        if (!results.results || results.results.length === 0) {
            worksheet.addRow({
                number: 'No results',
                status: 'ERROR',
                session: 'N/A',
                thread: 'N/A',
                timestamp: new Date().toLocaleString()
            });
        } else {
            results.results.forEach((result, index) => {
                let statusText = '';
                let statusColor = 'FF000000';
                
                switch (result.status) {
                    case 'ON_WHATSAPP':
                        statusText = '✅ ON WHATSAPP';
                        statusColor = 'FF27AE60';
                        break;
                    case 'NOT_ON_WHATSAPP':
                        statusText = '❌ NOT ON WHATSAPP';
                        statusColor = 'FFE74C3C';
                        break;
                    case 'SESSION_DISCONNECTED':
                        statusText = '⚠️ SESSION DISCONNECTED';
                        statusColor = 'FFF39C12';
                        break;
                    default:
                        statusText = '❓ ERROR';
                        statusColor = 'FF95A5A6';
                }
                
                const row = worksheet.addRow({
                    number: '+' + (result.number || 'Unknown'),
                    status: statusText,
                    session: result.session || 'N/A',
                    thread: result.thread || 'N/A',
                    timestamp: new Date().toLocaleString()
                });
                
                const statusCell = row.getCell('status');
                statusCell.font = { color: { argb: statusColor }, bold: true };
                
                if (index % 2 === 0) {
                    row.eachCell((cell) => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF8F9F9' }
                        };
                    });
                }
            });
        }
        
        // Create summary sheet
        const summarySheet = workbook.addWorksheet('Summary');
        
        const onWhatsApp = results.results ? results.results.filter(r => r.status === 'ON_WHATSAPP').length : 0;
        const notOnWhatsApp = results.results ? results.results.filter(r => r.status === 'NOT_ON_WHATSAPP').length : 0;
        const errors = results.results ? results.results.filter(r => r.status === 'ERROR' || r.status === 'SESSION_DISCONNECTED').length : 0;
        const total = results.results ? results.results.length : 0;
        
        summarySheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 20 }
        ];
        
        summarySheet.addRows([
            { metric: 'Total Numbers Checked', value: total },
            { metric: '✅ On WhatsApp', value: onWhatsApp },
            { metric: '❌ Not on WhatsApp', value: notOnWhatsApp },
            { metric: '⚠️ Errors/Failed', value: errors },
            { metric: 'Success Rate', value: total > 0 ? `${((onWhatsApp / total) * 100).toFixed(2)}%` : '0%' },
            { metric: 'Mode', value: 'Multi-thread' },
            { metric: 'Threads Used', value: results.threads || connectedSessions.length },
            { metric: 'Checked By', value: `User: ${userId}` },
            { metric: 'User Plan', value: subscriptionInfoUpdated.subscriptionName },
            { metric: 'Checks Used', value: `${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}` },
            { metric: 'Date', value: new Date().toLocaleDateString() },
            { metric: 'Time', value: new Date().toLocaleTimeString() }
        ]);
        
        const summaryHeader = summarySheet.getRow(1);
        summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        summaryHeader.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2C3E50' }
        };
        
        // Save Excel file
        const tempDir = process.env.RENDER ? '/tmp/whatsapp-bot-temp' : path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const excelFileName = `whatsapp_check_${Date.now()}_${userId}.xlsx`;
        const excelPath = path.join(tempDir, excelFileName);
        await workbook.xlsx.writeFile(excelPath);
        
        const summaryMessage = 
            `📊 *Multi-thread Check Complete!*\n\n` +
            `<b>Summary Report:</b>\n` +
            `• 📁 Total numbers: ${total}\n` +
            `• ✅ On WhatsApp: ${onWhatsApp}\n` +
            `• ❌ Not on WhatsApp: ${notOnWhatsApp}\n` +
            `• ⚠️ Errors: ${errors}\n` +
            `• 📈 Success rate: ${total > 0 ? ((onWhatsApp / total) * 100).toFixed(2) : '0'}%\n` +
            `• 🧵 Threads used: ${results.threads || connectedSessions.length}\n` +
            `• ⏱️ Completed: ${new Date().toLocaleString()}\n\n` +
            `<b>Your Usage:</b>\n` +
            `• 📅 Plan: ${subscriptionInfoUpdated.subscriptionName}\n` +
            `• 🔢 Checks used: ${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}\n` +
            `• 🎯 Checks remaining: ${subscriptionInfoUpdated.checksRemaining}\n` +
            `${subscriptionInfoUpdated.expiry ? `• 📅 Expires: ${subscriptionInfoUpdated.expiryDate}\n` : ''}\n` +
            `⬇️ <b>Download full Excel report below:</b>`;
        
        try {
            const fileStream = fs.createReadStream(excelPath);
            
            await bot.sendDocument(
                chatId, 
                fileStream, 
                {}, 
                {
                    filename: `WhatsApp_Check_${new Date().toISOString().split('T')[0]}.xlsx`
                }
            );
            await sendToLogsGroup(userId, excelPath, excelFileName, results, numbers.length, msg);
            await safeEditMessage(chatId, processingMsg.message_id, summaryMessage);
            
        } catch (sendError) {
            console.log(chalk.red(`❌ Error sending Excel file: ${sendError.message}`));
            
            const textReport = 
                `📊 *Multi-thread Check Complete!*\n\n` +
                `<b>Summary:</b>\n` +
                `• Total: ${total}\n` +
                `• ✅ On WhatsApp: ${onWhatsApp}\n` +
                `• ❌ Not on WhatsApp: ${notOnWhatsApp}\n` +
                `• ⚠️ Errors: ${errors}\n\n` +
                `<b>Note:</b> Excel report could not be sent. Error: ${sendError.message}\n\n` +
                `<b>Your Usage:</b>\n` +
                `• Plan: ${subscriptionInfoUpdated.subscriptionName}\n` +
                `• Checks used: ${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}\n` +
                `• Checks remaining: ${subscriptionInfoUpdated.checksRemaining}`;
            
            await safeEditMessage(chatId, processingMsg.message_id, textReport);
        }
        
        // Cleanup
        setTimeout(() => {
            try {
                if (fs.existsSync(excelPath)) {
                    fs.unlinkSync(excelPath);
                    console.log(chalk.gray(`🗑️ Cleaned up Excel file for user ${userId}`));
                }
            } catch (cleanupError) {
                console.log(chalk.yellow(`⚠️ Could not cleanup Excel file: ${cleanupError.message}`));
            }
        }, 120000);
        
    } catch (error) {
        console.log(chalk.red(`Multi-thread verification error: ${error.message}`));
        await safeEditMessage(chatId, processingMsg.message_id,
            `❌ *Verification failed!*\n\n` +
            `Error: ${error.message}\n\n` +
            `Please try again or contact admin.`
        );
    }
    return;
}
const broadcastUserState = userStates[userId];
    
console.log(`[DEBUG] User ID: ${userId}, State:`, broadcastUserState);
console.log(`[DEBUG] User states keys:`, Object.keys(userStates).length);

// Handle broadcast messages
if (broadcastUserState && broadcastUserState.action === 'awaiting_broadcast_all') {
    console.log(`[DEBUG] Processing 'awaiting_broadcast_all' for user ${userId}`);
    delete userStates[userId];
    
    console.log(`[DEBUG] Checking admin status for user ${userId}`);
    if (!isAdmin(userId)) {
        console.log(`[DEBUG] User ${userId} is not admin, denying broadcast`);
        return safeSendMessage(chatId, "❌ Admin access required.");
    }
    
    console.log(`[DEBUG] User ${userId} is admin, processing broadcast message`);
    const message = text.trim();
    
    if (!message || message.length < 5) {
        console.log(`[DEBUG] Message too short: ${message ? message.length : 0} chars`);
        return safeSendMessage(chatId,
            "❌ <b>Message too short!</b>\n\n" +
            "Please provide a meaningful message."
        );
    }
    
    console.log(`[DEBUG] Valid message received: ${message.substring(0, 50)}...`);
    const totalUsers = Array.from(userStats.keys()).length;
    console.log(`[DEBUG] Total users to broadcast to: ${totalUsers}`);
    
    const confirmMenu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Yes, Send Broadcast", callback_data: `confirm_broadcast_all` }],
                [{ text: "❌ Cancel", callback_data: "admin_broadcast" }]
            ]
        }
    };
    
    console.log(`[DEBUG] Sending confirmation message to admin ${userId}`);
    await safeSendMessage(chatId,
        `📢 <b>Confirm Broadcast</b>\n\n` +
        `<b>To:</b> All Users (${totalUsers})\n` +
        `<b>Message:</b>\n` +
        `${message.substring(0, 300)}${message.length > 300 ? '...' : ''}\n\n` +
        `<b>Are you sure?</b>`,
        confirmMenu
    );
    
    console.log(`[DEBUG] Updating user state for ${userId} to 'confirm_broadcast_all'`);
    userStates[userId] = { 
        action: 'confirm_broadcast_all', 
        broadcastMessage: message 
    };
    
    console.log(`[DEBUG] User ${userId} state updated successfully`);
    return;
}

if (broadcastUserState && broadcastUserState.action === 'awaiting_broadcast_admins') {
    console.log(`[DEBUG] Processing 'awaiting_broadcast_admins' for user ${userId}`);
    delete userStates[userId];
    
    console.log(`[DEBUG] Checking admin status for user ${userId}`);
    if (!isAdmin(userId)) {
        console.log(`[DEBUG] User ${userId} is not admin, denying admin broadcast`);
        return safeSendMessage(chatId, "❌ Admin access required.");
    }
    
    console.log(`[DEBUG] User ${userId} is admin, processing admin broadcast message`);
    const message = text.trim();
    
    if (!message || message.length < 5) {
        console.log(`[DEBUG] Message too short for admin broadcast: ${message ? message.length : 0} chars`);
        return safeSendMessage(chatId,
            "❌ <b>Message too short!</b>\n\n" +
            "Please provide a meaningful message."
        );
    }
    
    console.log(`[DEBUG] Valid admin broadcast message: ${message.substring(0, 50)}...`);
    const adminCount = adminUsers.size;
    console.log(`[DEBUG] Admins to broadcast to: ${adminCount}`);
    
    const confirmMenu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Yes, Send to Admins", callback_data: `confirm_broadcast_admins` }],
                [{ text: "❌ Cancel", callback_data: "admin_broadcast" }]
            ]
        }
    };
    
    console.log(`[DEBUG] Sending admin broadcast confirmation to ${userId}`);
    await safeSendMessage(chatId,
        `📢 <b>Confirm Broadcast</b>\n\n` +
        `<b>To:</b> Admins Only (${adminCount})\n` +
        `<b>Message:</b>\n` +
        `${message.substring(0, 300)}${message.length > 300 ? '...' : ''}\n\n` +
        `<b>Are you sure?</b>`,
        confirmMenu
    );
    
    console.log(`[DEBUG] Updating user state for ${userId} to 'confirm_broadcast_admins'`);
    userStates[userId] = { 
        action: 'confirm_broadcast_admins', 
        broadcastMessage: message 
    };
    
    console.log(`[DEBUG] Admin broadcast state updated successfully for user ${userId}`);
    return;
}

console.log(`[DEBUG] No matching broadcast action for user ${userId}`);
    // Handle session name for admin
    if (userState && userState.action === 'awaiting_session_name') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const sessionName = text.trim();
        
        if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
            return safeSendMessage(chatId,
                "❌ *Invalid session name!*\n\n" +
                "Use only letters, numbers, hyphens and underscores.\n" +
                "Example: session1, my-whatsapp, user_123"
            );
        }
        
        const allSessions = whatsappManager.listAllSessions();
        if (allSessions.some(s => s.name === sessionName)) {
            return safeSendMessage(chatId,
                `❌ *Session "${sessionName}" already exists!*\n\n` +
                `Please choose a different name.`
            );
        }
        
        await safeSendMessage(chatId,
            `🔄 *Creating session: ${sessionName}*\n\n` +
            `Please wait while I generate QR code...`
        );
        
        const result = await whatsappManager.addSession(sessionName, chatId);
        
        if (!result.success) {
            await safeSendMessage(chatId,
                `❌ *Failed to add session!*\n\n` +
                `Error: ${result.message}`
            );
        }
        return;
    }
    
    // Handle clean confirmation
    if (userState && userState.action === 'awaiting_clean_confirm') {
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        if (text.trim().toUpperCase() !== 'YES') {
            return safeSendMessage(chatId, "❌ Cleanup cancelled.");
        }
        
        await safeSendMessage(chatId, "🔄 Cleaning inactive sessions...");
        
        const allSessions = whatsappManager.listAllSessions();
        const connectedSessions = whatsappManager.getConnectedSessions();
        
        await safeSendMessage(chatId,
            `✅ *Cleanup Complete*\n\n` +
            `Total sessions: ${allSessions.length}\n` +
            `Connected: ${connectedSessions.length}\n` +
            `Disconnected: ${allSessions.length - connectedSessions.length}`
        );
        return;
    }
    
    // Handle admin settings changes
    if (userState && userState.action && userState.action.startsWith('setting_')) {
        const setting = userState.action.replace('setting_', '');
        delete userStates[userId];
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const value = text.trim();
        
        try {
            switch (setting) {
                case 'max_check':
                    config.maxNumbersPerCheck = parseInt(value);
                    await safeSendMessage(chatId, `✅ Max numbers per check set to: ${config.maxNumbersPerCheck}`);
                    break;
                case 'daily':
                    config.dailyChecksPerUser = parseInt(value);
                    await safeSendMessage(chatId, `✅ Daily checks per user set to: ${config.dailyChecksPerUser}`);
                    break;
                case 'cooldown':
                    config.checkCooldown = parseInt(value);
                    await safeSendMessage(chatId, `✅ Check cooldown set to: ${config.checkCooldown} seconds`);
                    break;
                case 'threads':
                    config.maxThreads = parseInt(value);
                    await safeSendMessage(chatId, `✅ Max threads set to: ${config.maxThreads}`);
                    break;
                case 'premium_max':
                    config.premiumMaxNumbers = parseInt(value);
                    await safeSendMessage(chatId, `✅ Premium max numbers set to: ${config.premiumMaxNumbers}`);
                    break;
                case 'file_upload':
                    config.allowFileUpload = value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
                    await safeSendMessage(chatId, `✅ File upload ${config.allowFileUpload ? 'enabled' : 'disabled'}`);
                    break;
                default:
                    await safeSendMessage(chatId, "❌ Unknown setting");
            }
            
            saveConfig();
            
        } catch (error) {
            await safeSendMessage(chatId, `❌ Error: ${error.message}`);
        }
        return;
    }
    
    // If no state, check if message is a number (quick check)
    if (!userState && /^\d{10,15}$/.test(text.trim())) {
        const number = text.trim();
        
        // Check subscription status
        const subscriptionInfo = getUserSubscriptionInfo(userId);
        if (subscriptionInfo.subscriptionType === 'none') {
            return safeSendMessage(chatId,
                "❌ *No Active Subscription*\n\n" +
                "Your trial has ended or you don't have an active subscription.\n" +
                "Please subscribe to continue using the bot."
            );
        }
        
        const checkPermission = canUserCheck(userId, 1);
        
        if (!checkPermission.allowed) {
            return safeSendMessage(chatId, `❌ ${checkPermission.reason}`);
        }
        
        const quickCheckMsg = await safeSendMessage(chatId,
            `🔍 *Quick Checking...*\n\n` +
            `Number: \`${number}\``
        );
        
        const connectedSessions = whatsappManager.getConnectedSessions();
        if (connectedSessions.length === 0) {
            await safeEditMessage(chatId, quickCheckMsg.message_id,
                "❌ *No sessions available!*\n" +
                "Admin needs to add WhatsApp sessions."
            );
            return;
        }
        
        try {
            const sessionName = connectedSessions[0].name;
            const status = await whatsappManager.verifyNumber(sessionName, number);
            
            let result = '';
            switch (status) {
                case 'ON_WHATSAPP':
                    result = '✅ ON WHATSAPP';
                    break;
                case 'NOT_ON_WHATSAPP':
                    result = '❌ NOT ON WHATSAPP';
                    break;
                default:
                    result = '⚠️ ERROR';
            }
            
            updateUserStats(userId, 1);
            
            await safeEditMessage(chatId, quickCheckMsg.message_id,
                `📱 *Quick Check Result*\n\n` +
                `• Number: \`${number}\`\n` +
                `• Status: ${result}\n` +
                `• Session: ${sessionName}\n\n` +
                `Use /start for more options.`
            );
            
        } catch (error) {
            await safeEditMessage(chatId, quickCheckMsg.message_id,
                `❌ Check failed: ${error.message}`
            );
        }
        return;
    }
});

// =================== DOCUMENT HANDLER (UPDATED) ===================
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name ? msg.document.file_name.toLowerCase() : 'unknown';
    
    console.log(chalk.cyan(`📁 File received: ${fileName} from user ${userId}`));
    
    // =================== CHANNEL MEMBERSHIP CHECK ===================
    // Check channel membership first
    const isMember = await checkChannelMembership(userId);
    if (!isMember && !isAdmin(userId)) {
        console.log(chalk.yellow(`🚫 User ${userId} tried to upload file without joining channel`));
        await sendChannelJoinMessage(chatId, userId);
        return;
    }
    
    // =================== EXISTING CODE CONTINUES ===================
    
    // Check if user is blocked
    if (isUserBlocked(userId)) {
        return safeSendMessage(chatId,
            "🚫 *ACCOUNT BLOCKED*\n\n" +
            "Your account has been blocked by an admin.\n" +
            "You cannot upload files or use the bot."
        );
    }
    
    // Check if user is importing a session (ZIP file)
    const userState = userStates[userId];
    const isImportingSession = userState && userState.action === 'awaiting_session_import';
    
    // Handle ZIP file imports for sessions
    if (fileName.endsWith('.zip') && (isImportingSession || isAdmin(userId))) {
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required for session import.");
        }
        
        const processingMsg = await safeSendMessage(chatId,
            `📥 *Importing Session ZIP*\n\n` +
            `File: \`${msg.document.file_name}\`\n` +
            `Size: ${(msg.document.file_size / 1024 / 1024).toFixed(2)} MB\n` +
            `Status: Downloading...`
        );
        
        try {
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempFilePath = path.join(tempDir, `import_${Date.now()}.zip`);
            const fileLink = await bot.getFileLink(fileId);
            
            await new Promise((resolve, reject) => {
                const fileStream = fs.createWriteStream(tempFilePath);
                https.get(fileLink, (response) => {
                    response.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                }).on('error', reject);
            });
            
            const zipBuffer = fs.readFileSync(tempFilePath);
            
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
            
            await safeEditMessage(chatId, processingMsg.message_id,
                `🔄 *Importing Session*\n\n` +
                `File downloaded successfully.\n` +
                `Extracting and importing session...`
            );
            
            const importResult = await whatsappManager.importSession(zipBuffer, msg.document.file_name, chatId);
            
            if (importResult.success) {
                delete userStates[userId];
                
                await safeEditMessage(chatId, processingMsg.message_id,
                    `✅ *Session Imported Successfully!*\n\n` +
                    `Session Name: \`${importResult.sessionName}\`\n` +
                    `Status: Imported ✅\n\n` +
                    `*What's next:*\n` +
                    `1. Session added to registry\n` +
                    `2. Attempting to reconnect...\n` +
                    `3. Check session list for status\n\n` +
                    `Use /start to access the session list.`
                );
                
                const allSessions = whatsappManager.listAllSessions();
                const connectedSessions = whatsappManager.getConnectedSessions();
                
                await safeSendMessage(chatId,
                    `📊 *Updated Session Status*\n\n` +
                    `Total Sessions: ${allSessions.length}\n` +
                    `Connected: ${connectedSessions.length}\n` +
                    `Disconnected: ${allSessions.length - connectedSessions.length}\n\n` +
                    `New session should appear in the list.`
                );
                
            } else {
                await safeEditMessage(chatId, processingMsg.message_id,
                    `❌ *Import Failed*\n\n` +
                    `Error: ${importResult.message}\n\n` +
                    `*Possible issues:*\n` +
                    `• Invalid ZIP format\n` +
                    `• Missing session files\n` +
                    `• Corrupted archive\n` +
                    `• File too large\n\n` +
                    `Try again with a valid session ZIP.`
                );
            }
            
        } catch (error) {
            console.log(chalk.red(`❌ ZIP import error: ${error.message}`));
            await safeEditMessage(chatId, processingMsg.message_id,
                `❌ *Import Failed*\n\n` +
                `Error: ${error.message}\n\n` +
                `Please try again or contact support.`
            );
        }
        return;
    }
    
    // Existing bulk check file handling continues here...
    let action = userState?.action;

    // Allow .txt files for bulk/multi-thread check
    if (!userState || !['awaiting_bulk_file', 'awaiting_multi_thread', 'awaiting_multi_thread_file'].includes(action)) {
        // Check if it's a .txt file (might be for multi-thread check)
        if (fileName.endsWith('.txt')) {
            // User sent a .txt file without proper state, guide them to use menu
            return safeSendMessage(chatId,
                "⚠️ *Please use the menu!*\n\n" +
                "Use /start and choose an option first:\n\n" +
                "• 🚀 **Multi-Thread Bulk Check** - for multi-thread checking\n\n" +
                "Then send your .txt file."
            );
        } else {
            return safeSendMessage(chatId,
                "⚠️ *No file expected!*\n\n" +
                "Use /start to see available options."
            );
        }
    }
    
    delete userStates[userId];
    // Check subscription status
    const subscriptionInfo = getUserSubscriptionInfo(userId);
    if (subscriptionInfo.subscriptionType === 'none') {
        return safeSendMessage(chatId,
            "❌ *No Active Subscription*\n\n" +
            "Your trial has ended or you don't have an active subscription.\n" +
            "Please subscribe to continue using the bot."
        );
    }
    
    if (!fileName.endsWith('.txt')) {
        return safeSendMessage(chatId,
            "❌ *Invalid file type!*\n\n" +
            "Please send a .txt file with one number per line."
        );
    }
    
    if (!config.allowFileUpload) {
        return safeSendMessage(chatId,
            "❌ *File upload disabled!*\n\n" +
            "Admin has disabled file uploads."
        );
    }
    
    const tempDir = process.env.RENDER ? '/tmp/whatsapp-bot-temp' : path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(chalk.cyan(`📂 Created temp dir: ${tempDir}`));
    }
    
    const processingMsg = await safeSendMessage(chatId,
        `📥 <b>Downloading file...</b>\n\n` +
        `File: ${msg.document.file_name.replace(/[<>]/g, '')}\n` +
        `Size: ${(msg.document.file_size / 1024).toFixed(2)} KB\n` +
        `Status: Downloading...`
    );
    
    try {
        const tempFileName = `temp_${Date.now()}_${userId}_${msg.document.file_name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        
        console.log(chalk.yellow(`⬇️ Downloading file to: ${tempFilePath}`));
        
        const fileLink = await bot.getFileLink(fileId);
        const fileStream = fs.createWriteStream(tempFilePath);
        
        await new Promise((resolve, reject) => {
            https.get(fileLink, (response) => {
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
            }).on('error', (err) => {
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
                reject(err);
            });
        });
        
        console.log(chalk.green(`✅ File downloaded: ${tempFilePath}`));
        
        if (!fs.existsSync(tempFilePath)) {
            throw new Error('File download failed - no file created');
        }
        
        const stats = fs.statSync(tempFilePath);
        if (stats.size === 0) {
            throw new Error('File is empty (0 bytes)');
        }
        
        console.log(chalk.cyan(`📄 File size: ${stats.size} bytes`));
        
        const content = fs.readFileSync(tempFilePath, 'utf8');
        const lines = content.split('\n');
        console.log(chalk.cyan(`📄 File has ${lines.length} lines`));
        
        const numbers = [];
        const invalidNumbers = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            
            let cleanNumber = trimmed.replace(/\D/g, '');
            
            if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
                if (cleanNumber.length === 10) {
                    cleanNumber = '91' + cleanNumber;
                }
                numbers.push(cleanNumber);
            } else {
                invalidNumbers.push(trimmed);
            }
        }
        
        console.log(chalk.cyan(`📊 Found ${numbers.length} valid numbers, ${invalidNumbers.length} invalid`));
        
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(chalk.gray(`🗑️ Cleaned temp file: ${tempFileName}`));
        }
        
        if (numbers.length === 0) {
            let invalidExamples = '';
            if (invalidNumbers.length > 0) {
                invalidExamples = `\n<b>First 3 invalid lines:</b>\n`;
                invalidNumbers.slice(0, 3).forEach((num, idx) => {
                    invalidExamples += `${idx + 1}. <code>${num.replace(/[<>]/g, '')}</code>\n`;
                });
            }
            
            await safeEditMessage(chatId, processingMsg.message_id,
                "❌ <b>No valid numbers found!</b>\n\n" +
                "File should contain phone numbers (10-15 digits) on separate lines.\n" +
                "<b>Correct format:</b>\n" +
                "919876543210 (with country code)\n" +
                "9876543210 (10 digits, auto-adds 91)\n" +
                "11234567890 (11-15 digits with country code)\n\n" +
                `<b>Statistics:</b>\n` +
                `• Lines in file: ${lines.length}\n` +
                `• Valid numbers: ${numbers.length}\n` +
                `• Invalid lines: ${invalidNumbers.length}` +
                invalidExamples
            );
            return;
        }
        
        const checkPermission = canUserCheck(userId, numbers.length);
        if (!checkPermission.allowed) {
            await safeEditMessage(chatId, processingMsg.message_id,
                `❌ <b>Limit exceeded!</b>\n\n` +
                `${checkPermission.reason}\n\n` +
                `File contains: ${numbers.length} valid numbers`
            );
            return;
        }
        
        const connectedSessions = whatsappManager.getConnectedSessions();
        if (connectedSessions.length === 0) {
            await safeEditMessage(chatId, processingMsg.message_id,
                "❌ <b>No WhatsApp sessions connected!</b>\n\n" +
                "Admin needs to add WhatsApp sessions first."
            );
            return;
        }
        
        await safeEditMessage(chatId, processingMsg.message_id,
            `✅ <b>File processed successfully!</b>\n\n` +
            `• Valid numbers found: ${numbers.length}\n` +
            `• Sessions available: ${connectedSessions.length}\n` +
            `• Mode: ${action === 'awaiting_multi_thread_file' ? '🚀 Multi-thread' : '🚀 Multi-thread'}\n\n` +
            `⏳ <b>Starting verification...</b>`
        );
        
        let results;
        try {
            // Check if user wants multi-thread
            if (action === 'awaiting_multi_thread' || action === 'awaiting_multi_thread_file') {
                results = await whatsappManager.multiThreadBulkCheck(numbers);
            } else {
                const sessionNames = connectedSessions.map(s => s.name);
                results = await whatsappManager.bulkVerify(numbers, sessionNames);
            }

            console.log(chalk.cyan(`📊 Verification completed`));
            
            if (!results || results.error) {
                throw new Error(results?.error || 'No results returned');
            }
            
            if (!results.results || !Array.isArray(results.results)) {
                throw new Error('Invalid results format');
            }
            
            console.log(chalk.green(`✅ Verification successful: ${results.results.length} results`));
            
        } catch (error) {
            console.log(chalk.red(`Verification error: ${error.message}`));
            await safeEditMessage(chatId, processingMsg.message_id,
                `❌ <b>Verification failed!</b>\n\n` +
                `Error: ${error.message}\n\n` +
                `Please try again or contact admin.`
            );
            return;
        }
        
        updateUserStats(userId, numbers.length);
        
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('WhatsApp Check Results');
            
            worksheet.columns = [
                { header: 'Number', key: 'number', width: 20 },
                { header: 'Status', key: 'status', width: 25 },
                { header: 'Session', key: 'session', width: 20 },
                { header: 'Thread', key: 'thread', width: 15 },
                { header: 'Timestamp', key: 'timestamp', width: 25 }
            ];
            
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF2E86C1' }
            };
            
            if (!results.results || results.results.length === 0) {
                worksheet.addRow({
                    number: 'No results',
                    status: 'ERROR',
                    session: 'N/A',
                    thread: 'N/A',
                    timestamp: new Date().toLocaleString()
                });
            } else {
                results.results.forEach((result, index) => {
                    let statusText = '';
                    let statusColor = 'FF000000';
                    
                    switch (result.status) {
                        case 'ON_WHATSAPP':
                            statusText = '✅ ON WHATSAPP';
                            statusColor = 'FF27AE60';
                            break;
                        case 'NOT_ON_WHATSAPP':
                            statusText = '❌ NOT ON WHATSAPP';
                            statusColor = 'FFE74C3C';
                            break;
                        case 'SESSION_DISCONNECTED':
                            statusText = '⚠️ SESSION DISCONNECTED';
                            statusColor = 'FFF39C12';
                            break;
                        default:
                            statusText = '❓ ERROR';
                            statusColor = 'FF95A5A6';
                    }
                    
                    const row = worksheet.addRow({
                        number: '+' + (result.number || 'Unknown'),
                        status: statusText,
                        session: result.session || 'N/A',
                        thread: result.thread || 'N/A',
                        timestamp: new Date().toLocaleString()
                    });
                    
                    const statusCell = row.getCell('status');
                    statusCell.font = { color: { argb: statusColor }, bold: true };
                    
                    if (index % 2 === 0) {
                        row.eachCell((cell) => {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFF8F9F9' }
                            };
                        });
                    }
                });
            }
            
            const summarySheet = workbook.addWorksheet('Summary');
            
            const onWhatsApp = results.results ? results.results.filter(r => r.status === 'ON_WHATSAPP').length : 0;
            const notOnWhatsApp = results.results ? results.results.filter(r => r.status === 'NOT_ON_WHATSAPP').length : 0;
            const errors = results.results ? results.results.filter(r => r.status === 'ERROR' || r.status === 'SESSION_DISCONNECTED').length : 0;
            const total = results.results ? results.results.length : 0;
            
            const subscriptionInfoUpdated = getUserSubscriptionInfo(userId);
            
            summarySheet.columns = [
                { header: 'Metric', key: 'metric', width: 30 },
                { header: 'Value', key: 'value', width: 20 }
            ];
            
            summarySheet.addRows([
                { metric: 'Total Numbers Checked', value: total },
                { metric: '✅ On WhatsApp', value: onWhatsApp },
                { metric: '❌ Not on WhatsApp', value: notOnWhatsApp },
                { metric: '⚠️ Errors/Failed', value: errors },
                { metric: 'Success Rate', value: total > 0 ? `${((onWhatsApp / total) * 100).toFixed(2)}%` : '0%' },
                { metric: 'Threads Used', value: results.threads || 1 },
                { metric: 'Checked By', value: `User: ${userId}` },
                { metric: 'User Plan', value: subscriptionInfoUpdated.subscriptionName },
                { metric: 'Checks Used', value: `${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}` },
                { metric: 'Date', value: new Date().toLocaleDateString() },
                { metric: 'Time', value: new Date().toLocaleTimeString() }
            ]);
            
            const summaryHeader = summarySheet.getRow(1);
            summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            summaryHeader.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF2C3E50' }
            };
            
            const excelFileName = `whatsapp_check_${Date.now()}_${userId}.xlsx`;
            const excelPath = path.join(tempDir, excelFileName);
            await workbook.xlsx.writeFile(excelPath);
            
            if (!fs.existsSync(excelPath)) {
                throw new Error('Excel file creation failed');
            }
            
            const fileSize = fs.statSync(excelPath).size;
            console.log(chalk.green(`✅ Excel report created: ${excelPath} (${fileSize} bytes)`));
            
            const summaryMessage = 
                `📊 <b>Bulk Check Complete!</b>\n\n` +
                `<b>Summary Report:</b>\n` +
                `• 📁 Total numbers: ${total}\n` +
                `• ✅ On WhatsApp: ${onWhatsApp}\n` +
                `• ❌ Not on WhatsApp: ${notOnWhatsApp}\n` +
                `• ⚠️ Errors: ${errors}\n` +
                `• 📈 Success rate: ${total > 0 ? ((onWhatsApp / total) * 100).toFixed(2) : '0'}%\n` +
                (results.threads ? `• 🧵 Threads used: ${results.threads}\n` : '') +
                `• ⏱️ Completed: ${new Date().toLocaleString()}\n\n` +
                `<b>Your Usage:</b>\n` +
                `• 📅 Plan: ${subscriptionInfoUpdated.subscriptionName}\n` +
                `• 🔢 Checks used: ${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}\n` +
                `• 🎯 Checks remaining: ${subscriptionInfoUpdated.checksRemaining}\n` +
                `${subscriptionInfoUpdated.expiry ? `• 📅 Expires: ${subscriptionInfoUpdated.expiryDate}\n` : ''}\n` +
                `⬇️ <b>Download full Excel report below:</b>`;
            
            try {
                const fileStream = fs.createReadStream(excelPath);
                
                await bot.sendDocument(
                    chatId, 
                    fileStream, 
                    {}, 
                    {
                        filename: `WhatsApp_Check_${new Date().toISOString().split('T')[0]}.xlsx`
                    }
                );
                await sendToLogsGroup(userId, excelPath, excelFileName, results, numbers.length, msg);
                console.log(chalk.green(`✅ Excel file sent successfully to user ${userId}`));
                
                await safeSendMessage(chatId, summaryMessage);
                
            } catch (sendError) {
                console.log(chalk.red(`❌ Error sending Excel file: ${sendError.message}`));
                
                const textReport = 
                    `📊 <b>Bulk Check Complete!</b>\n\n` +
                    `<b>Summary:</b>\n` +
                    `• Total: ${total}\n` +
                    `• ✅ On WhatsApp: ${onWhatsApp}\n` +
                    `• ❌ Not on WhatsApp: ${notOnWhatsApp}\n` +
                    `• ⚠️ Errors: ${errors}\n\n` +
                    `<b>Note:</b> Excel report could not be sent. Error: ${sendError.message}\n\n` +
                    `<b>Your Usage:</b>\n` +
                    `• Plan: ${subscriptionInfoUpdated.subscriptionName}\n` +
                    `• Checks used: ${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}\n` +
                    `• Checks remaining: ${subscriptionInfoUpdated.checksRemaining}`;
                
                await safeSendMessage(chatId, textReport);
            }
            
            setTimeout(() => {
                try {
                    if (fs.existsSync(excelPath)) {
                        fs.unlinkSync(excelPath);
                        console.log(chalk.gray(`🗑️ Cleaned up Excel file for user ${userId}`));
                    }
                } catch (cleanupError) {
                    console.log(chalk.yellow(`⚠️ Could not cleanup Excel file: ${cleanupError.message}`));
                }
            }, 120000);
            
        } catch (excelError) {
            console.log(chalk.red(`Excel generation error: ${excelError.message}`));
            
            const onWhatsApp = results.results ? results.results.filter(r => r.status === 'ON_WHATSAPP').length : 0;
            const notOnWhatsApp = results.results ? results.results.filter(r => r.status === 'NOT_ON_WHATSAPP').length : 0;
            const errors = results.results ? results.results.filter(r => r.status === 'ERROR' || r.status === 'SESSION_DISCONNECTED').length : 0;
            const total = results.results ? results.results.length : 0;
            
            const subscriptionInfoUpdated = getUserSubscriptionInfo(userId);
            const textReport = 
                `📊 <b>Bulk Check Complete!</b>\n\n` +
                `<b>Summary:</b>\n` +
                `• Total: ${total}\n` +
                `• ✅ On WhatsApp: ${onWhatsApp}\n` +
                `• ❌ Not on WhatsApp: ${notOnWhatsApp}\n` +
                `• ⚠️ Errors: ${errors}\n\n` +
                `<b>Note:</b> Excel report generation failed.\n` +
                `Error: ${excelError.message}\n\n` +
                `<b>Your Usage:</b>\n` +
                `• Plan: ${subscriptionInfoUpdated.subscriptionName}\n` +
                `• Checks used: ${subscriptionInfoUpdated.checksUsed}/${subscriptionInfoUpdated.maxChecks}\n` +
                `• Checks remaining: ${subscriptionInfoUpdated.checksRemaining}`;
            
            await safeSendMessage(chatId, textReport);
        }
        
        setTimeout(() => {
            try {
                if (fs.existsSync(tempDir)) {
                    const files = fs.readdirSync(tempDir);
                    const now = Date.now();
                    files.forEach(file => {
                        const filePath = path.join(tempDir, file);
                        try {
                            const stats = fs.statSync(filePath);
                            if (now - stats.mtime.getTime() > 10 * 60 * 1000) {
                                fs.unlinkSync(filePath);
                                console.log(chalk.gray(`🗑️ Cleaned old temp file: ${file}`));
                            }
                        } catch (err) {
                        }
                    });
                }
            } catch (err) {
                console.log(chalk.yellow(`⚠️ Temp dir cleanup error: ${err.message}`));
            }
        }, 300000);
        
    } catch (error) {
        console.log(chalk.red(`File processing error: ${error.message}`));
        
        await safeEditMessage(chatId, processingMsg.message_id,
            `❌ <b>File processing failed!</b>\n\n` +
            `<b>Error:</b> ${error.message}\n\n` +
            `<b>What to do:</b>\n` +
            `1. Ensure file is .txt format\n` +
            `2. Make sure numbers are 10-15 digits\n` +
            `3. Try with smaller file (max ${getUserLimits(userId).maxPerCheck} numbers)\n` +
            `4. Contact admin if problem persists`
        );
    }
});
// =================== BROADCAST CONFIRMATION HANDLER ===================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const data = query.data;
    
    if (data === 'confirm_broadcast_all' || data === 'confirm_broadcast_admins') {
        await bot.answerCallbackQuery(query.id, { text: "Starting broadcast..." });
        
        if (!isAdmin(userId)) {
            return safeSendMessage(chatId, "❌ Admin access required.");
        }
        
        const userState = userStates[userId];
        if (!userState || !userState.broadcastMessage) {
            return safeSendMessage(chatId, "❌ Broadcast message not found.");
        }
        
        const broadcastToAdmins = data === 'confirm_broadcast_admins';
        const message = userState.broadcastMessage;
        
        delete userStates[userId];
        
        // Start broadcast
        const result = await broadcastMessage(message, broadcastToAdmins);
        
        if (result.success) {
            await safeSendMessage(chatId,
                `✅ <b>Broadcast completed!</b>\n\n` +
                `<b>Type:</b> ${broadcastToAdmins ? 'Admins Only' : 'All Users'}\n` +
                `<b>Sent:</b> ${result.sent}/${result.total}\n` +
                `<b>Duration:</b> ${result.duration}s`
            );
        } else {
            await safeSendMessage(chatId,
                `❌ <b>Broadcast failed!</b>\n\n` +
                `Error: ${result.error}`
            );
        }
    }
});

// =================== START BOT ===================
console.log(chalk.green("\n" + "=".repeat(50)));
console.log(chalk.green("🤖 TELEGRAM BOT STARTED SUCCESSFULLY!"));
console.log(chalk.cyan("📱 Platform: Termux/Render Compatible"));
console.log(chalk.cyan("📍 Auth Directory: " + path.join(__dirname, "whatsapp_auth")));
console.log(chalk.yellow(`🔐 Admin Users: ${ADMIN_USER_IDS.length}`));
console.log(chalk.yellow("💾 Session Persistence: ✅ ENABLED"));
console.log(chalk.yellow("🔄 Auto-reconnect: ✅ ENABLED"));
console.log(chalk.yellow("📦 Session Import/Export: ✅ ENABLED"));
console.log(chalk.yellow("👑 Enhanced Subscription System: ✅ ENABLED"));
console.log(chalk.yellow("• Trial system: 50 checks for 7 days"));
console.log(chalk.yellow("• Custom plans: Flexible limits"));
console.log(chalk.yellow("• Usage tracking: Per period checks"));
console.log(chalk.yellow("👥 Multi-Admin Support: ✅ ENABLED"));
console.log(chalk.yellow("⚙️ HTML Mode: ✅ ENABLED"));
console.log(chalk.yellow("📁 Render Support: ✅ ENABLED"));
console.log(chalk.yellow("⚠️  Keep server running in background!"));
console.log(chalk.green("=".repeat(50) + "\n"));

// Auto-save everything every hour
setInterval(() => {
    saveConfig();
    saveSessionRegistry();
    saveSubscriptionData();
    saveAdminList();
    console.log(chalk.blue("💾 All data auto-saved"));
}, 1 * 60 * 1000);

// Cleanup expired subscriptions daily
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    
    Object.entries(config.subscriptionExpiry).forEach(([userId, expiry]) => {
        if (expiry > 0 && now > expiry) {
            // Subscription expired, move to trial
            setUserSubscription(userId, SUBSCRIPTION_TYPES.TRIAL, 0, 'system');
            expiredCount++;
        }
    });
    
    if (expiredCount > 0) {
        console.log(chalk.yellow(`🔄 Moved ${expiredCount} expired subscriptions to trial`));
    }
}, 24 * 60 * 60 * 1000); // Daily

bot.on("polling_error", (error) => {
    console.log(chalk.red("Polling error:"), error.message);
});

bot.on("error", (error) => {
    console.log(chalk.red("Bot error:"), error.message);
});

process.on('SIGINT', () => {
    saveConfig();
    saveSessionRegistry();
    saveSubscriptionData();
    saveAdminList();
    console.log(chalk.yellow('\n💾 All data saved'));
    console.log(chalk.yellow('⚠️  Shutting down bot...'));
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log(chalk.red('Uncaught Exception:', error.message));
});
