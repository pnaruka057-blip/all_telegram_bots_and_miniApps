// adsgram-bot.js
const axios = require('axios');

// simple in-memory cooldown to avoid spamming same user (5 minutes)
const adCooldownMap = new Map(); // key = userId, value = timestamp(ms)
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Send AdsGram ad to a user (Telegram bot).
 * ctx -> telegraf context
 * rawBlockId -> e.g. "int-20013" or "20013" (we will extract digits)
 * opts: { language: 'en', force: false }
 */
async function sendAdsgramAd(ctx, rawBlockId, opts = {}) {
    try {
        if (!ctx || !ctx.from) return;
        const userId = String(ctx.from.id);

        // cooldown unless forced
        if (!opts.force) {
            const last = adCooldownMap.get(userId) || 0;
            if (Date.now() - last < COOLDOWN_MS) {
                // still in cooldown
                return;
            }
        }

        // extract numeric block id (AdsGram expects numeric part only)
        const blockId = String(rawBlockId).replace(/\D/g, '');
        if (!blockId) return;

        // build request params
        const params = { tgid: userId, blockid: blockId };
        if (opts.language) params.language = opts.language;

        // call AdsGram advbot endpoint
        const res = await axios.get('https://api.adsgram.ai/advbot', {
            params,
            timeout: 7000,
        });

        const data = res.data;
        if (!data || (!data.text_html && !data.image_url)) {
            // nothing to show
            return;
        }

        // prepare inline keyboard (array of rows, each row is array of buttons)
        const inline_keyboard = [];
        if (data.click_url && data.button_name) {
            inline_keyboard.push([{ text: String(data.button_name), url: String(data.click_url) }]);
        }
        if (data.reward_url && data.button_reward_name) {
            inline_keyboard.push([{ text: String(data.button_reward_name), url: String(data.reward_url) }]);
        }

        // common options for send
        const extraOptions = {
            parse_mode: 'HTML',
            protect_content: true,               // prevents forwarding
            reply_markup: inline_keyboard.length ? { inline_keyboard } : undefined,
            disable_web_page_preview: false
        };

        // send photo if image_url exists, otherwise send message
        if (data.image_url) {
            // ctx.replyWithPhoto accepts (photo, extra). We pass the image URL directly.
            await ctx.replyWithPhoto({ url: data.image_url }, {
                caption: data.text_html || '',
                ...extraOptions
            });
        } else {
            // fallback: text only
            await ctx.reply(data.text_html, { ...extraOptions });
        }

        // set cooldown
        adCooldownMap.set(userId, Date.now());
    } catch (err) {
        // log but do not crash the bot
        console.error('AdsGram error:', err?.response?.data || err.message || err);
    }
}

module.exports = sendAdsgramAd;