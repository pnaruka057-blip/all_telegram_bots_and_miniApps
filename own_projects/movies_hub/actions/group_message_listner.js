const { Markup } = require("telegraf");

const movies_module = require("../models/movies_module");
const shows_module = require("../models/shows_module");
const redis = require("../../../globle_helper/redisConfig");
const users_module = require("../models/users_module");
const checkUserInChannel = require("../helpers/checkUserInChannel");
const encode_payload = require("../helpers/encode_payload");
const MSG_TTL_SECONDS = 10 * 60; // 10 minutes
const MSG_TTL_MS = MSG_TTL_SECONDS * 1000;

const ACCESS_TTL_SECONDS = 3 * 60; // 3 minutes (verification prompts)
const ACCESS_TTL_MS = ACCESS_TTL_SECONDS * 1000;

module.exports = (bot) => {
  const botAdminCache = new Map();
  const memberRoleCache = new Map();
  const accessPromptCache = new Map(); // chatId:userId -> last prompt message_id

  let botInfoPromise = null;

  async function getBotInfo() {
    if (!botInfoPromise) botInfoPromise = bot.telegram.getMe();
    return botInfoPromise;
  }

  async function getBotUsername() {
    const me = await getBotInfo();
    return me && me.username ? me.username : null;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function mentionUserHtml(user) {
    const name = escapeHtml(user?.first_name || user?.username || "User");
    const id = user?.id;
    if (!id) return name;
    return `<a href="tg://user?id=${id}">${name}</a>`;
  }

  function normalizeChannelUsername(raw) {
    const v = String(raw || "").trim();
    if (!v) return null;
    const clean = v.startsWith("@") ? v.slice(1) : v;
    // If it's numeric chat id like -100..., t.me link won't work without username.
    if (/^-?\d+$/.test(clean)) return null;
    return clean;
  }

  async function getStartBotUrl() {
    const envUsername = String(process.env.BOT_USERNAME_MOVIEHUB || "").trim();
    const username = envUsername || (await getBotUsername());
    if (!username) return null;
    return `https://t.me/${username}`;
  }

  function getJoinChannelUrl() {
    const ch = normalizeChannelUsername(
      process.env.CHANNEL_ID_MOVIEHUB
    );
    if (!ch) return null;
    return `https://t.me/${ch}`;
  }

  function buildAccessKeyboard({ needsChannel, needsStart, userId }) {
    const rows = [];

    const joinUrl = getJoinChannelUrl();
    if (needsChannel) {
      if (joinUrl) rows.push([{ text: "📢 Join Official Channel", url: joinUrl }]);
      else rows.push([{ text: "📢 Join Official Channel", callback_data: "JOIN_CHANNEL_NOT_CONFIGURED" }]);
    }

    // Start button (URL)
    if (needsStart) {
      rows.push([{ text: "🚀 Start Bot", url: "https://t.me/" }]);
    }

    // Verify button (callback)
    rows.push([{ text: "✅ Verify Access", callback_data: `VERIFY_GROUP:${userId}` }]);

    return { reply_markup: { inline_keyboard: rows } };
  }

  async function patchStartButtonUrl(keyboard) {
    // Replace placeholder start url (https://t.me/) with actual bot URL if possible.
    try {
      const startUrl = await getStartBotUrl();
      const kb = JSON.parse(JSON.stringify(keyboard));

      for (const row of kb.reply_markup.inline_keyboard) {
        for (const btn of row) {
          if (btn.url === "https://t.me/") {
            if (startUrl) {
              btn.url = startUrl;
            } else {
              delete btn.url;
              btn.callback_data = "START_BOT_NOT_CONFIGURED";
            }
          }
        }
      }

      return kb;
    } catch (e) {
      return keyboard;
    }
  }

  // Robust Redis save supporting multiple client shapes
  async function saveMessageToRedis(chatId, messageId, meta = {}) {
    const key = `moviehub:msg:${chatId}:${messageId}`;
    const val = JSON.stringify({ chatId, messageId, ts: Date.now(), ...meta });

    try {
      if (typeof redis.set === "function") {
        try {
          // many clients support: set(key, value, 'EX', seconds)
          if (redis.set.length >= 4) {
            await redis.set(key, val, "EX", MSG_TTL_SECONDS);
          } else {
            // some node-redis v4 accept options object
            await redis.set(key, val, { EX: MSG_TTL_SECONDS });
          }
        } catch (inner) {
          if (typeof redis.setex === "function") {
            await redis.setex(key, MSG_TTL_SECONDS, val);
          } else {
            await redis.set(key, val);
            if (typeof redis.expire === "function") await redis.expire(key, MSG_TTL_SECONDS);
          }
        }
      } else if (typeof redis.setex === "function") {
        await redis.setex(key, MSG_TTL_SECONDS, val);
      } else {
        console.warn("Redis client doesn't support set/setex; skipping redis save");
      }

      // add to per-chat list for easier cleanup
      const listKey = `moviehub:msgs:${chatId}`;
      try {
        if (typeof redis.lPush === "function") await redis.lPush(listKey, key);
        else if (typeof redis.lpush === "function") await redis.lpush(listKey, key);
        else if (typeof redis.rpush === "function") await redis.rpush(listKey, key);
        if (typeof redis.expire === "function") await redis.expire(listKey, MSG_TTL_SECONDS);
      } catch (errList) {
        // non-fatal
      }
    } catch (err) {
      // log exact error for debugging (you saw ReplyError earlier)
      console.error("Redis save error:", err);
    }
  }

  function scheduleDeleteMessage(chatId, messageId, ttlMs = MSG_TTL_MS) {
    setTimeout(async () => {
      try {
        await bot.telegram.deleteMessage(chatId, messageId).catch(() => { });
      } catch (e) {
        // ignore
      }
    }, ttlMs);
  }



  function isServiceMessage(msg) {
    if (!msg) return false;

    return Boolean(
      msg.new_chat_members ||
      msg.left_chat_member ||
      msg.new_chat_title ||
      msg.new_chat_photo ||
      msg.delete_chat_photo ||
      msg.group_chat_created ||
      msg.supergroup_chat_created ||
      msg.channel_chat_created ||
      msg.message_auto_delete_timer_changed ||
      msg.pinned_message ||
      msg.migrate_to_chat_id ||
      msg.migrate_from_chat_id ||
      msg.video_chat_started ||
      msg.video_chat_ended ||
      msg.video_chat_scheduled ||
      msg.video_chat_participants_invited ||
      msg.proximity_alert_triggered ||
      msg.forum_topic_created ||
      msg.forum_topic_closed ||
      msg.forum_topic_reopened ||
      msg.general_forum_topic_hidden ||
      msg.general_forum_topic_unhidden
    );
  }
  async function isBotAdminInChat(chatId) {
    const cached = botAdminCache.get(chatId);
    if (cached && Date.now() - cached._ts < 5 * 60 * 1000) return cached.isAdmin;

    try {
      const me = await getBotInfo();
      const member = await bot.telegram.getChatMember(chatId, me.id);
      const isAdmin = ["administrator", "creator"].includes(member.status);
      botAdminCache.set(chatId, { isAdmin, _ts: Date.now() });
      return isAdmin;
    } catch (err) {
      console.error("isBotAdminInChat error:", err);
      botAdminCache.set(chatId, { isAdmin: false, _ts: Date.now() });
      return false;
    }
  }

  async function getUserRoleInChat(chatId, userId) {
    const key = `${chatId}:${userId}`;
    const cached = memberRoleCache.get(key);
    if (cached && Date.now() - cached._ts < 2 * 60 * 1000) return cached.status;

    try {
      const member = await bot.telegram.getChatMember(chatId, userId);
      const status = member?.status || "member";
      memberRoleCache.set(key, { status, _ts: Date.now() });
      return status;
    } catch (e) {
      // if cannot check, assume normal member
      memberRoleCache.set(key, { status: "member", _ts: Date.now() });
      return "member";
    }
  }

  async function isUserAdminOrOwner(chatId, userId) {
    const status = await getUserRoleInChat(chatId, userId);
    return ["administrator", "creator"].includes(status);
  }

  // Build keyboard: prefer web_app if in private chat; otherwise provide t.me URL (recommended for groups)
  async function buildKeyboard({ moviesCount = 0, showsCount = 0, query, fromId, user_id }) {
    const appShort = (process.env.MOVIES_HUB_APP_SHORTNAME || "").trim(); // optional shortname registered via BotFather
    const botUsername = String(process.env.BOT_USERNAME_MOVIEHUB || "").trim();

    const rows = [];

    if (botUsername && appShort) {
      if (moviesCount > 0) {
        const tme = `https://t.me/${botUsername}/${appShort}?startapp=${encode_payload(`${"movies-hub"}:${"movies"}:${query}:${fromId}:${user_id}`)}`;
        rows.push([{ text: `⬇️ Download Movies (${moviesCount})`, url: tme }]);
      }

      if (showsCount > 0) {
        const tme2 = `https://t.me/${botUsername}/${appShort}?startapp=${encode_payload(`${"movies-hub"}:${"shows"}:${query}:${fromId}:${user_id}`)}`;
        rows.push([{ text: `⬇️ Download Shows (${showsCount})`, url: tme2 }]);
      }

      const reqTme = `https://t.me/${botUsername}/${appShort}?startapp=${encode_payload(`${"movies-hub"}:${"request"}:${query}:${fromId}:${user_id}`)}`;
      rows.push([{ text: "🎬 Request This", url: reqTme }]);

      return { reply_markup: { inline_keyboard: rows } };
    }

    // fallback direct startapp link without appShort
    if (botUsername) {
      if (moviesCount > 0) {
        const tme = `https://t.me/${botUsername}?startapp=${encode_payload(`${"movies-hub"}:${"movies"}:${query}:${fromId}:${user_id}`)}`;
        rows.push([{ text: `⬇️ Download Movies (${moviesCount})`, url: tme }]);
      }

      if (showsCount > 0) {
        const tme2 = `https://t.me/${botUsername}?startapp=${encode_payload(`${"movies-hub"}:${"shows"}:${query}:${fromId}:${user_id}`)}`;
        rows.push([{ text: `⬇️ Download Shows (${showsCount})`, url: tme2 }]);
      }

      const reqTme = `https://t.me/${botUsername}?startapp=${encode_payload(`${"movies-hub"}:${"request"}:${query}:${fromId}:${user_id}`)}`;
      rows.push([{ text: "🎬 Request This", url: reqTme }]);

      return { reply_markup: { inline_keyboard: rows } };
    }

    // nothing available
    return Markup.inlineKeyboard([[Markup.button.callback("No mini-app available", "NO_MINI_APP")]]);
  }

  function escapeMarkdown(text) {
    if (!text) return "";
    return text.replace(/([_*[\\]()~`>#+\\-=|{}.!])/g, "\\$1");
  }

  function isUserBlocked(userRecord) {
    if (!userRecord) return true;
    return Boolean(userRecord.is_blocked || userRecord.isblocked || userRecord.isBlocked);
  }

  async function sendAccessPrompt({ ctx, msg, needsChannel, needsStart, reason }) {
    const hi = mentionUserHtml(msg.from);

    let text = `Hii ${hi},\n\n`;
    if (needsChannel && needsStart) {
      text += `To use this group, please join the official channel and start the bot once.\n`;
      text += `Then tap “Verify Access”.`;
    } else if (needsChannel) {
      text += `Please join the official channel first, then tap “Verify Access” to continue.`;
    } else {
      // needsStart only
      text += `Your account is not verified yet.\n`;
      text += `Please start the bot once, then tap “Verify Access” to continue.`;
    }

    if (reason === "blocked") {
      text += `\n\nIf the bot was blocked, unblock it and press Start again.`;
    }

    // Delete previous prompt for this user in this chat (to avoid multiple verify posts)
    const promptKey = `${msg.chat.id}:${msg.from.id}`;
    const prevPromptId = accessPromptCache.get(promptKey);
    if (prevPromptId) {
      try {
        await bot.telegram.deleteMessage(msg.chat.id, prevPromptId).catch(() => { });
      } catch (e) { }
    }

    let keyboard = buildAccessKeyboard({ needsChannel, needsStart, userId: msg.from.id });
    keyboard = await patchStartButtonUrl(keyboard);

    const sent = await ctx.reply(text, {
      parse_mode: "HTML",
      ...(msg && msg.message_id ? { reply_to_message_id: msg.message_id } : {}),
      reply_markup: keyboard.reply_markup
    });

    await saveMessageToRedis(msg.chat.id, sent.message_id, { from: (await getBotInfo()).id, isBot: true, type: "access_prompt" });
    accessPromptCache.set(`${msg.chat.id}:${msg.from.id}`, sent.message_id);
    scheduleDeleteMessage(msg.chat.id, sent.message_id, ACCESS_TTL_MS);
  }

  // Verify button handler
  bot.action(/^VERIFY_GROUP:(\d+)$/, async (ctx) => {
    try {
      const expectedUserId = Number(ctx.match[1]);
      const clickerId = ctx.from?.id;

      if (!clickerId) return;
      if (clickerId !== expectedUserId) {
        await ctx.answerCbQuery("This button is not for you.", { show_alert: true }).catch(() => { });
        return;
      }

      const chatId = ctx.chat?.id;
      if (!chatId) return;

      // Channel check
      let inChannel = false;
      try {
        inChannel = await checkUserInChannel(clickerId, bot);
      } catch (e) {
        inChannel = false;
      }

      // DB check
      let userRecord = null;
      try {
        userRecord = await users_module.findOne({ user_id: clickerId }).lean();
      } catch (e) {
        userRecord = null;
      }

      const blocked = isUserBlocked(userRecord);
      const hasDb = Boolean(userRecord) && !blocked;

      if (inChannel && hasDb) {
        await ctx.answerCbQuery("Verified!", { show_alert: false }).catch(() => { });

        // Instantly delete the verify prompt message (post) for this user
        try {
          const promptMsgId = ctx.callbackQuery?.message?.message_id;
          if (promptMsgId) await bot.telegram.deleteMessage(chatId, promptMsgId).catch(() => { });
        } catch (e) { }

        // Also delete cached prompt for this user in this chat
        try {
          const key = `${chatId}:${clickerId}`;
          const cachedId = accessPromptCache.get(key);
          if (cachedId) await bot.telegram.deleteMessage(chatId, cachedId).catch(() => { });
          accessPromptCache.delete(key);
        } catch (e) { }


        const hi = mentionUserHtml(ctx.from);
        const text = `Hii ${hi},\n\n✅ Access verified. Now send the movie/show name again in this group.`;

        const sent = await ctx.reply(text, {
          parse_mode: "HTML",
          reply_to_message_id: ctx.callbackQuery?.message?.message_id
        });

        await saveMessageToRedis(chatId, sent.message_id, { from: (await getBotInfo()).id, isBot: true, type: "verify_success" });
        scheduleDeleteMessage(chatId, sent.message_id, ACCESS_TTL_MS);
        return;
      }

      // Not verified yet -> show correct prompt
      await ctx.answerCbQuery("Not verified yet. Please complete the steps.", { show_alert: false }).catch(() => { });

      const fakeMsg = {
        chat: ctx.chat,
        from: ctx.from,
        message_id: ctx.callbackQuery?.message?.message_id
      };

      const needsChannel = !inChannel;
      const needsStart = !hasDb;
      const reason = blocked ? "blocked" : "missing";

      await sendAccessPrompt({ ctx, msg: fakeMsg, needsChannel, needsStart, reason });
    } catch (err) {
      console.error("VERIFY_GROUP handler error:", err);
      try { await ctx.answerCbQuery("Error. Try again.", { show_alert: true }); } catch (e) { }
    }
  });

  bot.action("JOIN_CHANNEL_NOT_CONFIGURED", async (ctx) => {
    try {
      await ctx.answerCbQuery("Channel link not configured. Please contact admin.", { show_alert: true }).catch(() => { });
    } catch (e) { }
  });

  bot.action("START_BOT_NOT_CONFIGURED", async (ctx) => {
    try {
      await ctx.answerCbQuery("Bot username not configured. Please contact admin.", { show_alert: true }).catch(() => { });
    } catch (e) { }
  });

  // MAIN listener: group messages only
  bot.on("message", async (ctx, next) => {
    try {
      const msg = ctx.message;
      const chat = ctx.chat;

      if (!chat || !["group", "supergroup"].includes(chat.type)) return next();
      if (!msg) return next();
      if (msg.from && msg.from.is_bot) return next();

      const amIAdmin = await isBotAdminInChat(chat.id);
      if (!amIAdmin) return next(); // only enforce rules if bot is admin

      // Instantly delete Telegram service messages (join/leave/etc.)
      if (isServiceMessage(msg)) {
        try {
          await ctx.deleteMessage(msg.message_id);
        } catch (e) { }
        return;
      }
      // NOTE: 10-min auto-delete will be scheduled only after user/admin checks below.

      // If sender is owner/admin => no response
      const senderId = msg.from?.id;
      if (senderId && (await isUserAdminOrOwner(chat.id, senderId))) {
        // Admin/owner messages also auto-delete in 10 minutes
        try {
          await saveMessageToRedis(chat.id, msg.message_id, { from: senderId, isBot: false, hasText: Boolean(msg.text), type: msg.text ? "text" : "non_text" });
        } catch (e) { }
        scheduleDeleteMessage(chat.id, msg.message_id);
        return;
      }

      // If user is replying to owner/admin => no response
      const repliedUserId = msg.reply_to_message?.from?.id;
      if (repliedUserId && (await isUserAdminOrOwner(chat.id, repliedUserId))) {
        // Still auto-delete in 10 minutes
        try {
          await saveMessageToRedis(chat.id, msg.message_id, { from: senderId, isBot: false, hasText: Boolean(msg.text), type: msg.text ? "text" : "non_text" });
        } catch (e) { }
        scheduleDeleteMessage(chat.id, msg.message_id);
        return;
      }

      // Only normal single-line text is allowed for users (no media, no links, no usernames/mentions)
      const entities = msg.entities || [];

      const hasMedia = Boolean(
        msg.photo ||
        msg.video ||
        msg.document ||
        msg.audio ||
        msg.sticker ||
        msg.voice ||
        msg.video_note ||
        msg.animation ||
        msg.contact ||
        msg.location ||
        msg.venue ||
        msg.dice ||
        msg.poll
      );

      // if not text or has media => delete instantly
      if (!msg.text || hasMedia) {
        try { await ctx.deleteMessage(msg.message_id); } catch (e) { }
        return;
      }

      const hasMultiLine = typeof msg.text === "string" && msg.text.includes("\n");

      const hasLink = entities.some((e) => ["url", "text_link"].includes(e.type));
      const hasMentionEntity = entities.some((e) => ["mention", "text_mention"].includes(e.type));
      const hasAtUsername = typeof msg.text === "string" && msg.text.includes("@");

      if (hasLink || hasMentionEntity || hasAtUsername || hasMultiLine) {
        try { await ctx.deleteMessage(msg.message_id); } catch (e) { }
        return;
      }

      // ---- USER VALIDATION (must happen before finding/search) ----
      let userRecord = null;
      try {
        userRecord = await users_module.findOne({ user_id: msg.from.id }).lean();
      } catch (errUserLoad) {
        console.warn("Could not load user from DB:", errUserLoad?.message || errUserLoad);
      }

      const blocked = isUserBlocked(userRecord);

      let inChannel = false;
      try {
        inChannel = await checkUserInChannel(msg.from.id, bot);
      } catch (e) {
        inChannel = false;
      }

      if (!inChannel || blocked) {
        // User not verified -> delete user message instantly
        try {
          await ctx.deleteMessage(msg.message_id);
        } catch (e) { }

        const needsChannel = !inChannel;
        const needsStart = blocked; // missing db OR blocked both map to start required
        const reason = blocked && userRecord ? "blocked" : "missing";

        const promptMsg = { ...msg, message_id: null };
        await sendAccessPrompt({ ctx, msg: promptMsg, needsChannel, needsStart, reason });
        return;
      }

      // Auto-delete this user message in 10 minutes (verified users only)
      try {
        await saveMessageToRedis(chat.id, msg.message_id, { from: msg.from?.id, isBot: false, text: msg.text, type: "user_query" });
      } catch (e) { }
      scheduleDeleteMessage(chat.id, msg.message_id);

      // ---- FINDING PROCESS ----
      const query = msg.text.trim();
      if (!query) return next();

      // step 1: full regex search
      let movieMatches = await movies_module
        .find({ title: { $regex: query, $options: "i" } })
        .limit(6)
        .lean();

      let showMatches = await shows_module
        .find({ title: { $regex: query, $options: "i" } })
        .limit(6)
        .lean();

      // agar result nahi mila -> step 2: word-to-word search (ignore numbers)
      if (movieMatches.length === 0 && showMatches.length === 0) {
        // words split karo aur sirf alphabets lo
        const words = query
          .split(/\s+/) // whitespace se split
          .map((w) => w.trim()) // trim
          .filter((w) => /^[a-zA-Z]+$/.test(w)); // sirf alphabets allow

        if (words.length > 0) {
          const regexWords = words.map((w) => ({ title: { $regex: w, $options: "i" } }));

          movieMatches = await movies_module.find({ $or: regexWords }).limit(6).lean();
          showMatches = await shows_module.find({ $or: regexWords }).limit(6).lean();
        }
      }

      const moviesCount = (movieMatches && movieMatches.length) || 0;
      const showsCount = (showMatches && showMatches.length) || 0;

      let replyText = `🔎 I searched for: *${escapeMarkdown(query)}*\n\n`;
      if (moviesCount + showsCount === 0) {
        replyText += `❌ No matches found in Movies or Shows.\n\n`;
      } else {
        if (moviesCount > 0) replyText += `🍿 Found *${moviesCount}* matching movie(s).\n`;
        if (showsCount > 0) replyText += `📺 Found *${showsCount}* matching show(s).\n`;
        replyText += `\nTap the button(s) below to open results in the mini-app.\n\n`;
      }
      replyText += `Note: This message (and your query) will be auto-deleted in 10 minutes.`;

      // Build keyboard appropriate for chat type
      const keyboard = await buildKeyboard({
        moviesCount,
        showsCount,
        query,
        fromId: msg.chat.id,
        user_id: userRecord?.user_id
      });

      // send reply
      // keyboard may be either a Telegraf Markup (has .reply_markup) or plain object
      const replyOptions = {
        parse_mode: "Markdown",
        ...(msg && msg.message_id ? { reply_to_message_id: msg.message_id } : {}),
        reply_markup: keyboard.reply_markup ? keyboard.reply_markup : keyboard // handle both shapes
      };

      const sentMsg = await ctx.reply(replyText, replyOptions);

      await saveMessageToRedis(chat.id, sentMsg.message_id, {
        from: (await getBotInfo()).id,
        isBot: true,
        text: replyText
      });
      scheduleDeleteMessage(chat.id, sentMsg.message_id);

      return next();
    } catch (err) {
      console.error("Group listener error:", err);
      try {
        return next();
      } catch (e) { }
    }
  });
};