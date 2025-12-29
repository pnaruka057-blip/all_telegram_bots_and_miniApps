// /cron/auto_message_delete.js
// Every 1 minute: find due messages (status=pending, delete_at <= now),
// delete from Telegram, then delete the DB row if deletion succeeded.
// No per-message setTimeout; only one interval tick.

const auto_delete_messages_module = require("../models/messages_module");

function extractTgErrorText(err) {
    return String(
        err?.response?.description ||
        err?.description ||
        err?.message ||
        ""
    ).toLowerCase();
}

// If Telegram says message is already gone / can't be deleted, we can safely
// remove DB entry to avoid infinite retries.
function isIgnorableDeleteError(err) {
    const t = extractTgErrorText(err);
    return (
        t.includes("message to delete not found") ||
        t.includes("message_id_invalid") ||
        t.includes("message can't be deleted") ||
        t.includes("chat not found") ||
        t.includes("bot was kicked") ||
        t.includes("need administrator rights") ||
        t.includes("not enough rights")
    );
}

module.exports = function startAutoMessageDeleteCron(bot, opts = {}) {
    const intervalMs = Number(opts.intervalMs || 60 * 1000); // 1 min

    let timer = null;
    let running = false;

    async function tick() {
        if (running) return;
        running = true;

        try {
            if (!bot?.telegram?.deleteMessage) return;
            if (!auto_delete_messages_module) return;

            const now = new Date();

            // due pending messages
            const due = await auto_delete_messages_module
                .find({
                    status: "pending",
                    delete_at: { $lte: now },
                })
                .sort({ delete_at: 1 })
                .lean();

            if (!due || due.length === 0) return;

            for (const job of due) {
                const chatId = Number(job.group_id);
                const messageId = Number(job.message_id);

                if (!chatId || !messageId) {
                    // bad record -> mark failed
                    await auto_delete_messages_module
                        .updateOne({ _id: job._id }, { $set: { status: "failed" } })
                        .catch(() => { });
                    continue;
                }

                try {
                    await bot.telegram.deleteMessage(chatId, messageId);

                    // success -> remove DB row
                    await auto_delete_messages_module
                        .deleteOne({ _id: job._id })
                        .catch(() => { });
                } catch (err) {
                    if (isIgnorableDeleteError(err)) {
                        // can't delete / already deleted -> remove DB row anyway
                        await auto_delete_messages_module
                            .deleteOne({ _id: job._id })
                            .catch(() => { });
                    } else {
                        // retry later? (mark failed so it doesn't loop forever)
                        await auto_delete_messages_module
                            .updateOne({ _id: job._id }, { $set: { status: "failed" } })
                            .catch(() => { });
                    }
                }
            }
        } catch (e) {
            console.error("auto_message_delete tick error:", e);
        } finally {
            running = false;
        }
    }

    // run once immediately, then every minute
    tick().catch(() => { });
    timer = setInterval(() => tick().catch(() => { }), intervalMs);

    return {
        stop: () => {
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
};