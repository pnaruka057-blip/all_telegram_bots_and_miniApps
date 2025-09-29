// Parse human duration like "3 month 2 days 12 hours 4 minutes 34 seconds"
// Returns total seconds (number) if parsed ok, otherwise null.
// Accepts plain integer (e.g., "30") => treated as minutes
function parseDurationToSeconds(input) {
    if (!input || typeof input !== "string") return null;
    const txt = input.trim().toLowerCase();

    // If only digits (e.g., "30"), treat as minutes
    if (/^\d+$/.test(txt)) {
        const minutes = parseInt(txt, 10);
        return minutes * 60;
    }

    const unitSeconds = {
        year: 365 * 24 * 3600, years: 365 * 24 * 3600, yr: 365 * 24 * 3600, y: 365 * 24 * 3600,
        month: 30 * 24 * 3600, months: 30 * 24 * 3600, mo: 30 * 24 * 3600,
        week: 7 * 24 * 3600, weeks: 7 * 24 * 3600, w: 7 * 24 * 3600,
        day: 24 * 3600, days: 24 * 3600, d: 24 * 3600,
        hour: 3600, hours: 3600, hr: 3600, h: 3600,
        minute: 60, minutes: 60, min: 60, mins: 60, m: 60,
        second: 1, seconds: 1, sec: 1, secs: 1, s: 1
    };

    const re = /(\d+)\s*(years?|yrs?|y|months?|mos?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/gi;
    let match;
    let total = 0;
    let found = false;
    while ((match = re.exec(txt)) !== null) {
        found = true;
        const num = parseInt(match[1], 10);
        const unitRaw = (match[2] || "").toLowerCase();
        let key = unitRaw;
        if (key.startsWith("yr") || key === "y") key = "year";
        else if (key.startsWith("mo") && key !== "m") key = "month";
        else if (key === "m") key = "m";
        else if (key.startsWith("min")) key = "minute";
        else if (key.startsWith("sec")) key = "second";
        else if (key.startsWith("hr")) key = "hour";
        else if (key.startsWith("week")) key = "week";
        else if (key.startsWith("day")) key = "day";
        else if (key.startsWith("hour")) key = "hour";
        else if (key.startsWith("month")) key = "month";
        else if (key.startsWith("year")) key = "year";

        const factor = unitSeconds[key];
        if (!factor) return null;
        total += num * factor;
    }

    if (!found) return null;
    return total;
}

module.exports = parseDurationToSeconds