// bot_index.js

const { Markup } = require("telegraf");
const mongoose = require("mongoose");

const user_model = require("./user_model");
const { project_02_connection } = require("../../globle_helper/mongoDB_connection");

// ====================== Helpers ======================
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isBlockedError(err) {
    const code = err?.response?.error_code;
    const desc = (err?.response?.description || "").toLowerCase();

    if (code === 403) return true;
    if (code === 400 && (desc.includes("chat not found") || desc.includes("user not found"))) return true;
    if (desc.includes("bot was blocked by the user")) return true;
    if (desc.includes("user is deactivated")) return true;

    return false;
}

async function safeForwardMessage(bot, toChatId, fromChatId, messageId, extra = {}) {
    try {
        return await bot.telegram.forwardMessage(toChatId, fromChatId, messageId, extra);
    } catch (err) {
        const code = err?.response?.error_code;
        if (code === 429) {
            const retryAfter = Number(err?.response?.parameters?.retry_after || 1);
            await sleep((retryAfter + 1) * 1000);
            return await bot.telegram.forwardMessage(toChatId, fromChatId, messageId, extra);
        }
        throw err;
    }
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

// ====================== Owner Setting (Mongo) ======================
let BotSetting = null;

if (project_02_connection) {
    const botSettingSchema = new mongoose.Schema(
        {
            key: { type: String, required: true, unique: true, index: true },
            value: { type: mongoose.Schema.Types.Mixed },
            updatedAt: { type: Date, default: Date.now },
        },
        { versionKey: false }
    );

    // prevent OverwriteModelError on hot reload
    BotSetting =
        project_02_connection.models.bot_settings ||
        project_02_connection.model("bot_settings", botSettingSchema);
}

const OWNER_KEY = "ownerTelegramId";
let ownerCache = { id: null, loadedAt: 0 };

async function getOwnerIdCached() {
    // cache 60 sec
    if (ownerCache.id && Date.now() - ownerCache.loadedAt < 60 * 1000) return ownerCache.id;

    if (!BotSetting) return null;
    const doc = await BotSetting.findOne({ key: OWNER_KEY }).lean().catch(() => null);
    const id = Number(doc?.value || 0);

    if (!Number.isNaN(id) && id > 0) {
        ownerCache = { id, loadedAt: Date.now() };
        return id;
    }

    return null;
}

async function setOwnerId(newOwnerId) {
    const id = Number(newOwnerId);
    if (Number.isNaN(id) || id <= 0) throw new Error("Invalid owner id");

    ownerCache = { id, loadedAt: Date.now() };

    if (BotSetting) {
        await BotSetting.updateOne(
            { key: OWNER_KEY },
            { $set: { value: id, updatedAt: new Date() }, $setOnInsert: { key: OWNER_KEY } },
            { upsert: true }
        );
    }
    return id;
}

async function getCurrentAdminId() {
    const doc = await user_model
        .findOne({ isAdmin: true }, { telegramId: 1, _id: 0 })
        .lean()
        .catch(() => null);

    const id = Number(doc?.telegramId || 0);
    if (!Number.isNaN(id) && id > 0) return id;
    return null;
}

// ====================== Main Module ======================
module.exports = (bot) => {
    if (!user_model) {
        throw new Error("user_model not loaded (mongo connection issue).");
    }

    const OWNER_SETUP_TOKEN = process.env.BOT_OWNER_SETUP_TOKEN || "";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_PROJECT_02 || "";

    // broadcast flow state (only for owner)
    // key: ownerId -> { step, fromChatId, messageId }
    const bcastState = new Map();

    // /setadmin password flow state
    // key: userId -> { step: "await_password" }
    const setAdminState = new Map();

    // ---------- Commands ----------

    bot.start(async (ctx) => {
        const from = ctx.from || {};
        const telegramId = Number(from.id);
        if (!telegramId) return;

        // 1) Check if user already exists
        const existing = await user_model.findOne({ telegramId }).lean().catch(() => null);

        // 2) If not exists -> add new document, else update profile fields
        if (!existing) {
            await user_model
                .create({
                    telegramId,
                    username: from.username,
                    firstName: from.first_name,
                    lastName: from.last_name,
                    createdAt: new Date(),
                    isAdmin: false,
                })
                .catch(() => { });
        } else {
            await user_model
                .updateOne(
                    { telegramId },
                    {
                        $set: {
                            username: from.username,
                            firstName: from.first_name,
                            lastName: from.last_name,
                        },
                    }
                )
                .catch(() => { });
        }

        // 3) If user is admin -> owner welcome
        const isAdminUser = existing?.isAdmin === true;
        if (isAdminUser) {
            await ctx.reply("Welcome back, Admin. You are the owner of this bot.");
            return;
        }

        // 4) If no admin set -> ONLY this message
        const adminId = await getCurrentAdminId();
        if (!adminId) {
            await ctx.reply("Currently no admin is available. Please message again when an admin is available.");
            return;
        }

        // 5) Normal user welcome
        await ctx.reply("Welcome! Send any message here and it will be delivered to the admin.");
    });

    // /setadmin => ask password first, then next message matches against ADMIN_PASSWORD_PROJECT_02
    bot.command("setadmin", async (ctx) => {
        const fromId = Number(ctx.from?.id);
        if (!fromId) return;

        // ensure user exists/updated (so admin can be set even before /start)
        await user_model
            .updateOne(
                { telegramId: fromId },
                {
                    $set: {
                        username: ctx.from?.username,
                        firstName: ctx.from?.first_name,
                        lastName: ctx.from?.last_name,
                    },
                    $setOnInsert: { telegramId: fromId, createdAt: new Date(), isAdmin: false },
                },
                { upsert: true }
            )
            .catch(() => { });

        setAdminState.set(fromId, { step: "await_password" });
        await ctx.reply("Please enter the admin password:");
    });

    // Owner claim: /claim_owner <token> (kept for compatibility)
    bot.command("claim_owner", async (ctx) => {
        const fromId = Number(ctx.from?.id);
        const parts = (ctx.message?.text || "").trim().split(/\s+/);
        const token = parts[1] || "";

        if (!OWNER_SETUP_TOKEN) {
            await ctx.reply("Server me BOT_OWNER_SETUP_TOKEN set nahi hai.");
            return;
        }

        if (!token || token !== OWNER_SETUP_TOKEN) {
            await ctx.reply("Invalid token.");
            return;
        }

        const existingOwner = await getOwnerIdCached();
        if (existingOwner && existingOwner !== fromId) {
            await ctx.reply(
                `Owner already set hai.\nAgar change karna hai to pehle DB se bot_settings key "${OWNER_KEY}" delete karo ya BOT_OWNER_TELEGRAM_ID set karo.`
            );
            return;
        }

        // enforce single admin
        await user_model.updateMany({ isAdmin: true }, { $set: { isAdmin: false } }).catch(() => { });
        await user_model
            .updateOne(
                { telegramId: fromId },
                {
                    $set: {
                        username: ctx.from?.username,
                        firstName: ctx.from?.first_name,
                        lastName: ctx.from?.last_name,
                        isAdmin: true,
                    },
                    $setOnInsert: { telegramId: fromId, createdAt: new Date() },
                },
                { upsert: true }
            )
            .catch(() => { });

        await setOwnerId(fromId);
        await ctx.reply("Owner set ✅ Ab users ke messages yahi forward honge.");
    });

    // Owner broadcast: /broadcast (do not change flow)
    bot.command("broadcast", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) return;

        bcastState.set(ownerId, { step: "await_message" });
        await ctx.reply("Broadcast ke liye message bhejo (text/photo/video/document). /cancel se cancel.");
    });

    bot.command("cancel", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) return;

        bcastState.delete(ownerId);
        await ctx.reply("Cancelled ✅");
    });

    bot.command("users", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) return;

        const totalUsers = await user_model.countDocuments().catch(() => 0);
        await ctx.reply(`Total users in DB: ${totalUsers}`);
    });

    // ---------- Callbacks ----------

    bot.action("BCAST_CONFIRM_NO", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) {
            await ctx.answerCbQuery("Not allowed", { show_alert: true }).catch(() => { });
            return;
        }

        await ctx.answerCbQuery().catch(() => { });
        bcastState.delete(ownerId);

        await ctx.editMessageText("Broadcast abort ❌").catch(async () => {
            await ctx.reply("Broadcast abort ❌").catch(() => { });
        });
    });

    bot.action("BCAST_CONFIRM_YES", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) {
            await ctx.answerCbQuery("Not allowed", { show_alert: true }).catch(() => { });
            return;
        }

        await ctx.answerCbQuery().catch(() => { });

        const st = bcastState.get(ownerId);
        if (!st || st.step !== "confirm") {
            await ctx.reply("Session missing. Dubara /broadcast karo.").catch(() => { });
            return;
        }

        const totalUsers = await user_model.countDocuments().catch(() => 0);
        await ctx.editMessageText(`Broadcast start ✅\nTotal users target: ${totalUsers}`).catch(() => { });

        let sent = 0;
        let otherFailed = 0;
        const blockedIds = [];

        const cursor = user_model.find({}, { telegramId: 1, _id: 0 }).lean().cursor();
        for await (const u of cursor) {
            const chatId = Number(u.telegramId);
            if (!chatId) continue;

            // optional: owner ko broadcast na bheje
            if (chatId === ownerId) continue;

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
            await user_model.deleteMany({ telegramId: { $in: blockedIds } }).catch(() => { });
        }

        bcastState.delete(ownerId);

        await ctx.reply(
            `Broadcast done ✅\n\nTotal targeted: ${totalUsers}\nSent: ${sent}\nBot blocked/unreachable (deleted from DB): ${blockedIds.length}\nOther failed: ${otherFailed}`
        );
    });

    // ---------- Main message router ----------
    bot.on("message", async (ctx) => {
        const from = ctx.from;
        if (!from) return;

        // only private chat
        if (ctx.chat?.type !== "private") return;

        const fromId = Number(from.id);
        if (!fromId) return;

        // If waiting for /setadmin password, handle it first (do NOT forward)
        const stAdmin = setAdminState.get(fromId);
        if (stAdmin?.step === "await_password") {
            const text = (ctx.message?.text || "").trim();

            if (text === "/cancel") {
                setAdminState.delete(fromId);
                await ctx.reply("Cancelled.");
                return;
            }

            if (!ADMIN_PASSWORD) {
                setAdminState.delete(fromId);
                await ctx.reply("Admin password is not configured on the server.");
                return;
            }

            if (text === ADMIN_PASSWORD) {
                // only one admin at a time
                await user_model.updateMany({ isAdmin: true }, { $set: { isAdmin: false } }).catch(() => { });

                await user_model
                    .updateOne(
                        { telegramId: fromId },
                        {
                            $set: {
                                username: from.username,
                                firstName: from.first_name,
                                lastName: from.last_name,
                                isAdmin: true,
                            },
                            $setOnInsert: { telegramId: fromId, createdAt: new Date() },
                        },
                        { upsert: true }
                    )
                    .catch(() => { });

                // also set ownerTelegramId (so existing broadcast/owner features keep working)
                await setOwnerId(fromId).catch(() => { });

                setAdminState.delete(fromId);
                await ctx.reply("✅ You are now the admin (owner) of this bot.");
                return;
            }

            setAdminState.delete(fromId);
            await ctx.reply("❌ Incorrect password.");
            return;
        }

        // Upsert user entry on every message (start na kiya ho tab bhi)
        await user_model
            .updateOne(
                { telegramId: fromId },
                {
                    $set: {
                        username: from.username,
                        firstName: from.first_name,
                        lastName: from.last_name,
                    },
                    $setOnInsert: { telegramId: fromId, createdAt: new Date(), isAdmin: false },
                },
                { upsert: true }
            )
            .catch(() => { });

        // Don't forward commands (they are handled by bot.command handlers)
        const msgText = ctx.message?.text || "";
        if (msgText.startsWith("/")) return;

        const ownerId = await getOwnerIdCached(); // for broadcast + reply routing compatibility
        const adminId = await getCurrentAdminId();

        // If no admin set -> ONLY this message
        if (!adminId) {
            await ctx.reply("Currently no admin is available. Please message again when an admin is available.");
            return;
        }

        // ================== OWNER FLOW ==================
        // Owner is the current admin (enforced as single admin)
        if (fromId === adminId) {
            const effectiveOwnerId = ownerId || adminId;

            // 1) Broadcast flow
            const bSt = bcastState.get(effectiveOwnerId);
            if (bSt?.step === "await_message") {
                const fromChatId = ctx.chat.id;
                const messageId = ctx.message.message_id;

                // preview back to owner
                await safeCopyMessage(bot, fromChatId, fromChatId, messageId).catch(() => { });

                bcastState.set(effectiveOwnerId, { step: "confirm", fromChatId, messageId });

                await ctx.reply(
                    "Kya yahi message sab users ko send karna hai?",
                    Markup.inlineKeyboard([
                        Markup.button.callback("✅ Yes", "BCAST_CONFIRM_YES"),
                        Markup.button.callback("❌ No", "BCAST_CONFIRM_NO"),
                    ])
                );
                return;
            }

            // 2) Reply-to-user routing (owner replies to forwarded message)
            const replyTo = ctx.message?.reply_to_message;
            if (!replyTo) return;

            const targetUserId = replyTo.forward_from?.id; // works when message was forwarded
            if (!targetUserId) {
                await ctx.reply(
                    "User detect nahi ho raha (forward_from missing).\nUser ko reply karne ke liye uske forwarded message par reply karo."
                );
                return;
            }

            try {
                await safeCopyMessage(bot, targetUserId, ctx.chat.id, ctx.message.message_id);
            } catch (err) {
                await ctx.reply("User ko message send fail (blocked/unreachable).").catch(() => { });
            }
            return;
        }

        // ================== USER -> OWNER FORWARD ==================
        try {
            // Forward user's message to admin (so admin can reply-to-forward)
            await safeForwardMessage(bot, adminId, ctx.chat.id, ctx.message.message_id);
        } catch (err) {
            await ctx.reply("Your message could not be delivered to the admin. Please try again later.");
        }
    });
};
