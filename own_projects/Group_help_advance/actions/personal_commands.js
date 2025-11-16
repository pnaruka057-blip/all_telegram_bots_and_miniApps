const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const user_setting_module = require("../models/user_settings_module");

// -------------- Paths and helpers ----------------------------
const pcPath = (chatIdStr, field) => `settings.${chatIdStr}.personal_commands.${field}`;
const getPCState = (doc, chatIdStr) => {
    const base = doc?.settings?.[chatIdStr]?.personal_commands || {};
    return {
        commands: Array.isArray(base.commands) ? base.commands : []
    };
};

const isName = (s) => /^[A-Za-z0-9_]{2,32}$/.test(s);

function extractMediaPayload(msg) {
    if (!msg) return null;
    if (msg.photo?.length) return { type: "photo", file_id: msg.photo.at(-1).file_id, caption: msg.caption || "" };
    if (msg.video) return { type: "video", file_id: msg.video.file_id, caption: msg.caption || "" };
    if (msg.document) return { type: "document", file_id: msg.document.file_id, caption: msg.caption || "" };
    return null;
}

async function isAdminOrOwner(ctx, chatId, userId) {
    try {
        const m = await ctx.telegram.getChatMember(chatId, userId);
        return m?.status === "administrator" || m?.status === "creator";
    } catch {
        return false;
    }
}

// -------------- UI text --------------------------------------
const explainBlock =
    `If you want to add a personal command, this is the way:\n\n` +
    `☑️ Send a message or a media to the group\n` +
    `☑️ Reply to that message with:\n<code>/personal commandname</code>\n` +
    `☑️ Set settings and save it\n\n` +
    `• In the text you can use HTML and {ID}, {MENTION}, {NAME}, {SURNAME}, {USERNAME}, {GROUPNAME}.\n` +
    `• When /namecommand will be used, the bot will send the message/media you set.\n` +
    `• That command can be called with: /namecommand !namecommand #namecommand .namecommand`;

