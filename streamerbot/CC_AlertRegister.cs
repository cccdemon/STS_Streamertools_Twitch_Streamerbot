// Action: "CC – Alert Register"
// Trigger: Core → WebSocket → Custom Server Message
//
// Registriert die Sessions der Alert-Overlays:
//   cc_alert_register    → cc_alert_session    (alerts.html)
//   cc_raid_register     → cc_raid_session     (raid-info.html)
//   cc_shoutout_register → cc_shoutout_session (shoutout-info.html)

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        if (!args.ContainsKey("data") || args["data"] == null) return true;
        string raw = args["data"].ToString();
        if (string.IsNullOrEmpty(raw)) return true;

        // Schnellcheck: enthält es ein bekanntes Register-Event?
        if (!raw.Contains("cc_alert_register") &&
            !raw.Contains("cc_raid_register") &&
            !raw.Contains("cc_shoutout_register"))
            return true;

        JObject msg;
        try { msg = JObject.Parse(raw); }
        catch { return true; }

        string evnt = msg["event"]?.ToString();
        string sessionId = args.ContainsKey("sessionId") ? args["sessionId"]?.ToString() : null;
        if (string.IsNullOrEmpty(sessionId)) return true;

        switch (evnt)
        {
            case "cc_alert_register":
                CPH.SetGlobalVar("cc_alert_session", sessionId, false);
                CPH.LogInfo("[CC] Alert-Overlay registriert – Session: " + sessionId);
                break;

            case "cc_raid_register":
                CPH.SetGlobalVar("cc_raid_session", sessionId, false);
                CPH.LogInfo("[CC] Raid-Panel registriert – Session: " + sessionId);
                break;

            case "cc_shoutout_register":
                CPH.SetGlobalVar("cc_shoutout_session", sessionId, false);
                CPH.LogInfo("[CC] Shoutout-Panel registriert – Session: " + sessionId);
                break;
        }

        return true;
    }
}
