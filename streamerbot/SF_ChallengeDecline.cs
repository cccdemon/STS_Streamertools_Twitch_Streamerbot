// Action: "SF – Challenge Decline"
// Trigger: Core → Command → "!nein"
// Permission: Everyone
//
// Wenn eine pending Challenge existiert und der User der Defender ist,
// wird spacefight_rejected { challenge_declined } gesendet. Der
// Spacefight-Service schickt daraufhin die Ablehnungs-Chatnachricht.
// Kein Match → silent.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user = Sanitize(GetArg("userName") ?? GetArg("user"));
        if (string.IsNullOrEmpty(user)) return true;

        string raw = CPH.GetGlobalVar<string>("sf_challenge", false);
        if (string.IsNullOrEmpty(raw)) return true;

        JObject pending;
        try { pending = JObject.Parse(raw); } catch { return true; }

        string defender = pending["defender"]?.ToString() ?? "";
        string attacker = pending["attacker"]?.ToString() ?? "";
        if (defender != user) return true;

        CPH.UnsetGlobalVar("sf_challenge", false);
        Broadcast(new JObject {
            ["event"]    = "spacefight_rejected",
            ["reason"]   = "challenge_declined",
            ["attacker"] = attacker,
            ["defender"] = defender
        });
        CPH.LogInfo($"[SF Decline] {defender} lehnt Kampf gegen {attacker} ab");
        return true;
    }

    private void Broadcast(JObject payload)
    {
        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (string.IsNullOrEmpty(apiSession))
        {
            CPH.LogWarn("[SF] cc_api_session nicht gesetzt");
            return;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
    }

    private string GetArg(string key)
    {
        if (args.ContainsKey(key) && args[key] != null)
        {
            string v = args[key].ToString().Trim();
            return v.Length > 0 ? v : null;
        }
        return null;
    }

    private string Sanitize(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new System.Text.StringBuilder();
        foreach (char ch in s.Trim().ToLower())
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb.Append(ch);
        string clean = sb.ToString();
        return clean.Length <= 25 ? clean : clean.Substring(0, 25);
    }
}