'use strict';

/**
 * Telegram auto-post module (complete)
 * - Save up to `maxSavedPosts` posts in Redis (as raw JSON of ctx.message)
 * - Schedule posting every N minutes using node-cron (runs in Asia/Kolkata timezone)
 * - Posts are sent to EVERY chat where the bot is admin. Active admin chats are persisted in Redis.
 *
 * Expected `redis` API (promises): get(key), set(key, value, ...), del(key), lrange(key, start, stop), rpush(key, value), ltrim(key, start, stop), llen(key)
 * Optional Redis set commands (recommended): sadd(key, member), srem(key, member), smembers(key)
 * If your redisConfig uses a different interface adapt accordingly.
 */

const redis = require('../../../globle_helper/redisConfig');
const cron = require('node-cron');

module.exports = (bot) => {
  // --- configuration ---
  const internalCron = '*/1 * * * *'; // run every minute internally
  const defaultIntervalMinutes = 1;   // default: every 1 minute

  const redisKeyPrefix = 'message_auto_save_and_post:';
  const savedPostsKey = `${redisKeyPrefix}saved_posts`;
  const scheduleCronKey = `${redisKeyPrefix}schedule_cron`; // now stores interval in minutes
  const notifierChatKey = `${redisKeyPrefix}notifier_chat`;
  const activeChatsKey = `${redisKeyPrefix}active_chats`;   // Redis set (preferred) or JSON string (fallback)
  const lastRunKey = `${redisKeyPrefix}last_run_at`;        // timestamp (ms) of last successful posting run

  const maxSavedPosts = Number(process.env.MESSAGE_AUTO_SAVE_AND_POST_MAX_POST) || 10; // keep only latest N posts
  const pendingPostPrefix = `${redisKeyPrefix}pending_post:`;       // + userId
  const waitingForPostPrefix = `${redisKeyPrefix}waiting_for_post:`; // + userId
  const waitingForTimePrefix = `${redisKeyPrefix}waiting_for_time:`; // + userId

  // In-memory set to track chats where bot is admin
  const activeChats = new Set();
  let scheduledTask = null;

  // --- helpers ---
  function pickLargestPhoto(photos) {
    if (!Array.isArray(photos) || photos.length === 0) return null;
    return photos.reduce((prev, curr) => (prev.width > curr.width ? prev : curr));
  }

  // Redis-backed active chats management with fallback
  async function addActiveChat(chatId) {
    try {
      // try Redis set command first
      if (typeof redis.sadd === 'function') {
        await redis.sadd(activeChatsKey, chatId);
      } else {
        // fallback: store JSON array
        const raw = await redis.get(activeChatsKey);
        let arr = [];
        if (raw) {
          try { arr = JSON.parse(raw); } catch (e) { arr = []; }
        }
        if (!arr.includes(chatId)) arr.push(chatId);
        await redis.set(activeChatsKey, JSON.stringify(arr));
      }
    } catch (e) {
      console.warn('addActiveChat redis error:', e && e.message ? e.message : e);
    }
    activeChats.add(chatId);
  }

  async function removeActiveChat(chatId) {
    try {
      if (typeof redis.srem === 'function') {
        await redis.srem(activeChatsKey, chatId);
      } else {
        const raw = await redis.get(activeChatsKey);
        let arr = [];
        if (raw) {
          try { arr = JSON.parse(raw); } catch (e) { arr = []; }
        }
        const idx = arr.indexOf(chatId);
        if (idx !== -1) arr.splice(idx, 1);
        await redis.set(activeChatsKey, JSON.stringify(arr));
      }
    } catch (e) {
      console.warn('removeActiveChat redis error:', e && e.message ? e.message : e);
    }
    if (activeChats.has(chatId)) activeChats.delete(chatId);
  }

  async function getPersistedActiveChats() {
    try {
      if (typeof redis.smembers === 'function') {
        const members = await redis.smembers(activeChatsKey);
        if (Array.isArray(members)) return members;
      } else {
        const raw = await redis.get(activeChatsKey);
        if (raw) {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr;
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      console.warn('getPersistedActiveChats error:', e && e.message ? e.message : e);
    }
    // fallback to in-memory
    return Array.from(activeChats);
  }

  async function loadActiveChatsFromRedis() {
    try {
      const persisted = await getPersistedActiveChats();
      for (const id of persisted) activeChats.add(id);
      console.log('[auto-post] Loaded persisted active chats:', activeChats.size);
    } catch (e) {
      console.warn('[auto-post] loadActiveChatsFromRedis failed:', e && e.message ? e.message : e);
    }
  }

  // Check whether a user is admin in the current chat safely (avoids calling getChatAdministrators on private chats)
  async function isUserAdminInChat(ctx, userId) {
    try {
      if (!ctx.chat) return false;
      const type = ctx.chat.type;
      // Only call getChatAdministrators for group-like chats
      if (['group', 'supergroup', 'channel'].includes(type)) {
        const admins = await bot.telegram.getChatAdministrators(ctx.chat.id);
        return admins.some(a => a.user && a.user.id === userId);
      }

      // For private chats, we treat the user as 'allowed' (so commands can work in PM).
      // If you want to restrict to bot owner only, change this to check against an OWNER_ID.
      if (type === 'private') return true;

      return false;
    } catch (e) {
      console.warn('isUserAdminInChat check failed:', e && e.message ? e.message : e);
      return false;
    }
  }

  async function sendPostToChannel(post, chatId) {
    try {
      // media types precedence
      if (post.photo) {
        const largest = pickLargestPhoto(post.photo);
        if (!largest || !largest.file_id) throw new Error('No photo file_id');
        await bot.telegram.sendPhoto(chatId, largest.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.video) {
        await bot.telegram.sendVideo(chatId, post.video.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.document) {
        await bot.telegram.sendDocument(chatId, post.document.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.audio) {
        await bot.telegram.sendAudio(chatId, post.audio.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.voice) {
        await bot.telegram.sendVoice(chatId, post.voice.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.sticker) {
        await bot.telegram.sendSticker(chatId, post.sticker.file_id);
      } else if (post.text || post.caption) {
        // text-only messages or captions-only
        const text = post.text || post.caption || '';
        const entities = post.entities || post.caption_entities || undefined;
        await bot.telegram.sendMessage(chatId, text, entities ? { entities } : {});
      } else {
        console.log('Unsupported post structure:', post);
        return false;
      }

      return true;
    } catch (err) {
      console.error(`Failed to send post to ${chatId}:`, err && err.message ? err.message : err);
      return false;
    }
  }

  // --- schedule management ---
  async function updateSchedule() {
    try {
      // ensure interval exists and is valid
      const rawInterval = await redis.get(scheduleCronKey);
      let intervalMinutes = parseInt(rawInterval, 10);
      if (isNaN(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 4320) {
        intervalMinutes = defaultIntervalMinutes;
        await redis.set(scheduleCronKey, String(intervalMinutes));
      }

      // stop previous task
      if (scheduledTask) {
        try { scheduledTask.stop(); } catch (e) { /* ignore */ }
        scheduledTask = null;
      }

      scheduledTask = cron.schedule(internalCron, async () => {
        console.log(`[auto-post] Tick at ${new Date().toISOString()}`);
        try {
          // read current interval (so change via /settime is picked up without restart)
          const raw = await redis.get(scheduleCronKey);
          let interval = parseInt(raw, 10);
          if (isNaN(interval) || interval < 1 || interval > 4320) {
            interval = defaultIntervalMinutes;
          }

          const now = Date.now();
          const lastRunRaw = await redis.get(lastRunKey);
          const lastRunMs = lastRunRaw ? parseInt(lastRunRaw, 10) : 0;
          const diffMinutes = lastRunMs ? (now - lastRunMs) / 60000 : Infinity;

          if (diffMinutes < interval) {
            console.log(`[auto-post] Skipping: only ${diffMinutes.toFixed(2)} minutes passed, need ${interval}`);
            return;
          }

          // time to run
          await redis.set(lastRunKey, String(now));

          const postsJson = await redis.lrange(savedPostsKey, 0, -1);
          if (!postsJson || postsJson.length === 0) {
            console.log('[auto-post] No saved posts');
            return;
          }

          // prefer persisted list, fallback to in-memory
          const persistedChats = await getPersistedActiveChats();
          const adminChats = (persistedChats && persistedChats.length) ? persistedChats : Array.from(activeChats);

          if (!adminChats || adminChats.length === 0) {
            console.log('[auto-post] No active admin chats to post to');
            return;
          }

          for (const chatId of adminChats) {
            console.log(`[auto-post] Sending ${postsJson.length} posts to chat ${chatId}`);
            let failedOnce = false;
            for (const json of postsJson) {
              let post;
              try { post = JSON.parse(json); } catch (e) { console.error('[auto-post] Invalid saved post JSON', e); continue; }
              const ok = await sendPostToChannel(post, chatId);
              if (!ok) {
                failedOnce = true;
                console.warn(`[auto-post] Failed to send one post to ${chatId}`);
              } else {
                console.log(`[auto-post] Sent post to ${chatId}`);
              }
            }
            // if we repeatedly fail (bot probably not admin anymore), remove chat from active lists
            if (failedOnce) {
              try {
                let stillAdmin = true;
                try {
                  await bot.telegram.getChat(chatId);
                } catch (e) {
                  stillAdmin = false;
                }
                if (!stillAdmin) {
                  console.log(`[auto-post] Removing ${chatId} from active list due to failures`);
                  await removeActiveChat(chatId);
                }
              } catch (e) {
                console.warn('[auto-post] post-send cleanup error:', e && e.message ? e.message : e);
              }
            }
          }

          const notifierChat = await redis.get(notifierChatKey);
          if (notifierChat) {
            try {
              await bot.telegram.sendMessage(
                notifierChat,
                `Successfully posted ${postsJson.length} saved post(s) to ${adminChats.length} chat(s).`
              );
              console.log('[auto-post] Notifier message sent');
            } catch (e) { console.error('[auto-post] Failed to send notifier message', e); }
          }
        } catch (err) {
          console.error('[auto-post] Error while running scheduled job:', err);
        }
      }, {
        timezone: 'Asia/Kolkata'
      });

      console.log('[auto-post] Scheduler initialized; interval (minutes):', intervalMinutes);
    } catch (err) {
      console.error('updateSchedule error:', err);
    }
  }

  // Start schedule on load (but first load persisted chats)
  (async () => {
    await loadActiveChatsFromRedis();
    await updateSchedule();
  })();

  // Graceful shutdown of cron when process ends
  function shutdownScheduler() {
    try {
      if (scheduledTask) scheduledTask.stop();
    } catch (e) { /* ignore */ }
  }
  process.once('SIGINT', shutdownScheduler);
  process.once('SIGTERM', shutdownScheduler);

  // --- bot event handlers ---

  // Track admin status when bot is promoted/demoted
  bot.on('my_chat_member', async (ctx) => {
    try {
      const update = ctx.myChatMember;
      const chatId = update.chat.id.toString();
      const status = update.new_chat_member && update.new_chat_member.status;
      if (status === 'administrator') {
        await addActiveChat(chatId);
        console.log(`[my_chat_member] Bot is administrator in ${chatId}`);
      } else {
        await removeActiveChat(chatId);
        console.log(`[my_chat_member] Bot is not admin in ${chatId} (status: ${status})`);
      }
    } catch (err) {
      console.error('my_chat_member handler error:', err);
    }
  });

  // Single message handler: update admin status + handle waiting states
  bot.on('message', async (ctx, next) => {
    const chatIdStr = ctx.chat && ctx.chat.id ? ctx.chat.id.toString() : null;

    try {
      // Update admin presence for groups, supergroups, channels
      try {
        if (ctx.chat && ['group', 'supergroup', 'channel'].includes(ctx.chat.type)) {
          const admins = await bot.telegram.getChatAdministrators(ctx.chat.id);
          const isBotAdmin = admins.some(a => a.user && a.user.id === bot.botInfo.id);
          if (isBotAdmin) {
            if (chatIdStr) await addActiveChat(chatIdStr);
          } else {
            if (chatIdStr) await removeActiveChat(chatIdStr);
          }
        }
      } catch (err) {
        console.error('[message] error checking admin status:', err && err.message ? err.message : err);
      }

      // Now handle workflows: saving post or setting interval
      try {
        const userId = ctx.from && ctx.from.id ? ctx.from.id : null;
        if (!userId) return; // ignore unknown

        const waitingPost = await redis.get(`${waitingForPostPrefix}${userId}`);
        const waitingTime = await redis.get(`${waitingForTimePrefix}${userId}`);

        // 1) waiting for a post to save
        if (waitingPost) {
          // clear waiting flag
          await redis.del(`${waitingForPostPrefix}${userId}`);

          // allowed types
          const allowed = ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'text', 'caption'];
          const hasSupported = allowed.some(type => ctx.message && ctx.message[type]);
          // some messages have caption (with media), handle that
          const isMediaWithCaption = ctx.message && (ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.audio || ctx.message.voice);

          if (!hasSupported && !isMediaWithCaption) {
            await ctx.reply('Unsupported message type. Please send a photo, video, document, audio, voice, sticker, or text.');
            return;
          }

          // store pending post JSON (stringified)
          const messageJson = JSON.stringify(ctx.message);
          await redis.set(`${pendingPostPrefix}${userId}`, messageJson, 'EX', 3600);
          console.log(`[save] Pending post saved for user ${userId}`);

          // make a preview copy in the same chat so user can see the preview and reply to it
          try {
            const copied = await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, ctx.message.message_id);
            const previewMsgId = copied && copied.message_id ? copied.message_id : null;
            await ctx.reply('Do you want to save this post?', {
              reply_to_message_id: previewMsgId,
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Yes', callback_data: 'save_yes' }, { text: 'No', callback_data: 'save_no' }]
                ]
              }
            });
          } catch (e) {
            // if copyMessage fails, still ask for confirmation
            console.warn('[save] copyMessage failed:', e && e.message ? e.message : e);
            await ctx.reply('Do you want to save this post? (Reply with Yes/No)', { reply_markup: { force_reply: false } });
          }

          return;
        }

        // 2) waiting for interval (minutes) for scheduling
        if (waitingTime) {
          await redis.del(`${waitingForTimePrefix}${userId}`);

          const textRaw = (ctx.message && ctx.message.text) ? ctx.message.text.trim() : '';
          const interval = parseInt(textRaw, 10);

          if (isNaN(interval) || interval < 1 || interval > 4320) {
            await ctx.reply('Invalid number. Please send a number of minutes between 1 and 4320.');
            return;
          }

          await redis.set(scheduleCronKey, String(interval));

          // Set notifier chat with 30 days expiry
          if (chatIdStr) {
            await redis.set(notifierChatKey, chatIdStr, 'EX', 86400 * 30);
          }

          await updateSchedule();

          await ctx.reply(`✅ Posts will now be sent every ${interval} minute(s).`);
          console.log(`[settime] Schedule updated by ${userId} to every ${interval} minute(s)`);

          return;
        }

      } catch (err) {
        console.error('[message] workflow error:', err);
      }
    } finally {
      // Important: call next() so other middlewares (like command handlers) still run
      try { await next(); } catch (e) { /* ignore next errors */ }
    }
  });

  // callback queries for save_yes / save_no
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    const userId = ctx.callbackQuery && ctx.callbackQuery.from && ctx.callbackQuery.from.id;

    try {
      if (data === 'save_yes') {
        const pendingKey = `${pendingPostPrefix}${userId}`;
        const pendingJson = await redis.get(pendingKey);
        if (!pendingJson) {
          try { await ctx.answerCbQuery('No post found to save.'); await ctx.editMessageText('No post found to save.'); } catch (e) { }
          return;
        }

        // push to saved list and trim
        await redis.rpush(savedPostsKey, pendingJson);
        // keep only last `maxSavedPosts`
        try {
          // ltrim to keep last N items
          await redis.ltrim(savedPostsKey, -maxSavedPosts, -1);
        } catch (e) {
          // fallback: use llen + lpop
          const len = await redis.llen(savedPostsKey);
          if (len > maxSavedPosts) {
            const removeCount = len - maxSavedPosts;
            for (let i = 0; i < removeCount; i++) await redis.lpop(savedPostsKey);
          }
        }

        await redis.del(pendingKey);
        try { await ctx.answerCbQuery('Post saved!'); await ctx.editMessageText('Post successfully saved!'); } catch (e) { }
        console.log(`[save_yes] Post saved by ${userId}`);

      } else if (data === 'save_no') {
        await redis.del(`${pendingPostPrefix}${userId}`);
        try { await ctx.answerCbQuery('Post not saved.'); await ctx.editMessageText('Post not saved.'); } catch (e) { }
        console.log(`[save_no] User ${userId} chose not to save`);
      }
    } catch (err) {
      console.error('callback_query handler error:', err);
      try { await ctx.answerCbQuery('An error occurred.'); } catch (e) { }
    }
  });

  // --- admin commands ---

  // /save - start waiting for a post
  bot.command('save', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      // authorization: check the user is admin in this chat
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can save posts.');

      await redis.set(`${waitingForPostPrefix}${userId}`, 'true', 'EX', 3600);
      await ctx.reply('Please send the post you want to save (photo, video, doc, audio, voice, sticker, or text).');
    } catch (err) {
      console.error('/save error:', err);
      await ctx.reply('An error occurred. Please try again.');
    }
  });

  // /start - show bot credit
  bot.start(async (ctx) => {
    try {
      await ctx.reply(
        'This bot is made by @Professional_telegram_bot_create'
      );
    } catch (err) {
      console.error('/start error:', err);
    }
  });

  // /settime - start waiting for interval (minutes)
  bot.command('settime', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can set the posting interval.');

      await redis.set(`${waitingForTimePrefix}${userId}`, 'true', 'EX', 3600);
      await ctx.reply('Please send the interval in minutes between posts (1-4320).');
    } catch (err) {
      console.error('/settime error:', err);
      await ctx.reply('An error occurred. Please try again.');
    }
  });

  // /clear - clear saved posts
  bot.command('clear', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can clear saved posts.');

      await redis.del(savedPostsKey);
      await ctx.reply('All saved posts have been cleared.');
      console.log('/clear invoked by', userId);
    } catch (err) {
      console.error('/clear error:', err);
      await ctx.reply('An error occurred while clearing saved posts.');
    }
  });
};