// Action: "CC – Cheer/Bits Alert"
// Trigger: Twitch → Cheer
//
// Sendet ein Cheer-Event an die API.
// Die API broadcastet an alle Browser-Overlays (9091): alerts.html zeigt den Bits-Alert.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user    = GetArg("displayName") ?? GetArg("userName") ?? "Unbekannt";
        string bitsStr = GetArg("bits") ?? "0";
        string message = GetArg("message") ?? "";

        var payload = new JObject
        {
            ["event"]     = "cheer",
            ["alertType"] = "cheer",
            ["user"]      = user,
            ["amount"]    = bitsStr,
            ["message"]   = message
        };

        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC Cheer] {user} – {bitsStr} Bits → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC Cheer] Keine registrierte Alert-Session gefunden.");
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
