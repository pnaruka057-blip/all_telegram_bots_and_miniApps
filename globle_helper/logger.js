const fs = require("fs");

function LOG(...args) {
    const msg = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    const line = `[${new Date().toISOString()}] ${msg}`;

    console.log(line);
    fs.appendFileSync("app.log", line + "\n");
}

module.exports = LOG;