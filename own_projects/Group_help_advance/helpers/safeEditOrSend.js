module.exports = async (ctx, text, extra, returnMessageId = false) => {
    try {
        const message = ctx.callbackQuery?.message;
        let sentMessage;

        // Case 1: Callback query → try edit
        if (message) {
            const currentText = message.text || message.caption || "";
            const isDifferentText = currentText !== text;
            const isDifferentMarkup =
                JSON.stringify(message.reply_markup) !== JSON.stringify(extra?.reply_markup);

            if (isDifferentText || isDifferentMarkup) {
                if (message.caption !== undefined) {
                    sentMessage = await ctx.editMessageCaption({
                        caption: text,
                        ...extra
                    });
                } else {
                    sentMessage = await ctx.editMessageText(text, extra);
                }
            } else {
                sentMessage = message; // already same
            }
        }

        // Case 2: Normal command (/start) → direct reply
        else {
            sentMessage = await ctx.reply(text, extra);
        }

        // Agar 4th argument true hai → message_id return karo
        if (returnMessageId && sentMessage) {
            return sentMessage.message_id;
        }

    } catch (err) {
        if (
            err.description?.includes("message can't be edited") ||
            err.description?.includes("there is no text in the message to edit") ||
            err.description?.includes("message to edit not found") // ✅ NEW CASE
        ) {
            // fallback → new message bhejna
            const sentMessage = await ctx.reply(text, extra);
            if (returnMessageId && sentMessage) {
                return sentMessage.message_id;
            }
        } else if (!err.description?.includes("message is not modified")) {
            console.error("safeEditOrSend error:", err);
        }
    }
};
