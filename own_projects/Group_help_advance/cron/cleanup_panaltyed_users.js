const user_setting_module = require("../models/user_settings_module");

function extractTgErrorText(err) {
    return String(
        err?.response?.description ||
        err?.description ||
        err?.message ||
        ""
    ).toLowerCase();
}

function isIgnorableTgAccessError(err) {
    const t = extractTgErrorText(err);
    return (
        t.includes("chat not found") ||
        t.includes("bot was kicked") ||
        t.includes("need administrator rights") ||
        t.includes("not enough rights") ||
        t.includes("have no rights") ||
        t.includes("forbidden")
    );
}

function isIgnorableUserStateError(err) {
    const t = extractTgErrorText(err);
    return (
        isIgnorableTgAccessError(err) ||
        t.includes("user not found") ||
        t.includes("user_id_invalid") ||
        t.includes("user not participant") ||
        t.includes("user_not_participant") ||
        t.includes("member not found")
    );
}

function getObj(v) {
    return v && typeof v === "object" ? v : null;
}

function pickKey(obj, key) {
    const o = getObj(obj);
    if (!o) return { key: null, value: undefined };
    if (Object.prototype.hasOwnProperty.call(o, key)) return { key: key, value: o[key] };
    return { key: null, value: undefined };
}

function ensureArray(v) {
    return Array.isArray(v) ? v : [];
}

function getUntilMs(entry) {
    const a = entry?.until_ms;
    if (typeof a === "number") return a;
    return null;
}

function getUserId(entry) {
    const a = entry?.user_id;
    if (typeof a === "number") return a;
    return null;
}

function getPunishType(entry) {
    const t = entry?.type;
    return typeof t === "string" ? t.toLowerCase().trim() : null;
}

async function getChatMemberSafe(bot, chatId, userId) {
    try {
        return await bot.telegram.getChatMember(chatId, userId);
    } catch (e) {
        // If bot can't access the chat, treat as "unknown" but ignorable for cleanup decisions
        if (isIgnorableTgAccessError(e)) return { __error: e };
        throw e;
    }
}

async function isCurrentlyMuted(bot, chatId, userId) {
    const m = await getChatMemberSafe(bot, chatId, userId);
    if (m && m.__error) return null; // can't verify
    if (!m) return null;

    // If restricted and cannot send => muted
    if (m.status === "restricted") {
        if (m.can_send_messages === true) return false;
        return true;
    }

    // member/administrator/creator/left/kicked => not muted (kicked handled separately)
    return false;
}

async function isCurrentlyBanned(bot, chatId, userId) {
    const m = await getChatMemberSafe(bot, chatId, userId);
    if (m && m.__error) return null; // can't verify
    if (!m) return null;

    return m.status === "kicked";
}

async function unmuteUser(bot, chatId, userId) {
    // Standard "allow all" permissions
    const permissions = {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
        can_change_info: false,
        can_pin_messages: false,
        can_manage_topics: false,
    };

    await bot.telegram.restrictChatMember(chatId, userId, { permissions });
}

async function unbanUser(bot, chatId, userId) {
    await bot.telegram.unbanChatMember(chatId, userId).catch(() => { });
}

function cleanupWarnedArray(arr, nowMs) {
    const inArr = ensureArray(arr);
    if (inArr.length === 0) return { changed: false, out: inArr };

    let changed = false;
    const out = [];

    for (const w of inArr) {
        const until = getUntilMs(w);
        if (typeof until === "number" && until > 0 && until <= nowMs) {
            changed = true;
            continue;
        }
        out.push(w);
    }

    return { changed, out };
}

async function cleanupPunishedArray(bot, chatId, arr, nowMs) {
    const inArr = ensureArray(arr);
    if (inArr.length === 0) return { changed: false, out: inArr };

    let changed = false;
    const out = [];

    for (const p of inArr) {
        const userId = getUserId(p);
        const type = getPunishType(p);
        const until = getUntilMs(p);

        // bad record -> drop
        if (!userId || (type !== "mute" && type !== "ban")) {
            changed = true;
            continue;
        }

        const expired = typeof until === "number" && until > 0 && until <= nowMs;

        try {
            if (type === "mute") {
                const muted = await isCurrentlyMuted(bot, chatId, userId);

                // If cannot verify (no rights / bot kicked etc)
                if (muted === null) {
                    // if expired, still drop (chat inaccessible => avoid stuck lists)
                    if (expired) {
                        changed = true;
                        continue;
                    }
                    // otherwise keep
                    out.push(p);
                    continue;
                }

                // expired -> unmute if needed, then drop
                if (expired) {
                    if (muted) await unmuteUser(bot, chatId, userId);
                    changed = true;
                    continue;
                }

                // not expired but already unmuted -> drop
                if (!muted) {
                    changed = true;
                    continue;
                }

                // still muted & not expired -> keep
                out.push(p);
                continue;
            }

            if (type === "ban") {
                const banned = await isCurrentlyBanned(bot, chatId, userId);

                if (banned === null) {
                    if (expired) {
                        changed = true;
                        continue;
                    }
                    out.push(p);
                    continue;
                }

                if (expired) {
                    if (banned) await unbanUser(bot, chatId, userId);
                    changed = true;
                    continue;
                }

                if (!banned) {
                    changed = true;
                    continue;
                }

                out.push(p);
                continue;
            }
        } catch (e) {
            // if tg says can't access / already not participant etc -> drop
            if (isIgnorableUserStateError(e)) {
                changed = true;
                continue;
            }

            // unexpected error -> keep for retry later
            out.push(p);
            continue;
        }
    }

    return { changed, out };
}

