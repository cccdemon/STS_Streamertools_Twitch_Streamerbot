// Action: "CC – Cheer"
// Trigger: Twitch → Cheer
//
// Sendet ein Bits/Cheer-Event an das Alert-Overlay (overlay.html)
// über cc_alert_session. Overlay-alertType: "cheer".
// Felder die overlay.html liest: user, amount (Bits), avatar (optional).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        var payload = new JObject
        {
            ["alertType"] = "cheer",
            ["user"]      = A("displayName") ?? A("userName") ?? "Unbekannt",
            ["amount"]    = A("bits") ?? "0",
            ["avatar"]    = A("userProfileImageUrl") ?? A("profileImageUrl") ?? "",
        };
        return Send(payload, "Cheer");
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
