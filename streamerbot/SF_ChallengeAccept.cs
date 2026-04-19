// Action: "SF – Challenge Accept"
// Trigger: Core → Command → "!ja"
// Permission: Everyone
//
// Prüft, ob es eine pending Challenge gibt, bei der der aufrufende
// User der Defender ist und die Challenge noch nicht abgelaufen ist.
// Wenn ja: sendet fight_cmd (Overlay startet die Animation) und
// löscht die pending Challenge. Abgelaufen/kein Match → silent.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    private const int CHALLENGE_TTL_SEC = 30;

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
        long ts = 0; try { ts = (long)pending["ts"]; } catch {}

        if (defender != user) return true;
        long age = UnixNow() - ts;
        if (age > CHALLENGE_TTL_SEC)
        {
            CPH.UnsetGlobalVar("sf_challenge", false);
            Broadcast(new JObject {
                ["event"]    = "spacefight_rejected",
                ["reason"]   = "challenge_timeout",
                ["attacker"] = attacker,
                ["defender"] = defender
            });
            return true;
        }

        CPH.UnsetGlobalVar("sf_challenge", false);
        Broadcast(new JObject {
            ["event"]    = "fight_cmd",
            ["attacker"] = attacker,
            ["defender"] = defender
        });
        CPH.LogInfo($"[SF Accept] {defender} nimmt Kampf gegen {attacker} an");
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

    private long UnixNow()
        => (long)(System.DateTime.UtcNow - new System.DateTime(1970,1,1)).TotalSeconds;

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