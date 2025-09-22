// helper: format ms to human readable (e.g. "1m 30s" or "30s")
function formatMs(ms) {
  if (typeof ms !== "number" || ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins > 0) {
    if (secs > 0) return `${mins}m ${secs}s`;
    return `${mins}m`;
  }
  return `${secs}s`;
}

module.exports = formatMs