const userStartButton = require("../buttons/userStartButton");

module.exports = (bot) => {
    bot.action("BACK_TO_HOME", async (ctx) => {
        try {
            await userStartButton(ctx);
        } catch (err) {
            console.error("❌ Error in BACK_TO_HOME action:", err);
            ctx.reply("⚠️ Couldn't go back to main menu.");
        }
    });
};
