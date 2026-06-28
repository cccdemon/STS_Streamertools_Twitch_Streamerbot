// Action: "CC – Out Raid" (ausgehender Raid)
// Trigger: Twitch → Raid Started (ausgehend)  — falls dein Streamerbot
//   kein Outgoing-Raid-Event hat, an einen Command (z.B. !raid <ziel>)
//   oder die native Raid-Sub-Action binden.
//
// Sendet ein Out-Raid-Event an das Alert-Overlay (overlay.html)
// über cc_alert_session. Overlay-alertType: "outraid".
// Felder die overlay.html liest: user (Ziel-Kanal), amount (Piloten/Viewer).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        var payload = new JObject
        {
            ["alertType"] = "outraid",
            ["user"]      = A("targetUserName") ?? A("targetUser") ?? A("raidTarget") ?? A("displayName") ?? "Unbekannt",
            ["amount"]    = A("viewers") ?? A("viewerCount") ?? "0",
        };
        return Send(payload, "OutRaid");
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
