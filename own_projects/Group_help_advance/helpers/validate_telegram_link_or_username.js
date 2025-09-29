
function validate_telegram_link_or_username(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();

  // strip surrounding braces [] {} if user pasted them accidentally
  s = s.replace(/^[\{\[]+/, "").replace(/[\}\]]+$/, "").trim();

  // Accept tg://user?id=123 or tg://user?id=12345
  if (/^tg:\/\/user\?id=\d+$/i.test(s)) return s;

  // 1) Username: allow with or without leading '@'
  // Minimum 5 chars (letters/numbers/underscore), same as your earlier rule
  const usernameMatch = s.match(/^@?([A-Za-z0-9_]{5,})$/);
  if (usernameMatch) {
    return "@" + usernameMatch[1]; // normalized with leading @
  }

  // 2) Telegram links: allow t.me and telegram.me (with optional http(s) and www)
  // capture host and path (path must be present)
  const linkMatch = s.match(/^(?:https?:\/\/)?(?:www\.)?(t\.me|telegram\.me)\/(.+)$/i);
  if (linkMatch) {
    const host = linkMatch[1].toLowerCase();
    let path = linkMatch[2].trim();

    // disallow empty path or only slashes
    if (!path || /^\/+$/.test(path)) return null;

    // Normalize: use https:// + original host (keep telegram.me if user used it)
    // remove any leading slashes from path
    path = path.replace(/^\/+/, "");

    // Some users paste query or trailing spaces — keep them as-is but trimmed
    return `https://${host}/${path}`;
  }

  // 3) sometimes people paste "t.me/username" without http - handled above because we allow optional protocol
  // if nothing matched -> invalid
  return null;
}

module.exports = validate_telegram_link_or_username;