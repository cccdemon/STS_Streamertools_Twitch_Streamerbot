// Action: "SF – Fight Command"
// Trigger: Core → Command → "!fight"
// Permission: Everyone
// Cooldown: User 15s (Overlay hat zusätzlich clientseitigen Guard)
//
// Parst !fight @ziel, validiert und startet den Challenge-Flow:
//   - leere/Selbst-Herausforderung     → silent
//   - Stream offline                   → spacefight_rejected { stream_offline }
//     (Spacefight-Service schickt die "zu spät"-Chatnachricht)
//   - Ziel nicht im Chat aktiv         → spacefight_rejected { not_in_chat }
//     (Service schickt "Radarecho"-Chatnachricht)
//   - sonst                            → spacefight_challenge + pending-State
//
// Die pending Challenge landet in GlobalVar sf_challenge (JSON).
// SF_ChallengeAccept / SF_ChallengeDecline werten sie aus.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    private const int SEEN_WINDOW_SEC = 600;  // 10 Min. = "im Chat aktiv"
    private const int CHALLENGE_TTL_SEC = 30;

    public bool Execute()
    {
        string attacker = Sanitize(GetArg("userName") ?? GetArg("user"));
        if (string.IsNullOrEmpty(attacker)) return true;

        // Arg "input0" enthält bei Streamerbot das erste Command-Argument
        string rawTarget = GetArg("input0") ?? GetArg("rawInput") ?? "";
        string defender = Sanitize(rawTarget.Replace("@", "").Split(' ')[0]);

        if (string.IsNullOrEmpty(defender)) return true;
        if (defender == attacker) return true;

        // Stream online?
        if (!CPH.ObsIsStreaming(0))
        {
            Broadcast(new JObject {
                ["event"]    = "spacefight_rejected",
                ["reason"]   = "stream_offline",
                ["attacker"] = attacker,
                ["defender"] = defender
            });
            return true;
        }

        // Ziel im Chat aktiv?
        if (!IsActiveInChat(defender))
        {
            Broadcast(new JObject {
                ["event"]    = "spacefight_rejected",
                ["reason"]   = "not_in_chat",
                ["attacker"] = attacker,
                ["defender"] = defender
            });
            return true;
        }

        // Pending Challenge speichern
        long now = UnixNow();
        var pending = new JObject {
            ["attacker"] = attacker,
            ["defender"] = defender,
            ["ts"]       = now
        };
        CPH.SetGlobalVar("sf_challenge", pending.ToString(Newtonsoft.Json.Formatting.None), false);

        Broadcast(new JObject {
            ["event"]    = "spacefight_challenge",
            ["attacker"] = attacker,
            ["defender"] = defender
        });
        CPH.LogInfo($"[SF Fight] {attacker} fordert {defender} heraus");
        return true;
    }

    private bool IsActiveInChat(string user)
    {
        string raw = CPH.GetGlobalVar<string>("sf_chat_seen", false);
        if (string.IsNullOrEmpty(raw)) return false;
        JObject dict;
        try { dict = JObject.Parse(raw); } catch { return false; }
        if (!dict.ContainsKey(user)) return false;
        long ts = 0;
        try { ts = (long)dict[user]; } catch { return false; }
        return (UnixNow() - ts) <= SEEN_WINDOW_SEC;
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