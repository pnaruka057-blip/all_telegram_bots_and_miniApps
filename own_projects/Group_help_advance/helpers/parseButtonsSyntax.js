// helpers/parseButtonsSyntax.js
module.exports = async function parseButtonsSyntax(ctx, rawText) {
    // returns { match: boolean, buttons?: Array<Array<{text,content}>>, error?: string }

    async function safeNotify(_ctx, message) {
        try {
            // If callback query, try edit
            if (_ctx?.callbackQuery?.message) {
                try {
                    await _ctx.editMessageText(message, { parse_mode: "Markdown" });
                    return;
                } catch (_) {
                    // ignore, fallback to reply
                }
            }
        } catch (_) { }

        try {
            if (typeof _ctx?.replyWithMarkdown === "function") {
                await _ctx.replyWithMarkdown(message);
                return;
            }
        } catch (_) { }

        try {
            await _ctx.reply(message);
        } catch (_) { }
    }

    function hasBalancedPairs(str, openCh, closeCh) {
        let c = 0;
        for (const ch of String(str || "")) {
            if (ch === openCh) c++;
            else if (ch === closeCh) c--;
            if (c < 0) return false;
        }
        return c === 0;
    }

    try {
        const s = String(rawText || "").trim();

        if (!s) {
            await safeNotify(
                ctx,
                "❌ Empty input.\n\nSend buttons like:\n`{[Title - t.me/Link]}`\n`{[Btn1 - link][Btn2 - link]}{[Row2Btn - link]}`"
            );
            return { match: false, error: "empty" };
        }

        // Strict: braces and brackets must be balanced, otherwise don't try to parse partially
        if (!hasBalancedPairs(s, "{", "}")) {
            await safeNotify(ctx, "❌ Invalid format: missing `{` or `}` (unbalanced curly braces).");
            return { match: false, error: "unbalanced_curly" };
        }
        if (!hasBalancedPairs(s, "[", "]")) {
            await safeNotify(ctx, "❌ Invalid format: missing `[` or `]` (unbalanced square brackets).");
            return { match: false, error: "unbalanced_square" };
        }

        // Extract rows from {...}
        const rowMatches = [];
        const reCurly = /\{([\s\S]*?)\}/g;
        let m;
        while ((m = reCurly.exec(s)) !== null) {
            rowMatches.push(m[1]);
        }

        if (!rowMatches.length) {
            await safeNotify(ctx, "❌ Invalid format: no `{...}` rows found. Use `{[Button title - action]}` per row.");
            return { match: false, error: "no_groups" };
        }

        // Reject extra text outside of curly groups
        const outside = s.replace(reCurly, "").trim();
        if (outside.length) {
            await safeNotify(
                ctx,
                "❌ Invalid format: extra text found outside `{...}` blocks.\n\nOnly send rows like:\n`{[Title - action]}`"
            );
            return { match: false, error: "outside_text" };
        }

        const parsedRows = [];

        for (const groupInnerRaw of rowMatches) {
            const groupInner = String(groupInnerRaw || "").trim();

            // Extract [ ... ] blocks (buttons)
            const tokens = [];
            const reSquare = /\[([^\]]+?)\]/g;
            let sq;
            while ((sq = reSquare.exec(groupInner)) !== null) {
                tokens.push(sq[1].trim());
            }

            if (!tokens.length) {
                await safeNotify(
                    ctx,
                    "❌ Invalid row: no `[ ... ]` buttons found inside `{...}`.\n\nExample:\n`{[Title - t.me/Link]}`"
                );
                return { match: false, error: "row_no_buttons" };
            }

            // Reject garbage inside row besides [..] and whitespace
            const leftover = groupInner.replace(reSquare, "").replace(/\s+/g, "").trim();
            if (leftover.length) {
                await safeNotify(
                    ctx,
                    "❌ Invalid row: found extra characters outside `[ ... ]` blocks inside `{...}`.\n\nCorrect:\n`{[Btn1 - link][Btn2 - link]}`"
                );
                return { match: false, error: "row_garbage" };
            }

            const parsedRow = [];

            for (const rawToken of tokens) {
                const token = String(rawToken || "").trim();

                // Must contain delimiter ' - ' (space-dash-space)
                const splitIndex = token.indexOf(" - ");
                if (splitIndex === -1) {
                    await safeNotify(
                        ctx,
                        "❌ Invalid button syntax: `" +
                        token +
                        "`\n\nEvery button must use ` - ` (space, dash, space) between title and action.\nExample: `{[Button title - t.me/Link]}`\n\nIf title needs a hyphen, escape it: `Button\\-title`."
                    );
                    return { match: false, error: "missing_separator" };
                }

                const rawTitle = token.slice(0, splitIndex).trim();
                const rawAction = token.slice(splitIndex + 3).trim();

                if (!rawTitle || !rawAction) {
                    await safeNotify(
                        ctx,
                        "❌ Invalid button entry: `" + token + "` — missing title or action.\nExample: `{[Title - action]}`"
                    );
                    return { match: false, error: "missing_parts" };
                }

                // Unescape \- in title
                const title = rawTitle.replace(/\\-/g, "-");
                const content = rawAction; // keep exactly (trimmed) as provided

                parsedRow.push({ text: title, content });
            }

            if (!parsedRow.length) {
                await safeNotify(ctx, "❌ Invalid row: no valid buttons parsed.");
                return { match: false, error: "row_empty" };
            }

            parsedRows.push(parsedRow);
        }

        if (!parsedRows.length) {
            await safeNotify(ctx, "❌ No valid buttons parsed. Please follow the syntax and try again.");
            return { match: false, error: "no_buttons" };
        }

        return { match: true, buttons: parsedRows };
    } catch (err) {
        console.error("parseButtonsSyntax error:", err);
        try {
            await ctx.reply("⚠️ Something went wrong while parsing buttons.");
        } catch (_) { }
        return { match: false, error: "exception" };
    }
};
