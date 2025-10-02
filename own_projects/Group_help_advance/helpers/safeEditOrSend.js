// safeEditOrSend(ctx, text, extra, returnMessageId = false)
// Internal flags in `extra`:
//   __asMedia: boolean (target state is media or text)
//   __media: InputMedia object or media spec when __asMedia===true
//   show_caption_above_media: boolean (passed through to captioned media)

module.exports = async (ctx, text, extra = {}, returnMessageId = false) => {
    // Pull internal control flags (and strip before calling Telegram)
    const wantMedia = Boolean(extra.__asMedia);
    const mediaSpec = extra.__media;
    const showAbove = extra.show_caption_above_media === true;

    // Build a clean copy for Telegram calls (no internal flags)
    const { __asMedia, __media, ...cleanExtra } = extra;

    try {
        const message = ctx.callbackQuery?.message;
        let sentMessage;

        if (message) {
            const hasMedia =
                Boolean(message.photo?.length) ||
                Boolean(message.video) ||
                Boolean(message.animation) ||
                Boolean(message.document) ||
                Boolean(message.audio);

            const currentText = message.text || message.caption || "";
            const isDifferentText = currentText !== text;
            const isDifferentMarkup =
                JSON.stringify(message.reply_markup) !== JSON.stringify(cleanExtra?.reply_markup);

            // Case A: switching MEDIA -> TEXT (cannot be edited to remove media)
            if (hasMedia && !wantMedia) {
                try {
                    await ctx.deleteMessage(message.message_id);
                } catch (e) {
                    // Ignore delete failures (e.g., permissions/age)
                }
                sentMessage = await ctx.reply(text, cleanExtra);
            }

            // Case B: switching TEXT -> MEDIA (add media to text via editMessageMedia)
            else if (!hasMedia && wantMedia) {
                sentMessage = await ctx.editMessageMedia(
                    {
                        ...(typeof mediaSpec === 'string'
                            ? { type: 'photo', media: mediaSpec } // default photo
                            : mediaSpec),                         // full InputMedia*
                        caption: text,
                        parse_mode: cleanExtra.parse_mode,
                        show_caption_above_media: showAbove
                    },
                    { reply_markup: cleanExtra.reply_markup }
                );
            }

            // Case C: MEDIA -> MEDIA (edit caption or replace media if changed)
            else if (hasMedia && wantMedia) {
                // If a new media is provided, replace it; else edit caption/markup only
                if (mediaSpec) {
                    sentMessage = await ctx.editMessageMedia(
                        {
                            ...(typeof mediaSpec === 'string'
                                ? { type: 'photo', media: mediaSpec }
                                : mediaSpec),
                            caption: text,
                            parse_mode: cleanExtra.parse_mode,
                            show_caption_above_media: showAbove
                        },
                        { reply_markup: cleanExtra.reply_markup }
                    );
                } else if (isDifferentText || isDifferentMarkup) {
                    sentMessage = await ctx.editMessageCaption({
                        caption: text,
                        parse_mode: cleanExtra.parse_mode,
                        reply_markup: cleanExtra.reply_markup,
                        show_caption_above_media: showAbove
                    });
                } else {
                    sentMessage = message;
                }
            }

            // Case D: TEXT -> TEXT
            else {
                if (isDifferentText || isDifferentMarkup) {
                    sentMessage = await ctx.editMessageText(text, cleanExtra);
                } else {
                    sentMessage = message;
                }
            }
        }

        // No callback message → send fresh message
        else {
            if (wantMedia) {
                // Send media as new message
                sentMessage = await ctx.replyWithPhoto(
                    typeof mediaSpec === 'string' ? mediaSpec : mediaSpec?.media || mediaSpec,
                    {
                        caption: text,
                        parse_mode: cleanExtra.parse_mode,
                        show_caption_above_media: showAbove,
                        reply_markup: cleanExtra.reply_markup
                    }
                );
            } else {
                sentMessage = await ctx.reply(text, cleanExtra);
            }
        }

        if (returnMessageId && sentMessage) {
            return sentMessage.message_id === undefined
                ? (sentMessage.message?.message_id || null)
                : sentMessage.message_id;
        }
    } catch (err) {
        // Fallbacks for common edit errors → send a new appropriate message
        const desc = err?.description || '';
        const canFallback =
            desc.includes("message can't be edited") ||
            desc.includes("there is no text in the message to edit") ||
            desc.includes("message to edit not found");

        if (canFallback) {
            if (extra.__asMedia && extra.__media) {
                // Send media fresh
                const sent = await ctx.replyWithPhoto(
                    typeof extra.__media === 'string'
                        ? extra.__media
                        : extra.__media?.media || extra.__media,
                    {
                        caption: text,
                        parse_mode: extra.parse_mode,
                        show_caption_above_media: extra.show_caption_above_media === true,
                        reply_markup: extra.reply_markup
                    }
                );
                if (returnMessageId && sent) return sent.message_id;
            } else {
                const sent = await ctx.reply(text, { ...extra, reply_markup: extra.reply_markup });
                if (returnMessageId && sent) return sent.message_id;
            }
        } else if (!desc.includes("message is not modified")) {
            console.error("safeEditOrSend error:", err);
        }
    }
};
