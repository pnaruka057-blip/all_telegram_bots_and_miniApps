'use strict';

const redis = require('../../../globle_helper/redisConfig');
const cron = require('node-cron');
const moment = require('moment-timezone');

module.exports = (bot) => {
  // --- configuration ---
  const defaultCron = '0 8 * * *'; // default daily 08:00 IST
  const redisKeyPrefix = 'message_auto_save_and_post:';
  const savedPostsKey = `${redisKeyPrefix}saved_posts`; // list of JSON saved objects {id, created_at, message}
  const scheduleCronKey = `${redisKeyPrefix}schedule_cron`; // cron string for daily delete+repost
  const notifierChatKey = `${redisKeyPrefix}notifier_chat`;
  const activeChatsKey = `${redisKeyPrefix}active_chats`; // set preferred
  const savedPostMapKey = `${redisKeyPrefix}saved_post_map`; // hash: "<savedId>:<chatId>" => messageId (bot-sent)
  const CLIENT_NAMESPACE = `${redisKeyPrefix}posted_messages`; // hash: "chatId:messageId" -> timestamp (when bot sent)
  const pointerKeyPrefix = `${redisKeyPrefix}pointer:`; // per-chat pointer if used (we reset pointers when trimming)
  const DELETE_TIME_KEY = `${redisKeyPrefix}delete_time_ms`;
  const maxSavedPosts = Number(process.env.MESSAGE_AUTO_SAVE_AND_POST_MAX_POST || 50);

  const pendingPostPrefix = `${redisKeyPrefix}pending_post:`; // base for temporary per-user list (we'll append :session)
  const waitingForPostPrefix = `${redisKeyPrefix}waiting_for_post:`; // session flag per user
  const waitingForTimePrefix = `${redisKeyPrefix}waiting_for_time:`; // + userId

  // in-memory
  const activeChats = new Set();
  let dailyTask = null;
  let pollTask = null;
  let runningDailyJob = false;

  // pending replies for legacy /setTime (duration) if used
  const pendingDeleteReplies = Object.create(null);

  // --- helpers ---
  function pickLargestPhoto(photos) {
    if (!Array.isArray(photos) || photos.length === 0) return null;
    return photos.reduce((prev, curr) => (prev.width > (curr.width || 0) ? prev : curr));
  }

  function makeSavedId() {
    return `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // detect commands (so they aren't saved)
  function isBotCommandMessage(msg) {
    if (!msg) return false;
    if (msg.from && msg.from.is_bot) return true; // bot-origin -> don't save
    const text = (msg.text || msg.caption || '').toString();
    if (!text) return false;
    if (Array.isArray(msg.entities) && msg.entities.length > 0) {
      for (const ent of msg.entities) {
        if (ent && ent.type === 'bot_command' && ent.offset === 0) return true;
      }
    }
    if (Array.isArray(msg.caption_entities) && msg.caption_entities.length > 0) {
      for (const ent of msg.caption_entities) {
        if (ent && ent.type === 'bot_command' && ent.offset === 0) return true;
      }
    }
    if (text.trim().startsWith('/')) return true;
    return false;
  }

  // build pending list key for a user session
  function pendingListKeyFor(userId) {
    return `${pendingPostPrefix}${userId}:session`;
  }

  // Redis-backed active chats management with fallback
  async function addActiveChat(chatId) {
    try {
      if (typeof redis.sadd === 'function') {
        await redis.sadd(activeChatsKey, String(chatId));
      } else {
        const raw = await redis.get(activeChatsKey);
        let arr = [];
        if (raw) {
          try { arr = JSON.parse(raw); } catch (e) { arr = []; }
        }
        if (!arr.includes(String(chatId))) arr.push(String(chatId));
        await redis.set(activeChatsKey, JSON.stringify(arr));
      }
    } catch (e) {
      console.warn('addActiveChat redis error:', e && e.message ? e.message : e);
    }
    activeChats.add(String(chatId));
  }

  async function removeActiveChat(chatId) {
    try {
      if (typeof redis.srem === 'function') {
        await redis.srem(activeChatsKey, String(chatId));
      } else {
        const raw = await redis.get(activeChatsKey);
        let arr = [];
        if (raw) {
          try { arr = JSON.parse(raw); } catch (e) { arr = []; }
        }
        const idx = arr.indexOf(String(chatId));
        if (idx !== -1) arr.splice(idx, 1);
        await redis.set(activeChatsKey, JSON.stringify(arr));
      }
    } catch (e) {
      console.warn('removeActiveChat redis error:', e && e.message ? e.message : e);
    }
    if (activeChats.has(String(chatId))) activeChats.delete(String(chatId));
  }

  async function getPersistedActiveChats() {
    try {
      if (typeof redis.smembers === 'function') {
        const members = await redis.smembers(activeChatsKey);
        if (Array.isArray(members)) return members.map(String);
      } else {
        const raw = await redis.get(activeChatsKey);
        if (raw) {
          try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map(String); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      console.warn('getPersistedActiveChats error:', e && e.message ? e.message : e);
    }
    return Array.from(activeChats).map(String);
  }

  async function loadActiveChatsFromRedis() {
    try {
      const persisted = await getPersistedActiveChats();
      for (const id of persisted) activeChats.add(String(id));
      console.log('[auto-post] Loaded persisted active chats:', activeChats.size);
    } catch (e) {
      console.warn('[auto-post] loadActiveChatsFromRedis failed:', e && e.message ? e.message : e);
    }
  }

  async function isUserAdminInChat(ctx, userId) {
    try {
      if (!ctx.chat) return false;
      const type = ctx.chat.type;
      if (['group', 'supergroup', 'channel'].includes(type)) {
        const admins = await bot.telegram.getChatAdministrators(ctx.chat.id);
        return admins.some(a => a.user && a.user.id === userId);
      }
      if (type === 'private') return true;
      return false;
    } catch (e) {
      console.warn('isUserAdminInChat check failed:', e && e.message ? e.message : e);
      return false;
    }
  }

  // send and return the sent message object (single-attempt function)
  async function sendPostReturnMessage(post, chatId) {
    try {
      if (post.photo) {
        const largest = pickLargestPhoto(post.photo);
        if (!largest || !largest.file_id) throw new Error('No photo file_id');
        return await bot.telegram.sendPhoto(chatId, largest.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.video) {
        return await bot.telegram.sendVideo(chatId, post.video.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.document) {
        return await bot.telegram.sendDocument(chatId, post.document.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.audio) {
        return await bot.telegram.sendAudio(chatId, post.audio.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.voice) {
        return await bot.telegram.sendVoice(chatId, post.voice.file_id, { caption: post.caption || '', caption_entities: post.caption_entities });
      } else if (post.sticker) {
        return await bot.telegram.sendSticker(chatId, post.sticker.file_id);
      } else if (post.text || post.caption) {
        const text = post.text || post.caption || '';
        const entities = post.entities || post.caption_entities || undefined;
        return await bot.telegram.sendMessage(chatId, text, entities ? { entities } : {});
      } else {
        console.log('Unsupported post structure:', post);
        return null;
      }
    } catch (err) {
      console.error(`Failed to send post to ${chatId}:`, err && err.message ? err.message : err);
      throw err; // throw so wrapper can inspect error and retry if needed
    }
  }

  // ---- NEW: retry wrapper for send with handling of 429 retry_after ----
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sendPostWithRetries(post, chatId, opts = {}) {
    const maxRetries = typeof opts.maxRetries === 'number' ? opts.maxRetries : 5;
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const sent = await sendPostReturnMessage(post, chatId);
        return sent || null;
      } catch (err) {
        attempt++;
        // Try to extract retry_after seconds from known places
        let retryAfterSeconds = null;
        try {
          if (err && err.response && err.response.parameters && err.response.parameters.retry_after) {
            retryAfterSeconds = Number(err.response.parameters.retry_after);
          } else if (err && err.description) {
            const m = (err.description || '').match(/retry after (\d+)/i);
            if (m && m[1]) retryAfterSeconds = Number(m[1]);
          } else if (err && err.message) {
            const m = (err.message || '').match(/retry after (\d+)/i);
            if (m && m[1]) retryAfterSeconds = Number(m[1]);
          }
        } catch (parseErr) {
          // ignore parse error, will fallback to exponential backoff
        }

        // If it's clearly a 429, honour the retry_after if present
        const is429 = (err && (err.code === 429 || (err.response && (err.response.statusCode === 429 || err.response.error === 'Too Many Requests')))) ||
          (err && err.response && err.response.description && /too many requests/i.test(err.response.description));
        if (is429 && retryAfterSeconds != null) {
          const delay = (Number(retryAfterSeconds) * 1000) + 250; // small buffer
          console.warn(`[sendPostWithRetries] 429 received for chat ${chatId}. retry_after=${retryAfterSeconds}s — waiting ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await wait(delay);
          // continue to retry
        } else {
          // generic transient handling: use exponential backoff with jitter
          if (attempt > maxRetries) {
            console.error(`[sendPostWithRetries] Giving up sending to ${chatId} after ${attempt - 1} failed attempts.`);
            break;
          }
          const base = Math.min(30, Math.pow(2, attempt)); // cap backoff
          const jitter = Math.floor(Math.random() * 500); // 0-499 ms
          const delay = (base * 1000) + jitter;
          console.warn(`[sendPostWithRetries] Send failed to ${chatId}. attempt ${attempt}/${maxRetries}. backing off ${delay}ms. error:`, (err && err.message) ? err.message : err);
          await wait(delay);
        }
        // next loop will attempt again (if attempt <= maxRetries)
      }
    }
    return null;
  }
  // ---- end retry wrapper ----

  // store mapping of bot-sent messages for deletion polling
  async function recordPostedMessage(chatId, messageId) {
    try {
      const key = `${chatId}:${messageId}`;
      await redis.hset(CLIENT_NAMESPACE, key, String(Date.now()));
    } catch (e) {
      console.error('recordPostedMessage error:', e && e.message ? e.message : e);
    }
  }

  async function removePostedRecord(chatId, messageId) {
    try {
      const key = `${chatId}:${messageId}`;
      await redis.hdel(CLIENT_NAMESPACE, key);
    } catch (e) {
      console.error('removePostedRecord error:', e && e.message ? e.message : e);
    }
  }

  // saved-list helpers (list stores JSON strings)
  async function getSavedLen() {
    try {
      if (typeof redis.llen === 'function') {
        const len = await redis.llen(savedPostsKey);
        return Number(len || 0);
      } else {
        const raw = await redis.lrange(savedPostsKey, 0, -1);
        return Array.isArray(raw) ? raw.length : 0;
      }
    } catch (e) {
      console.warn('getSavedLen error:', e && e.message ? e.message : e);
      return 0;
    }
  }

  async function lpopSaved() {
    try {
      if (typeof redis.lpop === 'function') {
        return await redis.lpop(savedPostsKey);
      } else {
        const arr = await redis.lrange(savedPostsKey, 0, -1);
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const removed = arr.shift();
        await redis.del(savedPostsKey);
        if (arr.length) for (const it of arr) await redis.rpush(savedPostsKey, it);
        return removed || null;
      }
    } catch (e) {
      console.warn('lpopSaved error:', e && e.message ? e.message : e);
      return null;
    }
  }

  async function rpushSaved(itemStr) {
    try {
      if (typeof redis.rpush === 'function') {
        return await redis.rpush(savedPostsKey, itemStr);
      } else {
        const raw = await redis.lrange(savedPostsKey, 0, -1);
        const arr = Array.isArray(raw) ? raw : [];
        arr.push(itemStr);
        await redis.del(savedPostsKey);
        for (const it of arr) await redis.rpush(savedPostsKey, it);
        return arr.length;
      }
    } catch (e) {
      console.error('rpushSaved error:', e && e.message ? e.message : e);
      throw e;
    }
  }

  async function lindexSaved(idx) {
    try {
      if (typeof redis.lindex === 'function') {
        return await redis.lindex(savedPostsKey, idx);
      } else {
        const arr = await redis.lrange(savedPostsKey, 0, -1);
        return Array.isArray(arr) ? arr[idx] || null : null;
      }
    } catch (e) {
      console.warn('lindexSaved error:', e && e.message ? e.message : e);
      return null;
    }
  }

  async function getSavedByIndex(idx) {
    try {
      const str = await lindexSaved(idx);
      if (!str) return null;
      try { return JSON.parse(str); } catch (e) { return null; }
    } catch (e) {
      console.warn('getSavedByIndex error:', e && e.message ? e.message : e);
      return null;
    }
  }

  // delete all posted instances for a savedId (used when trimming oldest saved post)
  async function deleteSavedPostInstances(savedId) {
    try {
      const map = await redis.hgetall(savedPostMapKey) || {};
      const fields = Object.keys(map || {}).filter(f => f.startsWith(`${savedId}:`));
      for (const field of fields) {
        const [, chatId] = field.split(':'); // field is "<savedId>:<chatId>"
        const msgId = map[field];
        try {
          const parsedMsgId = Number(msgId);
          await bot.telegram.deleteMessage(chatId, parsedMsgId || msgId);
          console.log(`[cleanup] Deleted message ${msgId} from chat ${chatId} for saved ${savedId}`);
        } catch (err) {
          console.warn(`[cleanup] Could not delete message ${msgId} from ${chatId}:`, err && err.message ? err.message : err);
        }
        // remove mapping for saved-post and posted_messages entry
        try { await redis.hdel(savedPostMapKey, field); } catch (e) { /* ignore */ }
        try { await redis.hdel(CLIENT_NAMESPACE, `${chatId}:${msgId}`); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.error('deleteSavedPostInstances error:', e && e.message ? e.message : e);
    }
  }

  // reset pointers (simple approach) when the saved list changes shape
  async function resetAllPointers() {
    try {
      const chats = await getPersistedActiveChats();
      for (const chatId of chats) {
        try { await redis.set(`${pointerKeyPrefix}${chatId}`, '0'); } catch (_) { /* ignore */ }
      }
    } catch (e) {
      console.warn('resetAllPointers error:', e && e.message ? e.message : e);
    }
  }

  // push saved item and enforce maxSavedPosts
  async function pushSavedPostRaw(messageObj) {
    if (isBotCommandMessage(messageObj)) {
      throw new Error('message is a command or bot-origin; will not be saved');
    }
    const saved = {
      id: makeSavedId(),
      created_at: Date.now(),
      message: messageObj
    };
    const str = JSON.stringify(saved);
    await rpushSaved(str);

    // enforce maxSavedPosts
    try {
      let len = await getSavedLen();
      while (len > maxSavedPosts) {
        const removed = await lpopSaved();
        if (removed) {
          try {
            const parsed = JSON.parse(removed);
            if (parsed && parsed.id) {
              await deleteSavedPostInstances(parsed.id);
            }
          } catch (e) { /* ignore */ }
        }
        len = await getSavedLen();
      }
      // reset pointers so rotation aligns with new list
      await resetAllPointers();
    } catch (e) {
      console.error('Error enforcing maxSavedPosts:', e && e.message ? e.message : e);
    }
    return saved.id;
  }

  // post entire saved list to a chat (used by daily repost)
  async function postAllSavedToChat(chatId) {
    try {
      const len = await getSavedLen();
      if (!len || len === 0) return;
      for (let i = 0; i < len; i++) {
        const saved = await getSavedByIndex(i);
        if (!saved || !saved.message) continue;
        // skip command-saved entries just in case
        if (isBotCommandMessage(saved.message)) continue;

        // Use retrying sender
        const sent = await sendPostWithRetries(saved.message, chatId);
        if (sent && sent.message_id) {
          // record posted message + mapping savedId:chatId -> messageId
          try {
            await recordPostedMessage(chatId, sent.message_id);
            const field = `${saved.id}:${chatId}`;
            await redis.hset(savedPostMapKey, field, String(sent.message_id));
          } catch (e) { /* ignore */ }
        } else {
          console.warn(`[postAllSavedToChat] Failed to send saved ${saved.id} to ${chatId} after retries.`);
        }
        // short gap between messages per chat to avoid hitting limits
        await new Promise((r) => setTimeout(r, 600)); // 600ms
      }
    } catch (e) {
      console.error('postAllSavedToChat error:', e && e.message ? e.message : e);
    }
  }

  // NOTE: Immediate broadcast is disabled
  async function broadcastNewSavedPost(savedObj) {
    return;
  }

  // Remove a saved item by ID (rewrite list) and clean posted instances
  async function deleteSavedById(savedId) {
    try {
      const arr = await redis.lrange(savedPostsKey, 0, -1) || [];
      const filtered = [];
      for (const s of arr) {
        try {
          const p = JSON.parse(s);
          if (p && p.id === savedId) continue;
          filtered.push(JSON.stringify(p));
        } catch (e) { /* ignore malformed */ }
      }
      await redis.del(savedPostsKey);
      for (const item of filtered) await redis.rpush(savedPostsKey, item);
      // cleanup posted instances
      await deleteSavedPostInstances(savedId);
      // reset pointers for safety
      await resetAllPointers();
    } catch (e) {
      console.error('deleteSavedById error:', e && e.message ? e.message : e);
    }
  }

  // delete all tracked bot-posted messages (CLIENT_NAMESPACE) and savedPostMap entries (used by daily job)
  async function deleteAllTrackedMessages() {
    try {
      const map = await redis.hgetall(CLIENT_NAMESPACE) || {};
      const keys = Object.keys(map || {});
      for (const key of keys) {
        try {
          const [chatId, messageId] = key.split(':');
          if (!chatId || !messageId) {
            await redis.hdel(CLIENT_NAMESPACE, key);
            continue;
          }
          const parsedMsgId = Number(messageId);
          try { await bot.telegram.deleteMessage(chatId, parsedMsgId || messageId); } catch (err) { /* ignore errors */ }
          await redis.hdel(CLIENT_NAMESPACE, key);
        } catch (e) {
          console.warn('deleteAllTrackedMessages loop error:', e && e.message ? e.message : e);
        }
      }
      // wipe savedPostMap entries (they reference old message ids)
      const spm = await redis.hgetall(savedPostMapKey) || {};
      for (const field of Object.keys(spm || {})) {
        await redis.hdel(savedPostMapKey, field);
      }
    } catch (e) {
      console.error('deleteAllTrackedMessages error:', e && e.message ? e.message : e);
    }
  }

  // daily job: delete all tracked messages, then repost full saved list to each chat (with small spacing)
  async function dailyDeleteAllAndRepost() {
    if (runningDailyJob) return;
    runningDailyJob = true;
    try {
      console.log('[daily-job] Starting delete-all & repost');
      // 1) delete all tracked
      await deleteAllTrackedMessages();
      // small settle
      await new Promise((r) => setTimeout(r, 500));
      // 2) for each chat, post all saved posts
      const chats = await getPersistedActiveChats();
      for (const chatId of chats) {
        try {
          await postAllSavedToChat(chatId);
          // small gap between chats to be safe
          await new Promise((r) => setTimeout(r, 800)); // 800ms
        } catch (e) {
          console.warn('[daily-job] postAllSavedToChat error for', chatId, e && e.message ? e.message : e);
        }
      }
      // notify
      try {
        const notifier = await redis.get(notifierChatKey);
        if (notifier) {
          await bot.telegram.sendMessage(notifier, `✅ Completed daily delete+repost at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        }
      } catch (e) { /* ignore */ }
      console.log('[daily-job] Completed delete-all & repost');
    } catch (e) {
      console.error('dailyDeleteAllAndRepost error:', e && e.message ? e.message : e);
    } finally {
      runningDailyJob = false;
    }
  }

  // schedule update
  async function updateSchedule() {
    try {
      const cronExpr = (await redis.get(scheduleCronKey)) || defaultCron;
      if (!cron.validate(cronExpr)) {
        console.error(`Invalid cron expression in redis: ${cronExpr}. Resetting to default ${defaultCron}`);
        await redis.set(scheduleCronKey, defaultCron);
        return updateSchedule();
      }
      if (dailyTask) {
        try { dailyTask.stop(); } catch (_) { /* ignore */ }
        dailyTask = null;
      }
      dailyTask = cron.schedule(cronExpr, async () => {
        console.log('[auto-post] daily cron triggered', new Date().toISOString());
        try { await dailyDeleteAllAndRepost(); } catch (e) { console.error(e); }
      }, { timezone: 'Asia/Kolkata' });
      console.log('[auto-post] Daily cron scheduled:', cronExpr);
    } catch (e) {
      console.error('updateSchedule error:', e && e.message ? e.message : e);
    }
  }

  // Polling: every 10s detect manual deletion of bot-sent messages
  async function startPollTask() {
    if (pollTask) {
      try { pollTask.stop(); } catch (_) { }
      pollTask = null;
    }
    // 6-field cron '*/10 * * * * *' runs every 10 seconds
    pollTask = cron.schedule('*/10 * * * * *', async () => {
      if (runningDailyJob) return; // don't interfere with daily job
      try {
        const messages = await redis.hgetall(CLIENT_NAMESPACE) || {};
        if (!messages || Object.keys(messages).length === 0) return;
        for (const [key, ts] of Object.entries(messages)) {
          try {
            const [chatId, messageId] = key.split(':');
            if (!chatId || !messageId) {
              await redis.hdel(CLIENT_NAMESPACE, key);
              continue;
            }
            // Try a harmless edit to check existence
            try {
              await bot.telegram.editMessageReplyMarkup(chatId, Number(messageId) || messageId, undefined, {});
              // exists
            } catch (err) {
              const desc = err && err.response && err.response.description ? err.response.description.toLowerCase() : (err && err.message ? err.message.toLowerCase() : '');
              // If 429 during edit check, just log and skip (to avoid tight loop)
              if (err && err.response && err.response.parameters && err.response.parameters.retry_after) {
                const ra = Number(err.response.parameters.retry_after);
                console.warn(`[poll] editMessageReplyMarkup hit 429 for ${chatId}:${messageId}. retry_after=${ra}s — skipping this item for now.`);
                // do not delete mapping; skip to next entry
                continue;
              }
              if (desc.includes('message to edit not found') || desc.includes('message not found') || desc.includes('message_id_invalid')) {
                // manual deletion detected — find savedId for this chat/message
                try {
                  await redis.hdel(CLIENT_NAMESPACE, key);
                } catch (_) { }
                // find mapping in savedPostMapKey
                const map = await redis.hgetall(savedPostMapKey) || {};
                const match = Object.entries(map).find(([field, msgId]) => {
                  const parts = field.split(':'); // savedId:chatId
                  return parts[1] === String(chatId) && String(msgId) === String(messageId);
                });
                if (match) {
                  const [field, msgId] = match;
                  const [savedId] = field.split(':');
                  // remove mapping field
                  try { await redis.hdel(savedPostMapKey, field); } catch (_) { }
                  // repost that savedId message to this chat
                  // first find saved object by scanning list (could optimize with savedId->index map)
                  const arr = await redis.lrange(savedPostsKey, 0, -1) || [];
                  let foundSaved = null;
                  for (const s of arr) {
                    try {
                      const p = JSON.parse(s);
                      if (p && p.id === savedId) { foundSaved = p; break; }
                    } catch (e) { /* ignore */ }
                  }
                  if (foundSaved && foundSaved.message) {
                    try {
                      // Use retrying sender when reposting
                      const sent = await sendPostWithRetries(foundSaved.message, chatId);
                      if (sent && sent.message_id) {
                        await recordPostedMessage(chatId, sent.message_id);
                        const newField = `${savedId}:${chatId}`;
                        await redis.hset(savedPostMapKey, newField, String(sent.message_id));
                        console.log(`[poll] Reposted saved ${savedId} to ${chatId} after manual delete of ${messageId}`);
                      } else {
                        console.warn(`[poll] Repost failed for saved ${savedId} to ${chatId} after manual delete of ${messageId}`);
                      }
                    } catch (e) {
                      console.error('[poll] repost after manual delete failed:', e && e.message ? e.message : e);
                    }
                  } else {
                    // if saved not found (maybe trimmed), nothing to repost
                    console.log(`[poll] Manual delete detected for ${messageId} in ${chatId} but saved ${savedId} not found`);
                  }
                } else {
                  // mapping not found — maybe old or we don't manage it; just remove record
                  console.log(`[poll] Manual delete detected for ${messageId} in ${chatId} but no saved mapping found`);
                }
              }
            }
          } catch (inner) {
            console.warn('poll loop inner error:', inner && inner.message ? inner.message : inner);
          }
        }
      } catch (e) {
        console.error('pollTask error:', e && e.message ? e.message : e);
      }
    }, { scheduled: true, timezone: 'Asia/Kolkata' });
  }

  // startup tasks
  (async () => {
    await loadActiveChatsFromRedis();

    // cleanup saved commands at startup
    try {
      const arr = await redis.lrange(savedPostsKey, 0, -1) || [];
      if (Array.isArray(arr) && arr.length > 0) {
        const keep = [];
        for (const s of arr) {
          try {
            const p = JSON.parse(s);
            if (!p || !p.message) continue;
            if (isBotCommandMessage(p.message)) {
              // remove posted instances if any
              if (p && p.id) await deleteSavedPostInstances(p.id);
              continue;
            }
            keep.push(JSON.stringify(p));
          } catch (e) { /* ignore */ }
        }
        await redis.del(savedPostsKey);
        for (const it of keep) await redis.rpush(savedPostsKey, it);
        if (keep.length !== arr.length) console.log('[startup] Removed command/bot-origin saved items');
      }
    } catch (e) {
      console.error('startup cleanup error:', e && e.message ? e.message : e);
    }

    await updateSchedule();
    await startPollTask();
  })();

  // graceful shutdown
  function shutdownAll() {
    try { if (dailyTask) dailyTask.stop(); } catch (_) { }
    try { if (pollTask) pollTask.stop(); } catch (_) { }
  }
  process.once('SIGINT', shutdownAll);
  process.once('SIGTERM', shutdownAll);

  // --- bot event handlers ---

  bot.on('my_chat_member', async (ctx) => {
    try {
      const update = ctx.myChatMember;
      const chatId = String(update.chat.id);
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

  // --- Save session flow ---
  // /save starts a save session for the admin user (no replies while saving)
  bot.command('save', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can start a save session.');

      const sessionKey = `${waitingForPostPrefix}${userId}`;
      const pendingKey = pendingListKeyFor(userId);

      // initialize: clear any old pending list and set session flag
      try { await redis.del(pendingKey); } catch (_) { /* ignore */ }
      await redis.set(sessionKey, 'session', 'EX', 3600); // session valid for 1 hour
      // single reply to inform session started
      await ctx.reply('🟢 Save session started. Send your posts one-by-one. When finished, send /end to save them.');
      console.log(`/save: started session for ${userId}`);
    } catch (err) {
      console.error('/save error:', err && err.message ? err.message : err);
      try { await ctx.reply('An error occurred.'); } catch (_) { }
    }
  });

  // /end finishes the session: save buffered messages and reply once with count
  bot.command('end', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can end a save session.');

      const sessionKey = `${waitingForPostPrefix}${userId}`;
      const pendingKey = pendingListKeyFor(userId);
      const sessionFlag = await redis.get(sessionKey);
      if (!sessionFlag) {
        return ctx.reply('No active save session found. Start with /save.');
      }

      // fetch buffered messages
      const buffered = await redis.lrange(pendingKey, 0, -1) || [];
      if (!Array.isArray(buffered) || buffered.length === 0) {
        // cleanup
        await redis.del(sessionKey).catch(() => { });
        await redis.del(pendingKey).catch(() => { });
        return ctx.reply('No posts were provided during the session.');
      }

      // keep only latest up to maxSavedPosts from this session
      const toSaveRaw = buffered.slice(-maxSavedPosts); // array of JSON strings (oldest..newest)
      let savedCount = 0;
      for (const raw of toSaveRaw) {
        try {
          const msgObj = JSON.parse(raw);
          if (!msgObj) continue;
          if (isBotCommandMessage(msgObj)) continue; // extra safety
          await pushSavedPostRaw(msgObj);
          savedCount++;
        } catch (e) {
          // ignore parse or save errors for single items
          console.warn('Failed to save one buffered message:', e && e.message ? e.message : e);
        }
      }

      // cleanup session
      await redis.del(sessionKey).catch(() => { });
      await redis.del(pendingKey).catch(() => { });

      await ctx.reply(`✅ Session ended. ${savedCount} post(s) saved (latest ${maxSavedPosts} from session considered).`);
      console.log(`/end: session for ${userId} saved ${savedCount} posts.`);
    } catch (err) {
      console.error('/end error:', err && err.message ? err.message : err);
      try { await ctx.reply('An error occurred while ending the session.'); } catch (_) { }
    }
  });

  // main message handler: handles waiting-for-time first, then session buffering
  bot.on('message', async (ctx, next) => {
    const chatIdStr = ctx.chat && ctx.chat.id ? String(ctx.chat.id) : null;
    try {
      // keep active presence up-to-date
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
      } catch (e) {
        console.error('[message] admin check error:', e && e.message ? e.message : e);
      }

      // workflows: waitingForTime handling (must run BEFORE session buffering)
      try {
        const userId = ctx.from && ctx.from.id ? ctx.from.id : null;
        if (userId) {
          const waitingForSchedule = await redis.get(`${waitingForTimePrefix}${userId}`);
          if (waitingForSchedule) {
            // we handle only text messages as time input
            const textRaw = (ctx.message && ctx.message.text) ? ctx.message.text.trim() : '';
            // remove the waiting flag immediately (to avoid race)
            await redis.del(`${waitingForTimePrefix}${userId}`).catch(() => { });
            if (!textRaw) {
              try { await ctx.reply('Invalid time input. Please send like 08:12AM or 12:00PM.'); } catch (_) { }
              return;
            }

            // Accept multiple common formats: 08:12AM, 8:12AM, 20:12, 08:12 etc.
            const formats = ['hh:mmA', 'h:mmA', 'HH:mm', 'H:mm'];
            const parsedIST = moment.tz(textRaw.toUpperCase(), formats, 'Asia/Kolkata');
            if (!parsedIST.isValid()) {
              try { await ctx.reply('Invalid time format. Please use like 08:12AM, 8:12AM, or 20:12.'); } catch (_) { }
              return;
            }

            const minute = parsedIST.minute();
            const hour = parsedIST.hour();
            const newCron = `${minute} ${hour} * * *`; // daily schedule in IST

            if (!cron.validate(newCron)) {
              try { await ctx.reply('Generated cron expression is invalid. Please try another time.'); } catch (_) { }
              return;
            }

            await redis.set(scheduleCronKey, newCron);
            // set notifier chat with 30 days expiry
            if (chatIdStr) {
              try { await redis.set(notifierChatKey, chatIdStr, 'EX', 86400 * 30); } catch (_) { }
            }
            // Update schedule task
            try { await updateSchedule(); } catch (e) { console.error('Failed to update schedule after settime:', e && e.message ? e.message : e); }
            try { await ctx.reply(`✅ Daily delete+repost set to ${parsedIST.format('hh:mmA')} IST.`); } catch (_) { }
            console.log(`[settime] updated daily cron to ${newCron} by ${userId}`);
            return;
          }
        }
      } catch (err) {
        console.error('[message] waitingForTime handler error:', err && err.message ? err.message : err);
      }

      // buffer messages if user has an active save session
      try {
        const userId = ctx.from && ctx.from.id ? ctx.from.id : null;
        if (!userId) return;

        const sessionKey = `${waitingForPostPrefix}${userId}`;
        const pendingKey = pendingListKeyFor(userId);
        const sessionFlag = await redis.get(sessionKey);

        // if session active and this message is supported and not a command -> buffer
        if (sessionFlag) {
          // skip commands and bot-origin
          if (isBotCommandMessage(ctx.message)) {
            // do not buffer commands (/settime, /end, etc.)
            return;
          }
          // supported content types
          const allowed = ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'text', 'caption'];
          const hasSupported = allowed.some(type => ctx.message && ctx.message[type]);
          const isMediaWithCaption = ctx.message && (ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.audio || ctx.message.voice);

          if (!hasSupported && !isMediaWithCaption) {
            // unsupported content during session -> ignore silently
            return;
          }

          try {
            // buffer full message JSON (stringified)
            const raw = JSON.stringify(ctx.message);
            await redis.rpush(pendingKey, raw);
            // do NOT reply on each buffered message to keep performance high (as requested)
            // (we will reply once on /end)
          } catch (e) {
            console.error('Failed to buffer session message:', e && e.message ? e.message : e);
          }
          return;
        }

        // if not in session: normal flows (no auto-save on private messages)
      } catch (err) {
        console.error('[message] session buffer error:', err && err.message ? err.message : err);
      }
    } finally {
      try { await next(); } catch (e) { /* ignore */ }
    }
  });

  // callback queries (preview save) — saving via preview still allowed but no immediate broadcast
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
        let parsed;
        try { parsed = JSON.parse(pendingJson); } catch (e) { parsed = null; }
        if (!parsed) { try { await ctx.answerCbQuery('Failed to save post.'); } catch (_) { } return; }
        if (isBotCommandMessage(parsed)) {
          try { await ctx.answerCbQuery('Cannot save command or bot message.'); await ctx.editMessageText('Cannot save command or bot message.'); } catch (_) { }
          await redis.del(pendingKey);
          return;
        }
        const savedId = await pushSavedPostRaw(parsed);
        const len = await getSavedLen();
        const savedIndex = Math.max(0, len - 1);
        await redis.del(pendingKey);
        try { await ctx.answerCbQuery('Post saved!'); await ctx.editMessageText('Post successfully saved! (Broadcast disabled)'); } catch (_) { }
        console.log(`[callback] saved ${savedId} (broadcast disabled)`);
      } else if (data === 'save_no') {
        await redis.del(`${pendingPostPrefix}${userId}`);
        try { await ctx.answerCbQuery('Post not saved.'); await ctx.editMessageText('Post not saved.'); } catch (_) { }
      }
    } catch (e) {
      console.error('callback_query error:', e && e.message ? e.message : e);
      try { await ctx.answerCbQuery('An error occurred.'); } catch (_) { }
    }
  });

  // admin commands: /settime, /setTime (legacy), /clear remain as before
  bot.command('settime', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can set the daily delete+repost time.');
      await redis.set(`${waitingForTimePrefix}${userId}`, 'true', 'EX', 3600);
      await ctx.reply('Send the daily time for delete+repost (e.g., 08:12AM or 20:12).');
    } catch (e) {
      console.error('/settime error:', e && e.message ? e.message : e);
      await ctx.reply('An error occurred.');
    }
  });

  bot.command('clear', async (ctx) => {
    const userId = ctx.from && ctx.from.id;
    try {
      const isAdmin = await isUserAdminInChat(ctx, userId);
      if (!isAdmin) return ctx.reply('Only admins can clear saved posts.');
      await redis.del(savedPostsKey);
      await redis.del(savedPostMapKey);
      await redis.del(CLIENT_NAMESPACE);
      await ctx.reply('All saved posts cleared (and mappings removed).');
      console.log('/clear invoked');
    } catch (e) {
      console.error('/clear error:', e && e.message ? e.message : e);
      await ctx.reply('An error occurred while clearing.');
    }
  });

  // Legacy /setTime (duration) handlers (optional)
  function parseDurationToMs(input) {
    const match = /^(\d+)([smhd])$/.exec(input);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    if (unit === 'd') return value * 24 * 60 * 60 * 1000;
    return null;
  }

  bot.command('setTime', async (ctx) => {
    try {
      const adminId = String(ctx.from && ctx.from.id ? ctx.from.id : ctx.chat.id);
      if (!adminId) return ctx.reply('Server misconfigured.');
      if (pendingDeleteReplies[adminId]) return ctx.reply('You already have a pending /setTime request.');
      await ctx.reply('Send auto-delete duration (e.g., 10s, 1m, 5m, 1h). Minimum 10s (legacy).');
      const timeoutId = setTimeout(async () => {
        if (pendingDeleteReplies[adminId]) { delete pendingDeleteReplies[adminId]; try { await ctx.reply('Timeout: /setTime cancelled'); } catch (_) { } }
      }, 2 * 60 * 1000);
      pendingDeleteReplies[adminId] = { chatId: String(ctx.chat.id), timeoutId };
    } catch (e) { console.error('/setTime legacy error:', e && e.message ? e.message : e); try { await ctx.reply('Internal error'); } catch (_) { } }
  });

  bot.on('text', async (ctx, next) => {
    try {
      const fromId = String(ctx.from && ctx.from.id ? ctx.from.id : '');
      if (!fromId) return await next();
      const pending = pendingDeleteReplies[fromId];
      if (!pending) return await next();
      const chatIdStr = String(ctx.chat && ctx.chat.id ? ctx.chat.id : '');
      if (chatIdStr !== String(pending.chatId)) { await ctx.reply('Please reply in same chat where you ran /setTime'); return; }
      const text = (ctx.message && ctx.message.text) ? ctx.message.text.trim().toLowerCase() : '';
      const ms = parseDurationToMs(text);
      if (!ms) { await ctx.reply('Invalid format. Use 10s, 1m, 1h, etc.'); return; }
      if (ms < 10000) { await ctx.reply('Minimum 10s.'); return; }
      await redis.set(DELETE_TIME_KEY, String(ms));
      await ctx.reply(`(Legacy) Auto-delete duration set to ${text}`);
      try { clearTimeout(pending.timeoutId); } catch (_) { }
      delete pendingDeleteReplies[fromId];
      return;
    } catch (e) {
      console.error('legacy setTime reply error:', e && e.message ? e.message : e);
      try { await ctx.reply('Failed to set.'); } catch (_) { }
      return;
    }
  });

  // Expose helpers
  bot.__autoPost = {
    postAllSavedToChat,
    deleteSavedById,
    getSavedLen,
    updateSchedule,
    dailyDeleteAllAndRepost: dailyDeleteAllAndRepost
  };

  console.log('[auto-post] Module initialized - save-session mode enabled, broadcasting OFF.');
};
