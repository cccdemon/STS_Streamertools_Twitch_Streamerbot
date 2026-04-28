// Action: "GW – Viewer Tick"
// Trigger: Twitch → Present Viewer
//
// v5: Kein State mehr in Streamerbot.
// Schickt nur das rohe Event an die API.
// Die API übernimmt Watchtime-Accumulation + Redis + PG.
//
// Debug-Logging: Sendet bei jeder Stage ein cc_debug Event
// an die API. Wird in PG (debug_log) gespeichert + an alle
// Admin-WS-Clients gebroadcastet (Debug-Console unten).

public class CPHInline
{
    private const string DEBUG_SOURCE = "GW_ViewerTick";

    private static readonly string[] BOTS = {
        "streamelements","nightbot","moobot","fossabot",
        "wizebot","botrixoficial","commanderroot"
    };

    public bool Execute()
    {
        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        string rawUser = GetRawUser();

        SendDebug(apiSession, "enter", rawUser, null);

        if (string.IsNullOrEmpty(apiSession))
        {
            // Kein API-Session: keiner kann den Debug empfangen, return still
            return true;
        }

        if (!CPH.ObsIsStreaming(0))
        {
            SendDebug(apiSession, "obs_skip", rawUser, "OBS not streaming");
            return true;
        }

        string user = SanitizeUser(rawUser);
        if (string.IsNullOrEmpty(user))
        {
            SendDebug(apiSession, "bad_user", rawUser, "user empty after sanitize");
            return true;
        }

        if (IsBot(user))
        {
            SendDebug(apiSession, "bot_skip", user, null);
            return true;
        }

        var payload = Newtonsoft.Json.JsonConvert.SerializeObject(new System.Collections.Generic.Dictionary<string, object>
        {
            ["event"] = "viewer_tick",
            ["user"]  = user,
            ["ts"]    = (long)(System.DateTime.UtcNow - new System.DateTime(1970,1,1)).TotalSeconds
        });
        CPH.WebsocketCustomServerBroadcast(payload, apiSession, 0);

        SendDebug(apiSession, "sent", user, null);
        return true;
    }

    private void SendDebug(string apiSession, string stage, string user, string info)
    {
        if (string.IsNullOrEmpty(apiSession)) return;
        try
        {
            var dbg = Newtonsoft.Json.JsonConvert.SerializeObject(new System.Collections.Generic.Dictionary<string, object>
            {
                ["event"]  = "cc_debug",
                ["source"] = DEBUG_SOURCE,
                ["stage"]  = stage,
                ["user"]   = user ?? "",
                ["info"]   = info ?? "",
                ["ts"]     = (long)(System.DateTime.UtcNow - new System.DateTime(1970,1,1)).TotalSeconds
            });
            CPH.WebsocketCustomServerBroadcast(dbg, apiSession, 0);
        }
        catch { /* niemals den Trigger blockieren */ }
    }

    private string GetRawUser()
    {
        if (args.ContainsKey("userName") && args["userName"] != null) return args["userName"].ToString();
        if (args.ContainsKey("user") && args["user"] != null) return args["user"].ToString();
        return null;
    }

    private string SanitizeUser(string raw)
    {
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
