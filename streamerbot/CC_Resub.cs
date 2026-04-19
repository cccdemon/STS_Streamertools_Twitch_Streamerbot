// Action: "CC – Resub Alert"
// Trigger: Twitch → Resub
//
// Sendet ein Resub-Event direkt an das Alert-Overlay (alerts.html)
// via cc_alert_session (gesetzt durch cc_alert_register).

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user   = GetArg("displayName") ?? GetArg("userName") ?? "Unbekannt";
        string tier   = GetArg("tier") ?? "1000";
        string months = GetArg("cumulativeMonths") ?? GetArg("months") ?? "1";
        string avatar = GetArg("userProfileImageUrl") ?? GetArg("profileImageUrl") ?? "";

        var payload = new JObject
        {
            ["event"]            = "resub",
            ["alertType"]        = "resub",
            ["user"]             = user,
            ["tier"]             = tier,
            ["cumulativeMonths"] = months,
            ["avatar"]           = avatar
        };

        // ── Chatnachricht nach Tier ──
        string chatMsg;
        if (tier == "3000")
            chatMsg = $"💎 TIER 3 RESUB! @{user} ist seit {months} Monaten bei der Chaos Crew – Legende!";
        else if (tier == "2000")
            chatMsg = $"⭐ TIER 2 RESUB von @{user} – {months} Monate an Bord! Volle Fahrt voraus!";
        else
            chatMsg = $"🔁 @{user} bleibt weiter dabei – {months} Monate Dienst für die Chaos Crew! o7";
        CPH.SendMessage(chatMsg);

        string alertSession = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (!string.IsNullOrEmpty(alertSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), alertSession, 0);
            CPH.LogInfo($"[CC Resub] {user} (Tier {tier}, {months} Monate) → Alert-Overlay broadcast");
        }
        else
        {
            CPH.LogWarn("[CC Resub] Keine registrierte Alert-Session gefunden.");
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