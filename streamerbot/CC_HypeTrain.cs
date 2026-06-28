// Action: "CC – Hype Train"
// Trigger: Twitch → Hype Train (Start / Level Up / Update)
//
// Sendet ein Hype-Train-Event an das Alert-Overlay (overlay.html)
// über cc_alert_session. Overlay-alertType: "hypetrain".
// Felder die overlay.html liest: level (1–5).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string level = A("level") ?? A("hypeLevel") ?? A("currentLevel") ?? "1";

        var payload = new JObject
        {
            ["alertType"] = "hypetrain",
            ["level"]     = level,
        };
        return Send(payload, "HypeTrain");
    }

    private bool Send(JObject payload, string tag)
    {
        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn($"[CC {tag}] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        CPH.LogInfo($"[CC {tag}] Level {payload["level"]} → Overlay broadcast");
        return true;
    }

    private string A(string key)
    {
        if (args.ContainsKey(key) && args[key] != null)
        {
            string v = args[key].ToString().Trim();
            return v.Length > 0 ? v : null;
        }
        return null;
    }
}