async function cleanupAntiSpamDoc(bot, doc) {
    const nowMs = Date.now();

    const settings = getObj(doc?.settings) || {};
    const docId = doc._id;

    const updates = {};

    // Iterate each chat settings
    for (const [chatIdStr, chatSettingsRaw] of Object.entries(settings)) {
        const chatSettings = getObj(chatSettingsRaw);
        if (!chatSettings) continue;

        const chatId = Number(chatIdStr);
        if (!chatId) continue;

        // anti_spam OR antispam
        const antiPick = pickKey(chatSettings, "anti_spam");
        const antiSpam = getObj(antiPick.value);
        if (!antiSpam) continue;

        const antiKey = antiPick.key; // which one exists in DB

        // helper for rule cleanup (telegram links + links block)
        const cleanupSingleRule = async (rulePick, ruleNameFallbackKeys) => {
            const rule = getObj(rulePick.value);
            if (!rule) return;

            const ruleKey = rulePick.key; // e.g. telegram_links or telegramlinks

            const warnedPick = pickKey(rule, "warned_users");
            const punishedPick = pickKey(rule, "punished_users");

            if (Array.isArray(warnedPick.value)) {
                const res = cleanupWarnedArray(warnedPick.value, nowMs);
                if (res.changed) {
                    updates[`settings.${chatIdStr}.${antiKey}.${ruleKey}.${warnedPick.key}`] = res.out;
                }
            }

            if (Array.isArray(punishedPick.value)) {
                const res = await cleanupPunishedArray(bot, chatId, punishedPick.value, nowMs);
                if (res.changed) {
                    updates[`settings.${chatIdStr}.${antiKey}.${ruleKey}.${punishedPick.key}`] = res.out;
                }
            }
        };

        // telegram_links / telegramlinks
        await cleanupSingleRule(pickKey(antiSpam, "telegram_links"));

        // links_block / linksblock
        await cleanupSingleRule(pickKey(antiSpam, "links_block"));

        // forwarding + quote (channels/groups/users/bots)
        for (const topKey of ["forwarding", "quote"]) {
            const topPick = pickKey(antiSpam, [topKey]);
            const topObj = getObj(topPick.value);
            if (!topObj) continue;

            for (const target of ["channels", "groups", "users", "bots"]) {
                const rule = getObj(topObj[target]);
                if (!rule) continue;

                const warnedPick = pickKey(rule, "warned_users");
                const punishedPick = pickKey(rule, "punished_users");

                if (Array.isArray(warnedPick.value)) {
                    const res = cleanupWarnedArray(warnedPick.value, nowMs);
                    if (res.changed) {
                        updates[`settings.${chatIdStr}.${antiKey}.${topKey}.${target}.${warnedPick.key}`] = res.out;
                    }
                }

                if (Array.isArray(punishedPick.value)) {
                    const res = await cleanupPunishedArray(bot, chatId, punishedPick.value, nowMs);
                    if (res.changed) {
                        updates[`settings.${chatIdStr}.${antiKey}.${topKey}.${target}.${punishedPick.key}`] = res.out;
                    }
                }
            }
        }
    }

    // apply updates for this doc
    const keys = Object.keys(updates);
    if (keys.length > 0) {
        await user_setting_module.updateOne({ _id: docId }, { $set: updates }).catch(() => { });
    }
}

async function runCleanupPenaltyTick(bot) {
    if (!bot?.telegram?.getChatMember) return;
    if (!user_setting_module) return;

    // Only need settings; lean for speed
    const docs = await user_setting_module.find({}, { settings: 1 }).lean();
    if (!docs || docs.length === 0) return;

    for (const doc of docs) {
        try {
            await cleanupAntiSpamDoc(bot, doc);
        } catch (e) {
            console.error("cleanup_panalty doc error:", e);
        }
    }
}

module.exports = (bot, opts = {}) => {
    const intervalMs = Number(opts.intervalMs || 60 * 1000); // 1 minute
    let timer = null;
    let running = false;

    async function tick() {
        if (running) return;
        running = true;

        try {
            await runCleanupPenaltyTick(bot);
        } catch (e) {
            console.error("cleanup_panalty tick error:", e);
        } finally {
            running = false;
        }
    }

    // run once immediately, then every interval
    tick().catch(() => { });
    timer = setInterval(() => tick().catch(() => { }), intervalMs);

    return {
        stop: () => {
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
};