// Action: "CC – Sub Gift Alert"
// Trigger: Twitch → Gift Sub
//
// Sendet ein Gift-Sub-Event direkt an das Alert-Overlay (alerts.html)
// via cc_alert_session (gesetzt durch cc_alert_register).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string gifter    = GetArg("displayName") ?? GetArg("userName") ?? "Anonym";
        string recipient = GetArg("recipientDisplayName") ?? GetArg("recipientUserName") ?? GetArg("recipient") ?? "Unbekannt";
        string tier      = GetArg("tier") ?? "1";
        string avatar    = GetArg("userProfileImageUrl") ?? GetArg("profileImageUrl") ?? "";
         CPH.SendMessage(tier);
        var payload = new JObject
        {
            ["event"]     = "subgift",
            ["alertType"] = "subgift",
            ["user"]      = gifter,
            ["recipient"] = recipient,
            ["tier"]      = tier,
            ["amount"]    = 1,
            ["avatar"]    = avatar
        };

        // ── Chatnachricht nach Tier ──
        string chatMsg;
        switch (tier)
        {
            case "tier 3":
                chatMsg = $"⚡💎 TIER 3 @{gifter} haut {amount} Abos raus – die Flotte feiert!";
                break;

            case "tier 2":
                chatMsg = $"⚡⭐ TIER 2  @{gifter} versorgt uns mit {amount} Abos – absolute Legende!";
                break;

            default:
                CPH.SendMessage("chatmessage set Tier fallback");
                chatMsg = $"⚡ @{gifter} versorgt die Flotte mit {amount} Abos! Alle Mann an die Geschütze!";
                break;
        }
        CPH.SendMessage(chatMsg);

        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC SubGift] {gifter} → {recipient} (Tier {tier}) → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC SubGift] Keine registrierte Alert-Session gefunden.");
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