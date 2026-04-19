// Action: "CC – Raid Broadcaster"
// Trigger: Twitch → Raid
//
// Sendet ein Raid-Event an das Alert-Overlay (alerts.html) via cc_alert_session
// UND an die API (cc_api_session → Bridge → raid-info.html via /alerts/ws).

using System;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user    = GetArg("displayName") ?? GetArg("userName") ?? GetArg("user") ?? "Unbekannt";
        string viewers = GetArg("viewers") ?? GetArg("viewerCount") ?? "0";
        string avatar  = GetArg("profileImageUrl") ?? GetArg("userProfileImageUrl") ?? "";
        string game    = GetArg("gameName") ?? GetArg("game") ?? "";

        var payload = new JObject
        {
            ["event"]           = "raid",
            ["alertType"]       = "raid",
            ["user"]            = user,
            ["amount"]          = viewers,
            ["profileImageUrl"] = avatar,
            ["game"]            = game
        };

        // ── Chatnachricht senden ──
        string msg = $"🚀 Raid incoming! {user} bringt {viewers} Viewer mit!";
        if (!string.IsNullOrEmpty(game))
            msg += $" (zuletzt: {game})";
        CPH.SendMessage(msg);

        // An Alert-Overlay (alerts.html, direkt an Streamerbot angebunden)
        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC Raid] {user} mit {viewers} Viewern → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC Raid] Keine registrierte Alert-Session gefunden.");
        }

        // An API (Bridge → Redis → raid-info.html via /alerts/ws)
        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
            CPH.LogInfo($"[CC Raid] {user} → API broadcast");
        }

        return true;
    }

    private string GetArg(string key)
    {
        if (args.ContainsKey(key) && args[key] != null)
        {
            string val = args[key].ToString().Trim();
            return val.Length > 0 ? val : null;
        }
        return null;
    }
}
