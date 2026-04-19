// Action: "CC – Follow Alert"
// Trigger: Twitch → Follow
//
// Sendet ein Follow-Event direkt an das Alert-Overlay (alerts.html)
// via cc_alert_session (gesetzt durch cc_alert_register).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user = GetArg("displayName") ?? GetArg("userName") ?? "Unbekannt";

        var payload = new JObject
        {
            ["event"]     = "follow",
            ["alertType"] = "follow",
            ["user"]      = user
        };

        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC Follow] {user} → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC Follow] Keine registrierte Alert-Session gefunden.");
        }

        return true;
    }

    private string GetArg(string key)
    {
        if (args.ContainsKey(key) && args[key] != null)
        {
            string val = args[key].ToString().Trim();
            return val.Length > 0 ? val : null;
        }
        return null;
    }
}
