const { Scenes, Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const escapeMarkdownV2 = require("../helper/escapeMarkdownV2");
const cancelWizard = require("../helper/cancelWizard");
const start_message = require("../helper/start_message");
const bot = require("../bot_index");

const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[CANCEL]]).resize();

const editMovieWizard = new Scenes.WizardScene(
    "EDIT_MOVIE_SCENE",

    // Step 0: Ask for movie title
    async (ctx) => {
        let message = await ctx.reply("🔍 Please enter the *movie title* to search:", {
            parse_mode: "Markdown",
            ...keyboard
        });
        ctx.session.title_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 1: Handle title search
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        
        if (!text) {
            return ctx.reply("❌ Please enter a valid movie title:");
        }
       
        ctx.deleteMessage(ctx.session.title_edit_movie_message_id)
        delete ctx.session.title_edit_movie_message_id

        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        const searchText = text.trim();
        const regex = new RegExp(searchText, "i");
        const results = await movies_module.find({ title: regex });

        if (!results.length) {
            ctx.scene.leave();
            return ctx.reply("🚫 No movies found with that title. Try again:", {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([Markup.button.callback("🔍 Find Again", "EDIT_MOVIE_ADMIN_PANEL"), Markup.button.callback("🏠 Main Menu", "ADMIN_MAIN_MENU")])
            });
        }

        for (const movie of results) {
            const buttons = [];

            for (let i = 0; i < movie.download_link.length; i++) {
                const quality = movie.quality[i] || `Quality ${i + 1}`;
                buttons.push([Markup.button.url(`Download (${quality})`, movie.download_link[i])]);
            }

            buttons.push([
                Markup.button.callback("✏️ Edit This", `EDIT_THIS_${movie._id}`)
            ]);

            const caption = `🎬 Title: *${escapeMarkdownV2(movie.title)}*
🗓️ Release Date: ${escapeMarkdownV2(movie.release_date)}
🈳 Language: ${escapeMarkdownV2(movie.language)}
🎭 Genre: ${escapeMarkdownV2(movie.genre)}
📊 Downloads: ${movie.download_count}`;

            await ctx.replyWithPhoto(movie.thumbnail, {
                caption,
                parse_mode: "MarkdownV2",
                reply_markup: Markup.inlineKeyboard(buttons).reply_markup
            });
        }

        await ctx.reply("✅ Choose a movie above or start a new search anytime.", Markup.removeKeyboard());
        return ctx.scene.leave();
    }
);

module.exports = editMovieWizard;