// -------------- Renderers ------------------------------------
async function renderPCMain(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const { commands } = getPCState(doc, chatIdStr);

    const txt = `${explainBlock}\n\nCurrent personal commands: <b>${commands.length}</b>`;

    const rows = [
        [Markup.button.callback("📋 List", `PC_LIST_${chatIdStr}`)],
        [
            Markup.button.callback("➕ Add", `PC_ADD_${chatIdStr}`),
            Markup.button.callback("➖ Remove", `PC_REM_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, txt, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderList(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const { commands } = getPCState(doc, chatIdStr);

    const lines = commands.length
        ? commands
            .map((c, i) => `${i + 1}. /${c.name}${c.aliases?.length ? ` (${c.aliases.map(a => `/${a}`).join(", ")})` : ""}`)
            .join("\n")
        : "— No personal commands yet —";

    await safeEditOrSend(ctx, `📋 Personal commands:\n\n${lines}`, {
        reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
    });
}

async function promptNameForDM(ctx, chatIdStr) {
    await safeEditOrSend(ctx, "Send the command name (letters, numbers, underscore). Example: mypromo", {
        reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
    });
}

async function promptRemoveName(ctx, chatIdStr) {
    await safeEditOrSend(ctx, "Send the command name to remove (without slash), e.g. mypromo", {
        reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
    });
}

async function promptDMContent(ctx, chatIdStr, name) {
    await safeEditOrSend(ctx, `Now send the content for /${name} (text or media, caption allowed).`, {
        reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
    });
}

// -------------- Attach module --------------------------------
module.exports = (bot) => {
    // Open PC panel
    bot.action(/^PERSONAL_COMMANDS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderPCMain(ctx, chatIdStr, userId);
    });

    // List
    bot.action(/^PC_LIST_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderList(ctx, chatIdStr, userId);
    });

    // Add via bot (DM) flow
    bot.action(/^PC_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        ctx.session = { await: { mode: "pc_dm_name", chatIdStr } };
        await promptNameForDM(ctx, chatIdStr);
    });

    // Remove flow trigger
    bot.action(/^PC_REM_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        ctx.session = { await: { mode: "pc_remove", chatIdStr } };
        await promptRemoveName(ctx, chatIdStr);
    });

    // In-group flow: /personal commandname when replying
    bot.hears(/^\/personal[ ]+([A-Za-z0-9_]{2,32})$/, async (ctx) => {
        const msg = ctx.message;
        const chat = msg.chat;
        if (!chat || (chat.type !== "supergroup" && chat.type !== "group")) return;

        const chatIdStr = String(chat.id);
        const name = (ctx.match?.[1] || "").toLowerCase();
        if (!isName(name)) return;

        const userId = ctx.from.id;

        // Only admins/owner can set in groups
        const admin = await isAdminOrOwner(ctx, chat.id, userId);
        if (!admin) {
            return ctx.reply("Only group admins can create personal commands here.");
        }

        // Must be a reply to capture content
        const reply = msg.reply_to_message;
        if (!reply) {
            return ctx.reply("Reply to a message or media, then use /personal commandname.");
        }

        // Extract content
        const media = extractMediaPayload(reply);
        const text = media ? "" : (reply.text || reply.caption || "").trim();

        if (!media && !text) {
            return ctx.reply("Unsupported content. Use text or photo/video/document.");
        }

        const cmd = {
            name,
            aliases: [],
            text,
            media, // {type,file_id,caption} or null
            created_at: new Date().toISOString()
        };

        await user_setting_module.updateOne(
            { user_id: userId },
            { $pull: { [pcPath(chatIdStr, "commands")]: { name } } }
        );
        await user_setting_module.updateOne(
            { user_id: userId },
            { $push: { [pcPath(chatIdStr, "commands")]: cmd } },
            { upsert: true }
        );

        return ctx.reply(`Saved /${name} for this group.`);
    });

    // Triggering commands by members: /name, !name, #name, .name
    bot.hears(/^([\/!#\.])([A-Za-z0-9_]{2,32})$/, async (ctx) => {
        const chat = ctx.message.chat;
        if (!chat) return;

        const key = (ctx.match?.[2] || "").toLowerCase();
        const chatIdStr = String(chat.id);

        // Load command
        const doc = await user_setting_module.findOne({ user_id: ctx.from.id }).lean();
        const cmds = doc?.settings?.[chatIdStr]?.personal_commands?.commands || [];
        const cmd = cmds.find(c => c.name === key || (Array.isArray(c.aliases) && c.aliases.includes(key)));
        if (!cmd) return;

        const kb = undefined;

        if (cmd.media?.type && cmd.media?.file_id) {
            const cap = cmd.media.caption || cmd.text || "";
            switch (cmd.media.type) {
                case "photo": return ctx.replyWithPhoto(cmd.media.file_id, { caption: cap, parse_mode: "HTML", reply_markup: kb });
                case "video": return ctx.replyWithVideo(cmd.media.file_id, { caption: cap, parse_mode: "HTML", reply_markup: kb });
                case "document": return ctx.replyWithDocument(cmd.media.file_id, { caption: cap, parse_mode: "HTML", reply_markup: kb });
                default: return ctx.reply(cap || "—", { parse_mode: "HTML", reply_markup: kb });
            }
        } else {
            return ctx.reply(cmd.text || "—", { parse_mode: "HTML", reply_markup: kb });
        }
    });

    // Text/media capture for DM add/remove wizard
    bot.on(["text", "photo", "video", "document"], async (ctx, next) => {
        const st = ctx.session?.await;
        if (!st) return next && next();

        const userId = ctx.from.id;
        const { mode, chatIdStr } = st;

        if (mode === "pc_dm_name" && ctx.message.text) {
            const raw = ctx.message.text.trim();
            if (!isName(raw)) {
                return safeEditOrSend(ctx, "Invalid name. Use 2–32 chars [A-Z a-z 0-9 _].", {
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
                });
            }
            const name = raw.toLowerCase();

            // Ensure uniqueness in target chat
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const { commands } = getPCState(doc, chatIdStr);
            if (commands.some(c => c.name === name)) {
                return safeEditOrSend(ctx, `/${name} already exists. Send another name or Cancel.`, {
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
                });
            }

            ctx.session.await = { mode: "pc_dm_content", chatIdStr, name };
            return promptDMContent(ctx, chatIdStr, name);
        }

        if (mode === "pc_dm_content") {
            const { name } = st;
            const media = extractMediaPayload(ctx.message);
            const text = media ? "" : (ctx.message.text || "").trim();

            if (!media && !text) {
                return safeEditOrSend(ctx, "Send some text or media, or Cancel.", {
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
                });
            }

            const cmd = {
                name,
                aliases: [],
                text,
                media,
                created_at: new Date().toISOString()
            };

            await user_setting_module.updateOne(
                { user_id: userId },
                { $pull: { [pcPath(chatIdStr, "commands")]: { name } } }
            );
            await user_setting_module.updateOne(
                { user_id: userId },
                { $push: { [pcPath(chatIdStr, "commands")]: cmd } },
                { upsert: true }
            );

            ctx.session = {};
            return safeEditOrSend(ctx, `Saved /${name} for chat ${chatIdStr}.`, {
                reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
            });
        }

        if (mode === "pc_remove" && ctx.message.text) {
            const name = ctx.message.text.trim().replace(/^\//, "").toLowerCase();
            await user_setting_module.updateOne(
                { user_id: userId },
                { $pull: { [pcPath(chatIdStr, "commands")]: { name } } }
            );
            ctx.session = {};
            return safeEditOrSend(ctx, `Removed /${name} from chat ${chatIdStr}.`, {
                reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `PERSONAL_COMMANDS_${chatIdStr}`)]] }
            });
        }

        return next && next();
    });
};
