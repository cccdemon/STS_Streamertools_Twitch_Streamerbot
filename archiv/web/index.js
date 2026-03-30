// ════════════════════════════════════════════════════════
// CHAOS CREW – Index JS
// Setzt alle Links dynamisch auf die aktuelle Host-Adresse
// ════════════════════════════════════════════════════════

// ── Dynamische Links ──────────────────────────────────────
(function() {
  var host = window.location.hostname;

  // Redis Commander und API Health auf aktuelle Host-IP
  var redisLink = document.getElementById('link-redis-ui');
  var apiLink   = document.getElementById('link-api-health');

  if (redisLink) redisLink.href = 'http://' + host + ':8081';
  if (apiLink)   apiLink.href   = 'http://' + host + ':3000/health';
})();

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
