const Markup = require("telegraf/markup");

const BACK = "⬅ Back";
const SKIP = "⏭ Skip";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, SKIP, CANCEL]]).resize();

module.exports = async function scense_stepBack(ctx, stepTo, message, prefix) {
    // Delete current message if exists
    const keys = Object.keys(ctx.session);
    const lastKey = keys.find(key => key.endsWith(`${prefix}_message_id`));
    if (lastKey) {
        try {
            await ctx.deleteMessage(ctx.session[lastKey]);
        } catch (err) {
            console.error("Error deleting old message on back:", err.message);
        }
        delete ctx.session[lastKey];
    }

    // Go back to previous step
    ctx.wizard.selectStep(stepTo);
    const sent = await ctx.reply(message, {
        parse_mode: "Markdown",
        ...keyboard
    });

    // Store new message ID for auto-deletion
    let stepMap
    if (prefix === '_add_show') {
        stepMap = {
            1: "title",
            2: "release_date",
            3: "language",
            4: "genre",
            5: "thumbnail",
            6: "category",
            7: "download_link",
            8: "qualities",
        };
    } else if (prefix === '_edit_show') {
        stepMap = {
            1: "title",
            2: "release_date",
            3: "language",
            4: "genre",
            5: "thumbnail",
            6: "category",
            7: "category",
            8: "download_link",
            9: "qualities",
        };
    } else if (prefix === '_add_movie' || prefix === '_edit_movie') {
        stepMap = {
            1: "title",
            2: "release_date",
            3: "language",
            4: "genre",
            5: "thumbnail",
            6: "download_link",
            7: "qualities",
            8: "category",
        };
    }
    const stepKey = stepMap[stepTo];
    if (stepKey) {
        ctx.session[`${stepKey}${prefix}_message_id`] = sent.message_id;
    }

    return;
};
