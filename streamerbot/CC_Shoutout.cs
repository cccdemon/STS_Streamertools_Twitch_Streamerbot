// Action: "CC – Shoutout"
// Trigger: Core → Command → !so  (Berechtigung: Moderator / Broadcaster)
//
// Sendet eine Shoutout-Chatnachricht, löst den nativen
// Twitch-Shoutout aus, und schickt das Event an die API
// (die es an alle Overlays weiterleitet).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        // Ziel-Username aus dem Command-Argument holen
        string target = "";
        if (args.ContainsKey("input0") && args["input0"] != null)
            target = args["input0"].ToString().Trim().TrimStart('@');
        // Fallback: rawInput
        if (string.IsNullOrEmpty(target) && args.ContainsKey("rawInput") && args["rawInput"] != null)
            target = args["rawInput"].ToString().Trim().TrimStart('@').Split(' ')[0];

        if (string.IsNullOrEmpty(target)) return true;

        // Sicherheitscheck: nur a-z, A-Z, 0-9, _
        var sb = new System.Text.StringBuilder();
        foreach (char ch in target)
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb.Append(ch);
        target = sb.ToString();

        if (target.Length == 0 || target.Length > 25) return true;

        // ── Twitch User-Info laden (Avatar, Game) ──
        string avatar = "";
        string game   = "";
        try
        {
            // TwitchUserInfoByLogin populates targetUser* args
            var infoMethod = CPH.GetType().GetMethod("TwitchUserInfoByLogin");
            if (infoMethod != null)
            {
                infoMethod.Invoke(CPH, new object[] { target });
                if (args.ContainsKey("targetUserProfileImageUrl"))
                    avatar = args["targetUserProfileImageUrl"]?.ToString() ?? "";
                if (args.ContainsKey("targetLastGame") || args.ContainsKey("targetUserGame"))
                {
                    game = (args.ContainsKey("targetLastGame") ? args["targetLastGame"]?.ToString() : null)
                        ?? (args.ContainsKey("targetUserGame") ? args["targetUserGame"]?.ToString() : null)
                        ?? "";
                }
            }
        }
        catch { CPH.LogInfo("[CC Shoutout] TwitchUserInfoByLogin nicht verfügbar"); }

        // ── Nativen Twitch-Shoutout auslösen ──
        try
        {
            var m = CPH.GetType().GetMethod("TwitchSendShoutout");
            if (m != null) m.Invoke(CPH, new object[] { target });
        }
        catch { }

        // ── Event an API senden → wird an alle Browser-Overlays gebroadcastet ──
        // shoutout-info.html und alerts.html empfangen das über API WS (9091)
        var payload = new JObject
        {
            ["event"]           = "shoutout",
            ["user"]            = target,
            ["profileImageUrl"] = avatar,
            ["game"]            = game,
            ["bio"]             = ""
        };

        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
            CPH.LogInfo($"[CC Shoutout] {target} → API broadcast");
        }
        else
        {
            CPH.LogInfo($"[CC Shoutout] WARNUNG: cc_api_session nicht gesetzt! API nicht verbunden?");
        }

        return true;
    }
}
