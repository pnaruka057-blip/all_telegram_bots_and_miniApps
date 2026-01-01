// find_groups_and_chanenls.js
const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const userStartButton = require("../buttons/userStartButton");

module.exports = (bot) => {
    bot.action("START_BUTTON", async (ctx) => {
        if (ctx.chat.type === 'private') {
            userStartButton(ctx)
        }
    });
    bot.action("FIND_GROUPS_CHANNELS", async (ctx) => {
        try {
            // Acknowledge the button press (removes "loading" state)
            try { await ctx.answerCbQuery(); } catch (e) { /* ignore */ }

            const userId = ctx.from && ctx.from.id ? ctx.from.id : null;
            const miniAppLink = `${process.env.GLOBLE_DOMAIN}/${process.env.GROUP_HELP_ADVANCE_TOKEN}/group-help-advance/find-groups-channels?user_id=${userId}`;

            // Preferred: web_app button (opens in Telegram's Web App container on supported clients)
            // Fallback: url button for clients that don't support web_app
            let openButton;
            if (Markup.button && typeof Markup.button.webApp === "function") {
                // telegraf >= v4 supports Markup.button.webApp(text, url)
                openButton = Markup.button.webApp("Open Mini App — Search", miniAppLink);
            } else {
                // fallback: standard URL button
                openButton = Markup.button.url("Open Mini App — Search", miniAppLink);
            }

            const keyboard = Markup.inlineKeyboard([
                [openButton],
                // optional: back button or other actions
                [Markup.button.callback("⬅️ Back", "START_BUTTON")]
            ]);

            const text = [
                "🔎 <b>Find Groups & Channels</b>",
                "",
                "Use this option to discover all Telegram groups and channels that you:",
                "• Created or Own",
                "• Are an Admin in",
                "• Are a Member of",
                "",
                "The Mini-App will help you list these groups & channels and navigate to them directly.",
                "",
                "Tap the button below to open the Mini-App and start the process.",
                "",
                "<i>Privacy Notice:</i> Access is handled securely inside the Mini-App. Your account data is not accessed without your explicit permission."
            ].join("\n");

            // Send (or edit) message using your helper so it integrates with existing UX
            await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
        } catch (err) {
            console.error("Error in FIND_GROUPS_CHANNELS action:", err);
            try {
                await ctx.reply("⚠️ Koi error aaya. Kripya dobara koshish karein.");
            } catch (_) { }
        }
    });
};
