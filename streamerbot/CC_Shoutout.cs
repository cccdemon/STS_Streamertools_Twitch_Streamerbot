// Action: "CC – Shoutout"
// Trigger: Core → Command → !so  (Berechtigung: Moderator / Broadcaster)
//
// Löst den nativen Twitch-Shoutout aus und sendet ein Shoutout-Event
// an das Alert-Overlay (overlay.html) über cc_alert_session.
// Overlay-alertType: "shoutout". Felder die overlay.html liest:
// user, avatar, game.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        // Ziel-Username aus dem Command-Argument
        string target = "";
        if (args.ContainsKey("input0") && args["input0"] != null)
            target = args["input0"].ToString().Trim().TrimStart('@');
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

        // Twitch User-Info laden (Avatar, Game)
        string avatar = "";
        string game   = "";
        try
        {
            var infoMethod = CPH.GetType().GetMethod("TwitchUserInfoByLogin");
            if (infoMethod != null)
            {
                infoMethod.Invoke(CPH, new object[] { target });
                if (args.ContainsKey("targetUserProfileImageUrl"))
                    avatar = args["targetUserProfileImageUrl"]?.ToString() ?? "";
                game = (args.ContainsKey("targetLastGame") ? args["targetLastGame"]?.ToString() : null)
                    ?? (args.ContainsKey("targetUserGame") ? args["targetUserGame"]?.ToString() : null)
                    ?? "";
            }
        }
        catch { CPH.LogInfo("[CC Shoutout] TwitchUserInfoByLogin nicht verfügbar"); }

        // Nativen Twitch-Shoutout auslösen
        try
        {
            var m = CPH.GetType().GetMethod("TwitchSendShoutout");
            if (m != null) m.Invoke(CPH, new object[] { target });
        }
        catch { }

        var payload = new JObject
        {
            ["alertType"] = "shoutout",
            ["user"]      = target,
            ["avatar"]    = avatar,
            ["game"]      = game,
        };

        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn("[CC Shoutout] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        CPH.LogInfo($"[CC Shoutout] {target} → Overlay broadcast");
        return true;
    }
}
