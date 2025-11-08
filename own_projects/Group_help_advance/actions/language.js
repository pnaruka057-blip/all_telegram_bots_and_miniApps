// lang-menu.js
const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// Keep callback_data short to fit Telegram callback_data constraints
// Uses inline keyboard with Markup.button.callback per Telegraf docs.

const LANGS = [
    { code: "en", label: "English", emoji: "🇬🇧" },
    { code: "it", label: "Italiano", emoji: "🇮🇹" },
    { code: "es", label: "Español", emoji: "🇪🇸" },
    { code: "pt", label: "Português", emoji: "🇵🇹" },
    { code: "de", label: "Deutsch", emoji: "🇩🇪" },
    { code: "fr", label: "Français", emoji: "🇫🇷" },
    { code: "ro", label: "Română", emoji: "🇷🇴" },
    { code: "nl", label: "Nederlands", emoji: "🇳🇱" },
    { code: "zh_cn", label: "简体中文", emoji: "🇨🇳" },
    { code: "zh_tw", label: "繁體中文", emoji: "🇨🇳" },
    { code: "uk", label: "Українська", emoji: "🇺🇦" },
    { code: "ru", label: "Русский", emoji: "🇷🇺" },
    { code: "kk", label: "Қазақ", emoji: "🇰🇿" },
    { code: "tr", label: "Türkçe", emoji: "🇹🇷" },
    { code: "id", label: "Indonesia", emoji: "🇮🇩" },
    { code: "az", label: "Azərbaycanca", emoji: "🇦🇿" },
    { code: "uz_latn", label: "O'zbekcha", emoji: "🇺🇿" },
    { code: "uz_cyrl", label: "Ўзбекча", emoji: "🇺🇿" },
    { code: "ms", label: "Melayu", emoji: "🇲🇾" },
    { code: "so", label: "Soomaali", emoji: "🇸🇴" },
    { code: "sq", label: "Shqipe", emoji: "🇦🇱" },
    { code: "sr", label: "Srpski", emoji: "🇷🇸" },
    { code: "am", label: "Amharic", emoji: "🇪🇹" },
    { code: "el", label: "Ελληνικά", emoji: "🇬🇷" },
    { code: "ar", label: "العربية", emoji: "🇸🇦" },
    { code: "ko", label: "한국어", emoji: "🇰🇷" },
    { code: "fa", label: "پارسی", emoji: "🇮🇷" },
    { code: "ckb", label: "کوردی", emoji: "🌞" },
    { code: "hi", label: "हिंदी", emoji: "🇮🇳" },
    { code: "si", label: "සිංහල", emoji: "🇱🇰" },
    { code: "bn", label: "বাংলা", emoji: "🇧🇩" },
    { code: "ur", label: "اردو", emoji: "🇵🇰" }
];

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// Write nested single-subdocument path for languageSchema: { value }
async function setUserLang(userId, chatIdStr, code) {
    await user_setting_module.updateOne(
        { user_id: userId },
        {
            $setOnInsert: { user_id: userId },
            $set: {
                [`settings.${chatIdStr}.lang.value`]: code,
            }
        },
        { upsert: true }
    );
}

// Build the language picker and show current language on top
async function renderLanguageMenu(ctx, chatIdStr, userId) {
    // read current
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const curCode = doc?.settings?.[chatIdStr]?.lang?.value || "en";
    const cur = LANGS.find(l => l.code === curCode) || LANGS[0];
    const title =
        `🇬🇧 Choose your language\n\n` +
        `Current: ${cur.emoji} ${cur.label} (${cur.code})`;

    const rows = [];
    const pairs = chunk(LANGS, 2);
    for (const pair of pairs) {
        rows.push(
            pair.map(({ code, label, emoji }) => {
                const isActive = code === curCode;
                const text = isActive ? `✅ ${emoji} ${label}` : `${emoji} ${label}`;
                return Markup.button.callback(text, `SET_LANG_PICK_${code}_${chatIdStr}`);
            })
        );
    }

    // Only Back row (Time Zone removed)
    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, title, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

module.exports = (bot) => {
    // Open language menu
    bot.action(/^SET_LANG_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderLanguageMenu(ctx, chatIdStr, userId);
    });

    // Handle language selection
    bot.action(/^SET_LANG_PICK_([a-zA-Z_]+)_(-?\d+)$/, async (ctx) => {
        const code = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        await setUserLang(userId, chatIdStr, code);
        try { await ctx.answerCbQuery(`Language set: ${code}`); } catch { }
        await renderLanguageMenu(ctx, chatIdStr, userId);
    });
};
