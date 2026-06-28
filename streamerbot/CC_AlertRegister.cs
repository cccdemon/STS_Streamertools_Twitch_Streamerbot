// Action: "CC – Alert Register"
// Trigger: Core → WebSocket → Custom Server → Message
//
// Das Alert-Overlay (overlay.html) sendet beim Verbinden
// { "event": "cc_alert_register" }. Diese Action speichert die
// Session-ID der Verbindung als GlobalVar cc_alert_session –
// danach senden alle CC-Alert-Actions ihre Events gezielt an
// diese Session (→ Overlay).
//
// Hinweis: in-memory (persist=false) → nach Streamerbot-Neustart
// weg, bis das Overlay neu verbindet und sich re-registriert.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        if (!args.ContainsKey("data") || args["data"] == null) return true;
        string raw = args["data"].ToString();
        if (string.IsNullOrEmpty(raw) || !raw.Contains("cc_alert_register")) return true;

        JObject msg;
        try { msg = JObject.Parse(raw); }
        catch { return true; }

        if (msg["event"]?.ToString() != "cc_alert_register") return true;

        string sessionId = args.ContainsKey("sessionId") ? args["sessionId"]?.ToString() : null;
        if (string.IsNullOrEmpty(sessionId)) return true;

        CPH.SetGlobalVar("cc_alert_session", sessionId, false);
        CPH.LogInfo("[CC] Alert-Overlay registriert – Session: " + sessionId);
        return true;
    }
}
