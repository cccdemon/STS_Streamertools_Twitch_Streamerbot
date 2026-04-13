// Action: "CC – Follow Alert"
// Trigger: Twitch → Follow
//
// Sendet ein Follow-Event an die API.
// Die API broadcastet an alle Browser-Overlays (9091): alerts.html zeigt den Alert.

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

        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
            CPH.LogInfo($"[CC Follow] {user} → API broadcast");
        }
        else
        {
            CPH.LogInfo("[CC Follow] WARNUNG: cc_api_session nicht gesetzt!");
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
