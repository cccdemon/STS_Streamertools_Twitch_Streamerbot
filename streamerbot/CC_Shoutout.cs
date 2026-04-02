// Action: "CC – Shoutout"
// Trigger: Core → Command → !so  (Berechtigung: Moderator / Broadcaster)
//
// Sendet eine Shoutout-Chatnachricht und löst den nativen
// Twitch-Shoutout aus.

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

        // Chatnachricht senden
        CPH.SendMessage($"Besucht den Kanal von @{target}! twitch.tv/{target.ToLower()}", true);

        // Nativen Twitch-Shoutout auslösen (falls Streamerbot-Version es unterstützt)
        try
        {
            var m = CPH.GetType().GetMethod("TwitchSendShoutout");
            if (m != null) m.Invoke(CPH, new object[] { target });
        }
        catch { }

        return true;
    }
}
