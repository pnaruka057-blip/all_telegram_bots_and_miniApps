// bot_index.js
const { Markup } = require("telegraf");
const user_model = require("./user_model");

const CHANNEL_LINK = "https://t.me/+G2tZwIBX91g0ZjA8";

const FIRST_CTA_TEXT =
    "CLICK ON FREE ACCESS TO JOIN OUR TODAY'S COMPOUNDING SESSION NON MTG";

const SECOND_MSG_TEXT =
    `Hello👋, TRADER! Welcome To My Trading Success Roadmap 🚀

📊Daily FREE USD/BRL 🇧🇷 OTC Market Session 🚀 

🚀10-15 NON - Martingale Insights📊

🚀Join USD/BRL🇧🇷OTC Session 👇
${CHANNEL_LINK}
${CHANNEL_LINK}
${CHANNEL_LINK}
${CHANNEL_LINK}

📣 Only 15 Seats Available 🎯 | Book Your Now👆👆👆

🔊Disclaimer :- Educational content only - not a financial advice

👇Tap On Join Channel Button ✅
              👇 👇 👇👇👇👇`;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isBlockedError(err) {
    const code = err?.response?.error_code;
    const desc = (err?.response?.description || "").toLowerCase();

    if (code === 403) return true;
    if (code === 400 && (desc.includes("chat not found") || desc.includes("user not found")))
        return true;

    if (desc.includes("bot was blocked by the user")) return true;
    if (desc.includes("user is deactivated")) return true;

    return false;
}

async function safeCopyMessage(bot, toChatId, fromChatId, messageId, extra = {}) {
    try {
        return await bot.telegram.copyMessage(toChatId, fromChatId, messageId, extra);
    } catch (err) {
        const code = err?.response?.error_code;

        if (code === 429) {
            const retryAfter = Number(err?.response?.parameters?.retry_after || 1);
            await sleep((retryAfter + 1) * 1000);
            return await bot.telegram.copyMessage(toChatId, fromChatId, messageId, extra);
        }

        throw err;
    }
}

