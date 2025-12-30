// helpers/verify_user_joined_channel.js
// Checks whether a user is a member (or admin/creator) of a target public channel/group.
// ident can be: "@username", "username", "https://t.me/username", or "-1001234567890"

function normalizeIdent(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;

    // -100... chat id
    if (/^-100\d{6,20}$/.test(s)) return Number(s);

    // https://t.me/username | https://telegram.me/username | https://telegram.dog/username
    const m = s.match(/^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/([A-Za-z0-9_]{5,32})/i);
    if (m) return `@${m[1]}`;

    // @username or username
    if (/^@?[A-Za-z0-9_]{5,32}$/.test(s)) return s.startsWith("@") ? s : `@${s}`;

    return null;
}

async function verify_user_joined_channel(ctx, ident, userId) {
    try {
        const target = normalizeIdent(ident);
        if (!target) return false;

        const member = await ctx.telegram.getChatMember(target, userId);
        return ["member", "administrator", "creator"].includes(member?.status);
    } catch (e) {
        return false;
    }
}

module.exports = verify_user_joined_channel;