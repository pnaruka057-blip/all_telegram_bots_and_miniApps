const { Scenes, Markup } = require("telegraf");
const shows_module = require("../model/shows_module");
const escapeMarkdownV2 = require("../helper/escapeMarkdownV2");
const cancelWizard = require("../helper/cancelWizard");
const start_message = require("../helper/start_message");
const bot = require("../bot_index");

const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[CANCEL]]).resize();

const editShowWizard = new Scenes.WizardScene(
    "EDIT_SHOW_SCENE",

    // Step 0: Ask for show title
    async (ctx) => {
        let message = await ctx.reply("🔍 Please enter the *show title* to search:", {
            parse_mode: "Markdown",
            ...keyboard
        });
        ctx.session.title_edit_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 1: Handle title search
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (!text) {
            return ctx.reply("❌ Please enter a valid show title:");
        }

        ctx.deleteMessage(ctx.session.title_edit_show_message_id)
        delete ctx.session.title_edit_show_message_id

        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        const searchText = text.trim();
        const regex = new RegExp(searchText, "i");
        const results = await shows_module.find({ title: regex });

        if (!results.length) {
            ctx.scene.leave();
            return ctx.reply("🚫 No shows found with that title. Try again:", {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([Markup.button.callback("🔍 Find Again", "EDIT_SHOW_ADMIN_PANEL"), Markup.button.callback("🏠 Main Menu", "ADMIN_MAIN_MENU")])
            });
        }

        for (const show of results) {
            const buttons = [];

            // Season-wise buttons
            show.series.forEach((_, index) => {
                buttons.push(Markup.button.callback(`S${index + 1}`, `SELECTED_SEASON_${show._id}_${index}`));
            });

            let externalButton = [Markup.button.callback("✏️ Edit This", `EDIT_THIS_SHOW_${show._id}`)];

            await ctx.replyWithPhoto(show.thumbnail, {
                caption: `
╭───────────────❒
⫸ 🎬 *Show Title:* ${show.title}
⫸ 📅 *Release Date:* ${show.release_date}
⫸ 🈳 *Language:* ${show.language}
⫸ 🎭 *Genre:* ${show.genre}
⫸ 📚 *Total Seasons:* ${show.series.length}
⫸ 📥 *Downloads:* ${show.download_count}
╰───────────────❒

> ⚠️ *This message will auto-delete after 5 minutes to avoid copyright issues.*`,
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([buttons, externalButton])
            });
        }

        await ctx.reply("✅ Choose a show above or start a new search anytime.", Markup.removeKeyboard());
        return ctx.scene.leave();
    }
);

module.exports = editShowWizard;