// Action: "CC – First Time Chatter"
// Trigger: Twitch → First Word (erste Chatnachricht eines Users)
//
// Sendet ein Willkommensgruß an den API → prüft ob Feature aktiv (Redis).
// Kann per Admin-Panel aktiviert/deaktiviert werden.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user = GetArg("displayName") ?? GetArg("userName") ?? GetArg("user") ?? "Unbekannt";

        var payload = new JObject
        {
            ["event"] = "first_chatter",
            ["user"]  = user
        };

        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
            CPH.LogInfo($"[CC FirstChatter] {user} → API");
        }
        else
        {
            CPH.LogInfo("[CC FirstChatter] WARNUNG: cc_api_session nicht gesetzt!");
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
