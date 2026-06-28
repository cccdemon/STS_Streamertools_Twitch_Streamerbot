// Action: "CC – Haul Register"
// Trigger: Core → WebSocket → Custom Server → Message
//
// Das Hauling-Overlay (haul.html) sendet beim Verbinden
// { "event": "cc_haul_register" }. Diese Action speichert die
// Session-ID als GlobalVar cc_haul_session – Hauling.cs sendet
// dann seine Spiel-Events gezielt an diese Session (→ Overlay).
//
// In-memory (persist=false) → nach Streamerbot-Neustart weg, bis
// das Overlay neu verbindet und sich re-registriert.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        if (!args.ContainsKey("data") || args["data"] == null) return true;
        string raw = args["data"].ToString();
        if (string.IsNullOrEmpty(raw) || !raw.Contains("cc_haul_register")) return true;

        JObject msg;
        try { msg = JObject.Parse(raw); }
        catch { return true; }

        if (msg["event"]?.ToString() != "cc_haul_register") return true;

        string sessionId = args.ContainsKey("sessionId") ? args["sessionId"]?.ToString() : null;
        if (string.IsNullOrEmpty(sessionId)) return true;

        CPH.SetGlobalVar("cc_haul_session", sessionId, false);
        CPH.LogInfo("[CC] Hauling-Overlay registriert – Session: " + sessionId);
        return true;
    }
}
