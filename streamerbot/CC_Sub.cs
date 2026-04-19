// Action: "CC – Sub Alert"
// Trigger: Twitch → Sub (Erstabo)
//
// Sendet ein Sub-Event direkt an das Alert-Overlay (alerts.html)
// via cc_alert_session (gesetzt durch cc_alert_register).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user   = GetArg("displayName") ?? GetArg("userName") ?? "Unbekannt";
        string tier   = GetArg("tier") ?? "1";
        string avatar = GetArg("userProfileImageUrl") ?? GetArg("profileImageUrl") ?? "";
        CPH.SendMessage(tier);

        var payload = new JObject
        {
            ["event"]     = "sub",
            ["alertType"] = "sub",
            ["user"]      = user,
            ["tier"]      = tier,
            ["avatar"]    = avatar
        };

        // ── Chatnachricht nach Tier ──
        string chatMsg;
        switch (tier)
        {
            case "tier 3":
                chatMsg = $"💎 TIER 3 ABO! @{user} kauft uns praktisch ein neues Schiff – absolute Legende! o7";
                break;

            case "tier 2":
                chatMsg = $"⭐ TIER 2 ABO von @{user}! Die Chaos Crew dankt – volle Triebwerke!";
                break;

            default:
                CPH.SendMessage("chatmessage set Tier fallback");
                chatMsg = $"🚀 @{user} hat sich der Chaos Crew als Crewmitglied angeschlossen! Willkommen an Bord! o7";
                break;
        }

        CPH.SendMessage(chatMsg);

        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC Sub] {user} (Tier {tier}) → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC Sub] Keine registrierte Alert-Session gefunden.");
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