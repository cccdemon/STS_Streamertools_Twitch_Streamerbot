// ════════════════════════════════════════════════════════
// CHAOS CREW – Index JS
// ════════════════════════════════════════════════════════

// ── Clock ─────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2,'0');
  var m = String(now.getMinutes()).padStart(2,'0');
  var s = String(now.getSeconds()).padStart(2,'0');
  var el = document.getElementById('clock');
  if (el) el.textContent = h + ':' + m + ':' + s;
}
updateClock();
setInterval(updateClock, 1000);
