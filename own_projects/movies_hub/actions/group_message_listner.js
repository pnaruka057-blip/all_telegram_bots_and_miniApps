// group_message_listener.js
const { Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const shows_module = require("../model/shows_module");
const redis = require("../../../globle_helper/redisConfig");
const users_module = require("../model/users_module");

const MSG_TTL_SECONDS = 10 * 60; // 10 minutes
const MSG_TTL_MS = MSG_TTL_SECONDS * 1000;

module.exports = (bot) => {
  const adminCache = new Map();
  let botInfoPromise = null;

  async function getBotInfo() {
    if (!botInfoPromise) botInfoPromise = bot.telegram.getMe();
    return botInfoPromise;
  }

  async function getBotUsername() {
    const me = await getBotInfo();
    return me && me.username ? me.username : null;
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

  function scheduleDeleteMessage(chatId, messageId) {
    setTimeout(async () => {
      try {
        await bot.telegram.deleteMessage(chatId, messageId).catch(() => { });
      } catch (e) {
        // ignore
      }
    }, MSG_TTL_MS);
  }

  async function isBotAdminInChat(chatId) {
    const cached = adminCache.get(chatId);
    if (cached && Date.now() - cached._ts < 5 * 60 * 1000) return cached.isAdmin;
    try {
      const me = await getBotInfo();
      const member = await bot.telegram.getChatMember(chatId, me.id);
      const isAdmin = ["administrator", "creator"].includes(member.status);
      adminCache.set(chatId, { isAdmin, _ts: Date.now() });
      return isAdmin;
    } catch (err) {
      console.error("isBotAdminInChat error:", err);
      adminCache.set(chatId, { isAdmin: false, _ts: Date.now() });
      return false;
    }
  }

  function encodePayload(obj) {
    // payload ko string bana ke base64 encode karo
    return Buffer.from(obj).toString("base64");
  }

  // Build keyboard: prefer web_app if in private chat; otherwise provide t.me URL (recommended for groups)
  async function buildKeyboard({ moviesCount = 0, showsCount = 0, query, fromId, user_id }) {
    const appShort = (process.env.MOVIES_HUB_APP_SHORTNAME || "").trim(); // optional shortname registered via BotFather
    const botUsername = process.env.BOT_USERNAME_MOVIEHUB

    // For group/supergroup: Telegram disallows InlineKeyboardButton.web_app => use t.me direct link (recommended)
    // If you registered a mini-app with BotFather and have appShort, you can use: https://t.me/<bot>/<app>
    // Otherwise use a t.me link to bot with startapp param (requires main mini app configured),
    // else fall back to direct HTTPS mini-app URL.
    const rows = [];
    const makePayload = (type) => encodePayload(`${'movies-hub'}:${type}:${query}:${fromId}:${user_id}`);
    if (botUsername && appShort) {
      if (moviesCount > 0) {
        const tme = `https://t.me/${botUsername}/${appShort}?startapp=${makePayload("movies")}`;
        rows.push([{ text: `🍿 Matched Movies (${moviesCount})`, url: tme }]);
      }
      if (showsCount > 0) {
        const tme2 = `https://t.me/${botUsername}/${appShort}?startapp=${makePayload("shows")}`;
        rows.push([{ text: `📺 Matched Shows (${showsCount})`, url: tme2 }]);
      }
      const reqTme = `https://t.me/${botUsername}/${appShort}?startapp=${makePayload("request")}`;
      rows.push([{ text: "🎬 Request This", url: reqTme }]);

      return { reply_markup: { inline_keyboard: rows } };
    }

    // fallback direct startapp link without appShort
    if (botUsername) {
      if (moviesCount > 0) {
        const tme = `https://t.me/${botUsername}?startapp=${makePayload("movies")}`;
        rows.push([{ text: `🍿 Matched Movies (${moviesCount})`, url: tme }]);
      }
      if (showsCount > 0) {
        const tme2 = `https://t.me/${botUsername}?startapp=${makePayload("shows")}`;
        rows.push([{ text: `📺 Matched Shows (${showsCount})`, url: tme2 }]);
      }
      const reqTme = `https://t.me/${botUsername}?startapp=${makePayload("request")}`;
      rows.push([{ text: "🎬 Request This", url: reqTme }]);

      return { reply_markup: { inline_keyboard: rows } };
    }

    // nothing available
    return Markup.inlineKeyboard([[Markup.button.callback("No mini-app available", "NO_MINI_APP")]]);
  }

  function escapeMarkdown(text) {
    if (!text) return "";
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
  }

  // MAIN listener: group messages only
  bot.on("message", async (ctx, next) => {
    try {
      const msg = ctx.message;
      const chat = ctx.chat;

      if (!chat || !["group", "supergroup"].includes(chat.type)) return next();
      if (!msg || !msg.text) return next();
      if (msg.from && msg.from.is_bot) return next();

      const amIAdmin = await isBotAdminInChat(chat.id);
      if (!amIAdmin) return next(); // only run if bot is admin

      const groupId = String(msg.chat.id);
      const user = await users_module.findOne({
        groupsLists: { $elemMatch: { groupId: groupId } }
      }).lean();

      if (!user) return next(); // only run if group owner is registered in DB

      // Save incoming user message to redis and schedule deletion
      await saveMessageToRedis(chat.id, msg.message_id, { from: msg.from.id, isBot: false, text: msg.text });
      scheduleDeleteMessage(chat.id, msg.message_id);

      const query = msg.text.trim();
      if (!query) return next();

      // step 1: full regex search
      let movieMatches = await movies_module.find({
        title: { $regex: query, $options: "i" }
      }).limit(6).lean();

      let showMatches = await shows_module.find({
        title: { $regex: query, $options: "i" }
      }).limit(6).lean();

      // agar result nahi mila -> step 2: word-to-word search (ignore numbers)
      if (movieMatches.length === 0 && showMatches.length === 0) {
        // words split karo aur sirf alphabets lo
        const words = query
          .split(/\s+/)          // whitespace se split
          .map(w => w.trim())    // trim
          .filter(w => /^[a-zA-Z]+$/.test(w)); // sirf alphabets allow

        if (words.length > 0) {
          const regexWords = words.map(w => ({ title: { $regex: w, $options: "i" } }));

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
        user_id: user.user_id
      });

      // send reply
      // keyboard may be either a Telegraf Markup (has .reply_markup) or plain object
      const replyOptions = {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
        reply_markup: keyboard.reply_markup ? keyboard.reply_markup : keyboard // handle both shapes
      };

      // Send message
      const sentMsg = await ctx.reply(replyText, replyOptions);

      // save bot message and schedule deletion
      await saveMessageToRedis(chat.id, sentMsg.message_id, { from: (await getBotInfo()).id, isBot: true, text: replyText });
      scheduleDeleteMessage(chat.id, sentMsg.message_id);

      return next();
    } catch (err) {
      console.error("Group listener error:", err);
      try { return next(); } catch (e) { }
    }
  });
};