module.exports = (bot) => {
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_PROJECT_02 || "";

    // admin flow state
    // key: userId -> { step, fromChatId, messageId }
    const state = new Map();

    // prevent FREE ACCESS spam (in-memory)
    const freeAccessDone = new Set();

    // /start => first message + save user
    bot.start(async (ctx) => {
        const from = ctx.from || {};
        const telegramId = Number(from.id);

        // 1) First CTA message (FREE ACCESS is callback, NOT url)
        await ctx.reply(
            FIRST_CTA_TEXT,
            Markup.inlineKeyboard([
                Markup.button.callback("FREE ACCESS", "FREE_ACCESS"),
            ])
        );

        // 2) Save user (non-blocking)
        user_model
            .updateOne(
                { telegramId },
                {
                    $set: {
                        username: from.username,
                        firstName: from.first_name,
                        lastName: from.last_name,
                    },
                    $setOnInsert: { telegramId, createdAt: new Date() },
                },
                { upsert: true }
            )
            .catch(() => { });
    });

    // FREE ACCESS click => send 2nd message immediately (NO link open on first button)
    bot.action("FREE_ACCESS", async (ctx) => {
        try {
            await ctx.answerCbQuery(); // stop loading spinner

            const uid = ctx.from?.id;
            const chatId = ctx.chat?.id;

            if (!uid || !chatId) return;

            // avoid sending again on multiple clicks
            if (freeAccessDone.has(uid)) return;
            freeAccessDone.add(uid);

            // optional: remove buttons from first message so user can't click again
            try {
                await ctx.editMessageReplyMarkup(undefined);
            } catch (e) { }

            // Send 2nd message with URL button
            await ctx.telegram.sendMessage(chatId, SECOND_MSG_TEXT, {
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([
                    Markup.button.url("Join Channel Button ✅", CHANNEL_LINK),
                ]),
            });
        } catch (e) { }
    });

    // /send => ask password (anyone can do)
    bot.command("send", async (ctx) => {
        state.set(ctx.from.id, { step: "await_password" });
        await ctx.reply("Password bhejo:");
    });

    // Receive password + broadcast message (any type)
    bot.on("message", async (ctx) => {
        const st = state.get(ctx.from.id);
        if (!st) return;

        // Step 1: password
        if (st.step === "await_password") {
            const pass = ctx.message?.text;

            if (!pass) {
                await ctx.reply("Password text me bhejo:");
                return;
            }

            if (!ADMIN_PASSWORD) {
                state.delete(ctx.from.id);
                await ctx.reply("Server me ADMIN_PASSWORD_PROJECT_02 set nahi hai.");
                return;
            }

            if (pass !== ADMIN_PASSWORD) {
                state.delete(ctx.from.id);
                await ctx.reply("Wrong password. Dubara /send karo.");
                return;
            }

            state.set(ctx.from.id, { step: "await_message" });
            await ctx.reply(
                "Password OK ✅\nAb broadcast wala message bhejo (text / photo / video / document / media-with-caption)."
            );
            return;
        }

        // Step 2: capture message for broadcast
        if (st.step === "await_message") {
            const text = ctx.message?.text || "";
            if (text.startsWith("/")) {
                await ctx.reply("Command nahi, broadcast wala message bhejo.");
                return;
            }

            const fromChatId = ctx.chat.id;
            const messageId = ctx.message.message_id;

            // Preview back to sender
            await safeCopyMessage(bot, fromChatId, fromChatId, messageId);

            state.set(ctx.from.id, { step: "confirm", fromChatId, messageId });

            await ctx.reply(
                "Kya yahi message sab users ko send karna hai?",
                Markup.inlineKeyboard([
                    Markup.button.callback("✅ Yes", "BCAST_CONFIRM_YES"),
                    Markup.button.callback("❌ No", "BCAST_CONFIRM_NO"),
                ])
            );
            return;
        }

        if (st.step === "confirm") {
            await ctx.reply("Confirm ke liye Yes/No button dabao.");
            return;
        }
    });

    bot.action("BCAST_CONFIRM_NO", async (ctx) => {
        await ctx.answerCbQuery();

        const st = state.get(ctx.from.id);
        if (!st || st.step !== "confirm") return;

        state.delete(ctx.from.id);
        await ctx.editMessageText("Broadcast abort ❌\nDubara start karne ke liye /send karo.");
    });

    bot.action("BCAST_CONFIRM_YES", async (ctx) => {
        await ctx.answerCbQuery();

        const st = state.get(ctx.from.id);
        if (!st || st.step !== "confirm") {
            await ctx.reply("Session missing. Dubara /send karo.");
            return;
        }

        const totalUsers = await user_model.countDocuments();
        await ctx.editMessageText(`Broadcast start ✅\nTotal users target: ${totalUsers}`);

        let sent = 0;
        const blockedIds = [];
        let otherFailed = 0;

        const cursor = user_model
            .find({}, { telegramId: 1, _id: 0 })
            .lean()
            .cursor();

        for await (const u of cursor) {
            const chatId = u.telegramId;

            try {
                await safeCopyMessage(bot, chatId, st.fromChatId, st.messageId, {
                    disable_notification: true,
                });
                sent += 1;
            } catch (err) {
                if (isBlockedError(err)) blockedIds.push(chatId);
                else otherFailed += 1;
            }

            await sleep(80);
        }

        if (blockedIds.length > 0) {
            await user_model.deleteMany({ telegramId: { $in: blockedIds } });
        }

        state.delete(ctx.from.id);

        await ctx.reply(
            `Broadcast done ✅
Total targeted: ${totalUsers}
Sent: ${sent}
Bot blocked / unreachable (deleted from DB): ${blockedIds.length}
Other failed: ${otherFailed}`
        );
    });
};