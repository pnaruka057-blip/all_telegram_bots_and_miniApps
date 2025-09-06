// helpers/parseButtonsSyntax.js
module.exports = async function parseButtonsSyntax(ctx, rawText) {
    // returns { match: boolean, buttons?: Array, error?: string }
    try {
        const s = (rawText || "").trim();
        if (!s) {
            await safeNotify(ctx, "❌ Empty input. Please send buttons using the required syntax, e.g. `{[Title - t.me/Link]}`.");
            return { match: false, error: "empty" };
        }

        // notify helper: try edit if callback, otherwise reply
        async function safeNotify(ctx, message) {
            try {
                if (ctx?.callbackQuery?.message) {
                    // try edit first (may fail silently)
                    try {
                        await ctx.editMessageText(message, { parse_mode: "Markdown" });
                        return;
                    } catch (_) {
                        // fallback to reply
                    }
                }
            } catch (_) { }
            try {
                await ctx.replyWithMarkdown(message);
            } catch (_) {
                try { await ctx.reply(message); } catch (_) { }
            }
        }

        // find all {...} groups — each corresponds to a row (per your spec)
        // We'll accept both { ... } and {[ ... ] ... } forms: we parse contents inside each outer {}
        const curlys = [];
        const reCurly = /\{([\s\S]*?)\}/g;
        let m;
        while ((m = reCurly.exec(s)) !== null) {
            curlys.push(m[1].trim());
        }

        if (!curlys.length) {
            await safeNotify(ctx, "❌ Invalid format — no `{...}` groups found. Use `{[Button title - action]}` per row.");
            return { match: false, error: "no_groups" };
        }

        const parsedRows = [];

        for (const groupInner of curlys) {
            // groupInner could contain multiple [ ... ] blocks OR plain content separated by ][
            // We'll extract all [ ... ] occurrences. If none, treat the whole groupInner as single token (legacy).
            const btns = [];
            const reSquare = /\[([^\]]+?)\]/g;
            let foundSquare = false;
            let sq;
            while ((sq = reSquare.exec(groupInner)) !== null) {
                foundSquare = true;
                btns.push(sq[1].trim());
            }

            // if no square brackets found, maybe user wrote like "{[A - x]}" without []? but examples always have []
            // fallback: split by '&&' on groupInner
            let tokens = [];
            if (foundSquare) {
                tokens = btns;
            } else {
                // try to split by && and treat each as token
                tokens = groupInner.split("&&").map(t => t.trim()).filter(Boolean);
            }

            const parsedRow = [];

            for (const rawToken of tokens) {
                // token may look like: Button title - action (and user may have escaped hyphens in title: Button\-title)
                const token = rawToken.trim();

                // validation: require the delimiter ' - ' (space-dash-space)
                if (!token.includes(" - ")) {
                    // if token contains only escaped hyphens (like 'Button\-title - ...') then " - " still required
                    await safeNotify(ctx,
                        "❌ Invalid button syntax: `" + token + "`\n\n" +
                        "Every button must use the ` - ` separator (space, dash, space) between the title and the action.\n" +
                        "Example: `{[Button title - t.me/Link]}` or `{[Share - share:Text to share]}`\n\n" +
                        "If your button title needs a literal hyphen, escape it like `\\-` (e.g. `Button\\-title`).\n\nPlease fix and send again."
                    );
                    return { match: false, error: "missing_separator" };
                }

                // split on the first ' - '
                const splitIndex = token.indexOf(" - ");
                const rawTitle = token.slice(0, splitIndex).trim();
                const rawAction = token.slice(splitIndex + 3).trim(); // after ' - '

                if (!rawTitle || !rawAction) {
                    await safeNotify(ctx, "❌ Invalid button entry: `" + token + "` — missing title or action. Example: `{[Title - action]}`");
                    return { match: false, error: "missing_parts" };
                }

                // unescape \- in title
                const title = rawTitle.replace(/\\-/g, "-");

                // store content exactly as provided (action part) — as you requested
                const content = rawAction;

                // push into parsedRow as { text, content }
                parsedRow.push({ text: title, content });
            }

            if (parsedRow.length) parsedRows.push(parsedRow);
        } // end groups loop

        if (!parsedRows.length) {
            await safeNotify(ctx, "❌ No valid buttons parsed. Please follow the syntax and try again.");
            return { match: false, error: "no_buttons" };
        }

        // success
        return { match: true, buttons: parsedRows };

    } catch (err) {
        console.error("parseButtonsSyntax error:", err);
        try { await ctx.reply("⚠️ Something went wrong while parsing buttons."); } catch (_) { }
        return { match: false, error: "exception" };
    }
};
