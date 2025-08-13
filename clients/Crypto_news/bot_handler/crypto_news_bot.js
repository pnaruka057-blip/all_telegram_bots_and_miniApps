// crypto_news_message_manager.js
const redis = require('../../../globle_helper/redisConfig');
const cron = require('node-cron');

const CLIENT_NAMESPACE = 'crypto_news:messages';
const DELETE_TIME_KEY = 'crypto_news:delete_time'; // Redis key for delete time

// Default delete time (ms) = 2 minutes
let deleteTimeMs = 2 * 60 * 1000;

// pendingReplies map: adminId -> { chatId, timeoutId }
const pendingReplies = Object.create(null);

module.exports = (bot) => {
    // Load delete time from Redis at startup
    (async () => {
        try {
            const savedTime = await redis.get(DELETE_TIME_KEY);
            if (savedTime) {
                deleteTimeMs = parseInt(savedTime, 10);
                console.log(`⏳ Loaded delete time from Redis: ${deleteTimeMs / 1000} seconds`);
            } else {
                console.log(`⏳ Using default delete time: ${deleteTimeMs / 1000} seconds`);
            }
        } catch (err) {
            console.error('❌ Failed to load delete time from Redis:', err);
        }
    })();

    // Helper: convert input like "5m", "2h", "1d" => milliseconds
    function parseDurationToMs(input) {
        const match = /^(\d+)([mhd])$/.exec(input);
        if (!match) return null;
        const value = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === 'm') return value * 60 * 1000;
        if (unit === 'h') return value * 60 * 60 * 1000;
        if (unit === 'd') return value * 24 * 60 * 60 * 1000;
        return null;
    }

    function clearPendingFor(adminId) {
        const p = pendingReplies[adminId];
        if (!p) return;
        try { clearTimeout(p.timeoutId); } catch (_) { }
        delete pendingReplies[adminId];
        console.log(`ℹ Cleared pending /setTime for ${adminId}`);
    }

    /* ------------------------------
       1) Register admin command & text handler FIRST
       ------------------------------ */

    // /setTime command (only admin)
    bot.command('setTime', async (ctx) => {
        try {
            const adminId = String(ctx.from && ctx.from.id ? ctx.from.id : ctx.chat.id);

            if (!adminId) {
                console.warn('⚠ CRYPTO_NEWS_ADMIN_CHAT_ID not set!');
                return ctx.reply('❌ Server misconfigured: admin id missing.');
            }

            if (pendingReplies[adminId]) {
                return ctx.reply('⚠ You already have a pending /setTime request. Please reply to that or wait until it times out.');
            }

            await ctx.reply('⏱️ Please send the auto-delete time (e.g., 1m, 5m, 1h, 2h, 1d)');

            const timeoutId = setTimeout(async () => {
                try {
                    if (pendingReplies[adminId]) {
                        delete pendingReplies[adminId];
                        await ctx.reply('⌛ Timeout: no reply received. /setTime cancelled.');
                    }
                } catch (_) { }
            }, 2 * 60 * 1000); // 2 minutes

            pendingReplies[adminId] = {
                chatId: String(ctx.chat.id),
                timeoutId
            };
            console.log(`ℹ Pending /setTime for admin ${adminId} in chat ${ctx.chat.id}`);
        } catch (err) {
            console.error('❌ Error handling /setTime:', err);
            try { await ctx.reply('❌ Internal error. Try again later.'); } catch (_) { }
        }
    });

    // Global text listener — handles replies for pending /setTime
    bot.on('text', async (ctx, next) => {
        try {
            const fromId = String(ctx.from && ctx.from.id ? ctx.from.id : '');
            if (!fromId) return await next();

            const pending = pendingReplies[fromId];
            if (!pending) return await next(); // not a pending admin reply -> let others handle

            // only accept reply from same chat where /setTime was invoked
            const chatIdStr = String(ctx.chat && ctx.chat.id ? ctx.chat.id : '');
            if (chatIdStr !== String(pending.chatId)) {
                await ctx.reply('⚠ Please reply in the same chat where you ran /setTime.');
                return; // stop propagation for this update (we already replied)
            }

            const text = (ctx.message && ctx.message.text) ? ctx.message.text.trim().toLowerCase() : '';
            if (!text) {
                await ctx.reply('⚠ Invalid input. Please send like 1m, 5m, 1h, 2h, 1d');
                return;
            }

            const ms = parseDurationToMs(text);
            if (!ms) {
                await ctx.reply('⚠ Invalid format. Use: 1m, 5m, 1h, 2h, or 1d');
                return;
            }
            if (ms < 10000) {
                await ctx.reply('⚠ Time is too short. Minimum supported is 10 seconds.');
                return;
            }

            deleteTimeMs = ms;
            await redis.set(DELETE_TIME_KEY, String(ms));
            await ctx.reply(`✅ Auto-delete time set to: ${text}`);
            console.log(`🆕 Auto-delete time set by admin ${fromId}: ${ms} ms`);

            // cleanup pending entry and STOP propagation (we handled it)
            clearPendingFor(fromId);
            return; // do NOT call next() — stop here
        } catch (err) {
            console.error('❌ Error in pending reply handler:', err);
            try { await ctx.reply('❌ Failed to set time. Try again.'); } catch (_) { }
            return;
        }
    });

    /* ------------------------------
       2) Then register message/channel_post handlers
       These call next() exactly once (after processing) to allow other middlewares if any.
       ------------------------------ */

    async function handleIncoming(ctx, typeLabel = 'message') {
        try {
            // debug: console.log('DEBUG update:', JSON.stringify(ctx.update, null, 2));

            const chat = ctx.chat || (ctx.update && ctx.update.channel_post && ctx.update.channel_post.chat);
            if (!chat) return;

            const chatType = chat.type;
            const chatId = chat.id;
            console.log(`📩 Received ${typeLabel} from chatId: ${chatId}, chatType: ${chatType}`);

            if (!['channel', 'supergroup', 'group'].includes(chatType)) {
                console.log(`⏩ Skipped: Not a group/channel message.`);
                return;
            }

            const messageId =
                (ctx.message && ctx.message.message_id) ||
                (ctx.update && ctx.update.channel_post && ctx.update.channel_post.message_id);

            if (!messageId) {
                console.warn('⚠ No message_id found, skipping store.');
                return;
            }

            const timestamp = Date.now();
            const key = `${chatId}:${messageId}`;
            await redis.hset(CLIENT_NAMESPACE, key, String(timestamp));
            console.log(`✅ Stored in Redis: ${key} at ${new Date(timestamp).toISOString()}`);
        } catch (err) {
            console.error('❌ Error storing incoming message in Redis:', err);
        }
    }

    bot.on('message', async (ctx, next) => {
        try {
            await handleIncoming(ctx, 'message');
        } catch (err) {
            console.error('Error in message listener:', err);
        }
        // call next exactly once
        return await next();
    });

    bot.on('channel_post', async (ctx, next) => {
        try {
            await handleIncoming(ctx, 'channel_post');
        } catch (err) {
            console.error('Error in channel_post listener:', err);
        }
        return await next();
    });

    /* ------------------------------
       3) Cron job every minute: check and delete expired messages
       ------------------------------ */
    cron.schedule('* * * * *', async () => {
        try {
            const messages = await redis.hgetall(CLIENT_NAMESPACE);
            if (!messages || Object.keys(messages).length === 0) return;
            const now = Date.now();

            for (const [key, tsString] of Object.entries(messages)) {
                const timestamp = Number(tsString);
                if (Number.isNaN(timestamp)) {
                    await redis.hdel(CLIENT_NAMESPACE, key);
                    console.warn(`⚠ Bad timestamp for ${key}, removed.`);
                    continue;
                }
                if (now - timestamp >= deleteTimeMs) {
                    const [chatId, messageId] = key.split(':');
                    if (!chatId || !messageId) {
                        await redis.hdel(CLIENT_NAMESPACE, key);
                        console.warn(`⚠ Invalid key ${key}, removed.`);
                        continue;
                    }
                    try {
                        await bot.telegram.deleteMessage(chatId, messageId);
                        console.log(`🗑 Deleted ${messageId} from ${chatId}`);
                    } catch (err) {
                        console.warn(`⚠ Could not delete ${messageId} from ${chatId}: ${err && err.message ? err.message : err}`);
                    } finally {
                        try {
                            await redis.hdel(CLIENT_NAMESPACE, key);
                            console.log(`❎ Removed ${key} from Redis.`);
                        } catch (e) {
                            console.error(`❌ Failed to remove ${key} from Redis:`, e);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('❌ Cron error deleting messages:', err);
        }
    }, { scheduled: true, timezone: 'UTC' });
};
