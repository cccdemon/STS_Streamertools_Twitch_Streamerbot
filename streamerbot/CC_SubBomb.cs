// Action: "CC – Sub Bomb Alert"
// Trigger: Twitch → Gift Bomb (Mass Gift)
//
// Sendet ein Sub-Bomb-Event direkt an das Alert-Overlay (alerts.html)
// via cc_alert_session (gesetzt durch cc_alert_register).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string gifter = GetArg("displayName") ?? GetArg("userName") ?? "Anonym";
        string amount = GetArg("gifts") ?? GetArg("total") ?? GetArg("count") ?? "0";
        string tier   = GetArg("tier") ?? "1";
        string avatar = GetArg("userProfileImageUrl") ?? GetArg("profileImageUrl") ?? "";

        var payload = new JObject
        {
            ["event"]     = "subbomb",
            ["alertType"] = "subbomb",
            ["user"]      = gifter,
            ["amount"]    = amount,
            ["tier"]      = tier,
            ["avatar"]    = avatar
        };

        // ── Chatnachricht nach Tier ──
        string chatMsg;
        switch (tier)
        {
            case "tier 3":
                chatMsg = $"⚡💎 TIER 3 SUBBOMBE! @{gifter} haut {amount} Abos raus – die Flotte feiert!";
                break;

            case "tier 2":
                chatMsg = $"⚡⭐ TIER 2 SUBBOMBE! @{gifter} versorgt uns mit {amount} Abos – absolute Legende!";
                break;

            default:
                CPH.SendMessage("chatmessage set Tier fallback");
                chatMsg = $"⚡ SUBBOMBE! @{gifter} versorgt die Flotte mit {amount} Abos! Alle Mann an die Geschütze!";
                break;
        }




        CPH.SendMessage(chatMsg);

        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC SubBomb] {gifter} ({amount}x Tier {tier}) → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC SubBomb] Keine registrierte Alert-Session gefunden.");
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
