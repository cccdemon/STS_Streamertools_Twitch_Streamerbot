// Action: "SF – Chat Tracker"
// Trigger: Twitch → Chat Message (alle, niedrige Priorität)
//
// Speichert pro User einen "last seen" Zeitstempel in der GlobalVar
// sf_chat_seen (JSON dict). Wird von SF_FightCmd benutzt, um zu
// prüfen, ob das Ziel eines !fight aktuell im Chat aktiv ist
// (Fenster: SEEN_WINDOW_SEC).
//
// Alte Einträge (> SEEN_WINDOW_SEC) werden bei jedem Update bereinigt,
// sodass die Dict-Größe im Rahmen bleibt.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    private const int SEEN_WINDOW_SEC = 600; // 10 Minuten

    private static readonly string[] BOTS = {
        "streamelements","nightbot","moobot","fossabot",
        "wizebot","botrixoficial","commanderroot"
    };

    public bool Execute()
    {
        string user = GetUser();
        if (string.IsNullOrEmpty(user)) return true;
        if (IsBot(user)) return true;

        long now = (long)(System.DateTime.UtcNow - new System.DateTime(1970,1,1)).TotalSeconds;
        string raw = CPH.GetGlobalVar<string>("sf_chat_seen", false);

        JObject dict;
        try { dict = string.IsNullOrEmpty(raw) ? new JObject() : JObject.Parse(raw); }
        catch { dict = new JObject(); }

        long cutoff = now - SEEN_WINDOW_SEC;
        var toRemove = new System.Collections.Generic.List<string>();
        foreach (var kv in dict)
        {
            long ts = 0;
            try { ts = (long)kv.Value; } catch {}
            if (ts < cutoff) toRemove.Add(kv.Key);
        }
        foreach (var k in toRemove) dict.Remove(k);

        dict[user] = now;

        CPH.SetGlobalVar("sf_chat_seen", dict.ToString(Newtonsoft.Json.Formatting.None), false);
        return true;
    }

    private string GetUser()
    {
        string raw = null;
        if (args.ContainsKey("userName") && args["userName"] != null) raw = args["userName"].ToString();
        else if (args.ContainsKey("user") && args["user"] != null) raw = args["user"].ToString();
        if (string.IsNullOrEmpty(raw)) return null;
        var sb = new System.Text.StringBuilder();
        foreach (char ch in raw.Trim().ToLower())
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb.Append(ch);
        string clean = sb.ToString();
        return clean.Length > 0 && clean.Length <= 25 ? clean : null;
    }

    private bool IsBot(string user)
    {
        foreach (var b in BOTS) if (user == b) return true;
        return false;
    }
}