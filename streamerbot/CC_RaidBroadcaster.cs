// Action: "CC – Raid Broadcaster"
// Trigger: Twitch → Raid
//
// Wenn ein Raid eingeht, werden die Daten an das
// Raid-Info-Panel (raid-info.html) und das Alert-Overlay
// (alerts.html) via Custom WS Server gebroadcastet.

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

        // ── Broadcast an Alert-Overlay (alerts.html) ──
        var alertPayload = new JObject
        {
            ["alertType"]       = "raid",
            ["user"]            = user,
            ["amount"]          = viewers,
            ["profileImageUrl"] = avatar,
            ["game"]            = game
        };

        // An alle registrierten Alert-Sessions senden
        BroadcastToSession("cc_alert_session", alertPayload.ToString());

        // ── Broadcast an Raid-Info-Panel (raid-info.html) ──
        var raidPayload = new JObject
        {
            ["alertType"]       = "raid",
            ["user"]            = user,
            ["amount"]          = viewers,
            ["profileImageUrl"] = avatar,
            ["game"]            = game,
            ["bio"]             = ""
        };

        BroadcastToSession("cc_raid_session", raidPayload.ToString());

        CPH.LogInfo($"[CC Raid] {user} mit {viewers} Viewern → Broadcast gesendet");
        return true;
    }

    private void BroadcastToSession(string sessionKey, string json)
    {
        string session = CPH.GetGlobalVar<string>(sessionKey, false);
        if (!string.IsNullOrEmpty(session))
            CPH.WebsocketCustomServerBroadcast(json, session, 0);
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
