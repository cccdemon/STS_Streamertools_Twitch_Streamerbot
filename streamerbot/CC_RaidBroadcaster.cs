// Action: "CC – Raid" (eingehender Raid)
// Trigger: Twitch → Raid
//
// Sendet ein Raid-Event an das Alert-Overlay (overlay.html)
// über cc_alert_session. Overlay-alertType: "raid".
// Felder die overlay.html liest: user, amount (Viewer), avatar, game (optional).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user    = A("displayName") ?? A("userName") ?? A("user") ?? "Unbekannt";
        string viewers = A("viewers") ?? A("viewerCount") ?? "0";
        string game    = A("gameName") ?? A("game") ?? "";

        var payload = new JObject
        {
            ["alertType"] = "raid",
            ["user"]      = user,
            ["amount"]    = viewers,
            ["avatar"]    = A("profileImageUrl") ?? A("userProfileImageUrl") ?? "",
            ["game"]      = game,
        };

        // Chat-Ankündigung
        string msg = $"🚀 Raid incoming! {user} bringt {viewers} Viewer mit!";
        if (!string.IsNullOrEmpty(game)) msg += $" (zuletzt: {game})";
        CPH.SendMessage(msg);

        return Send(payload, "Raid");
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
