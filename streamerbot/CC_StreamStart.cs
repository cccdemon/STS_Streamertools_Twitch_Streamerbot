// Action: "CC – Stream Start"
// Trigger: Twitch → Stream Online
//
// Sendet ein Stream-Start-Event an das Alert-Overlay (overlay.html)
// über cc_alert_session. Overlay-alertType: "streamstart" (keine Felder
// nötig; Overlay zeigt eine feste "MISSION GESTARTET"-Animation).
//
// Hinweis: SF_StreamOnline (Spacefight) hängt ebenfalls am "Stream Online"-
// Trigger und sendet an die Bridge. Beide Actions können parallel am
// selben Trigger laufen — sie nutzen unterschiedliche Sessions.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        var payload = new JObject { ["alertType"] = "streamstart" };

        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn("[CC StreamStart] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        CPH.LogInfo("[CC StreamStart] → Overlay broadcast");
        return true;
    }
}
