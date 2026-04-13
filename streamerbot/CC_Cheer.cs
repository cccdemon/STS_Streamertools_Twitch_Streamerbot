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

        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
            CPH.LogInfo($"[CC Cheer] {user} – {bitsStr} Bits → API broadcast");
        }
        else
        {
            CPH.LogInfo("[CC Cheer] WARNUNG: cc_api_session nicht gesetzt!");
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
