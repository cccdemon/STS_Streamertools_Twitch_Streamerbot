// Action: "CC – Follow"
// Trigger: Twitch → Follow
//
// Sendet ein Follow-Event an das Alert-Overlay (overlay.html)
// über cc_alert_session. Overlay-alertType: "follow".
// Felder die overlay.html liest: user, avatar (optional).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        var payload = new JObject
        {
            ["alertType"] = "follow",
            ["user"]      = A("displayName") ?? A("userName") ?? "Unbekannt",
            ["avatar"]    = A("userProfileImageUrl") ?? A("profileImageUrl") ?? "",
        };
        return Send(payload, "Follow");
    }

    // ── Broadcast an das Alert-Overlay (cc_alert_session) ──
    private bool Send(JObject payload, string tag)
    {
        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn($"[CC {tag}] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        CPH.LogInfo($"[CC {tag}] → Overlay broadcast");
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
