// Action: "GW – Chat Message"
// Trigger: Twitch → Chat Message (alle)
//
// v5: Kein State mehr in Streamerbot.
// Schickt rohe Chat-Events an die API.
// Keyword-Check, Cooldown, Wortanzahl – alles in der API.

public class CPHInline
{
    private static readonly string[] BOTS = {
        "streamelements","nightbot","moobot","fossabot",
        "wizebot","botrixoficial","commanderroot"
    };

    public bool Execute()
    {
        if (!CPH.ObsIsStreaming(0)) return true;

        string user = GetUser();
        if (string.IsNullOrEmpty(user)) return true;
        if (IsBot(user)) return true;

        string message = "";
        if (args.ContainsKey("message") && args["message"] != null)
        {
            message = args["message"].ToString().Trim();
            if (message.Length > 500) message = message.Substring(0, 500);
        }

        // Einfach Event an API weiterleiten
        var payload = Newtonsoft.Json.JsonConvert.SerializeObject(new System.Collections.Generic.Dictionary<string, object>
        {
            ["event"]   = "chat_msg",
            ["user"]    = user,
            ["message"] = message,
            ["ts"]      = (long)(System.DateTime.UtcNow - new System.DateTime(1970,1,1)).TotalSeconds
        });

        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
            CPH.WebsocketCustomServerBroadcast(payload, apiSession, 0);

        return true;
    }

    private string GetUser()
    {
        string raw = null;
        if (args.ContainsKey("userName") && args["userName"] != null) raw = args["userName"].ToString();
        else if (args.ContainsKey("user") && args["user"] != null) raw = args["user"].ToString();
        if (string.IsNullOrEmpty(raw)) return null;
        var sb = new System.Text.StringBuilder();
        foreach (char ch in raw.Trim())
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb.Append(ch);
        string clean = sb.ToString();
        return clean.Length > 0 && clean.Length <= 25 ? clean : null;
    }

    private bool IsBot(string user)
    {
        string u = user.ToLower();
        foreach (var b in BOTS) if (u == b) return true;
        return false;
    }
}
