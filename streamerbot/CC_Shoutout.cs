// Action: "CC – Shoutout"
// Trigger: Core → Command → !so  (Berechtigung: Moderator / Broadcaster)
//
// Sendet eine Shoutout-Chatnachricht, löst den nativen
// Twitch-Shoutout aus, und broadcastet an das
// Shoutout-Info-Panel (shoutout-info.html) und
// Alert-Overlay (alerts.html).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        // Ziel-Username aus dem Command-Argument holen
        string target = "";
        if (args.ContainsKey("input0") && args["input0"] != null)
            target = args["input0"].ToString().Trim().TrimStart('@');

        if (string.IsNullOrEmpty(target)) return true;

        // Sicherheitscheck: nur a-z, A-Z, 0-9, _
        var sb = new System.Text.StringBuilder();
        foreach (char ch in target)
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb.Append(ch);
        target = sb.ToString();

        if (target.Length == 0 || target.Length > 25) return true;

        // ── Chatnachricht senden ──
        CPH.SendMessage($"Besucht den Kanal von @{target}! twitch.tv/{target.ToLower()}", true);

        // ── Nativen Twitch-Shoutout auslösen ──
        try
        {
            var m = CPH.GetType().GetMethod("TwitchSendShoutout");
            if (m != null) m.Invoke(CPH, new object[] { target });
        }
        catch { }

        // ── Broadcast an Shoutout-Info-Panel (shoutout-info.html) ──
        var soPayload = new JObject
        {
            ["alertType"]       = "shoutout-panel",
            ["user"]            = target,
            ["game"]            = "",
            ["bio"]             = "",
            ["profileImageUrl"] = ""
        };
        BroadcastToSession("cc_shoutout_session", soPayload.ToString());

        // ── Broadcast an Alert-Overlay (alerts.html) ──
        var alertPayload = new JObject
        {
            ["alertType"]       = "shoutout",
            ["user"]            = target,
            ["game"]            = "",
            ["profileImageUrl"] = ""
        };
        BroadcastToSession("cc_alert_session", alertPayload.ToString());

        CPH.LogInfo($"[CC Shoutout] {target} → Broadcast gesendet");
        return true;
    }

    private void BroadcastToSession(string sessionKey, string json)
    {
        string session = CPH.GetGlobalVar<string>(sessionKey, false);
        if (!string.IsNullOrEmpty(session))
            CPH.WebsocketCustomServerBroadcast(json, session, 0);
    }
}
