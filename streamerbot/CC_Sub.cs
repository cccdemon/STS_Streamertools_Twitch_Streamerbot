// Action: "CC – Sub" (KONSOLIDIERT)
// Trigger (alle vier auf DIESE Action legen):
//   Twitch → Subscription            (Erstabo)
//   Twitch → Resubscription          (Resub)
//   Twitch → Gift Subscription       (einzelnes Geschenk-Abo)
//   Twitch → Community Gift Sub      (Sub-Bombe / Mehrfach-Geschenk)
//
// Erkennt den Typ aus den vorhandenen Args und sendet das passende
// Overlay-Event an cc_alert_session. Overlay-alertTypes:
//   sub      → user, tier, avatar
//   resub    → user, tier, cumulativeMonths, avatar
//   subgift  → user (Schenker), recipient, amount=1, tier, avatar
//   subbomb  → user (Schenker), amount (Anzahl), tier, avatar
// tier wird auf Twitch-Format normalisiert: "1000" | "2000" | "3000".

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user   = A("displayName") ?? A("userName") ?? "Unbekannt";
        string tier   = NormTier(A("tier") ?? A("subTier"));
        string avatar = A("userProfileImageUrl") ?? A("profileImageUrl") ?? "";

        string gifts     = A("gifts") ?? A("totalSubsGifted") ?? A("count");
        string recipient = A("recipientDisplayName") ?? A("recipientUserName") ?? A("recipient");
        string cumMonths = A("cumulativeMonths") ?? A("months");

        int giftCount = 0; int.TryParse(gifts, out giftCount);

        JObject payload;
        string chatMsg;

        if (gifts != null && giftCount >= 2)
        {
            // ── Sub-Bombe (Community Gift) ──
            string gifter = A("displayName") ?? A("userName") ?? "Anonym";
            payload = new JObject
            {
                ["alertType"] = "subbomb",
                ["user"]      = gifter,
                ["amount"]    = giftCount,
                ["tier"]      = tier,
                ["avatar"]    = avatar,
            };
            chatMsg = $"⚡ {gifter} zündet eine Sub-Bombe: +{giftCount} Subs für die Crew! o7";
        }
        else if (recipient != null)
        {
            // ── Einzelnes Geschenk-Abo ──
            string gifter = A("displayName") ?? A("userName") ?? "Anonym";
            payload = new JObject
            {
                ["alertType"] = "subgift",
                ["user"]      = gifter,
                ["recipient"] = recipient,
                ["amount"]    = 1,
                ["tier"]      = tier,
                ["avatar"]    = avatar,
            };
            chatMsg = $"🎁 {gifter} schenkt {recipient} ein Abo – willkommen an Bord!";
        }
        else if (cumMonths != null && ParseInt(cumMonths) > 1)
        {
            // ── Resub ──
            payload = new JObject
            {
                ["alertType"]        = "resub",
                ["user"]             = user,
                ["tier"]             = tier,
                ["cumulativeMonths"] = cumMonths,
                ["avatar"]           = avatar,
            };
            chatMsg = $"⟳ {user} bleibt an Bord – {cumMonths} Monate Dienst für die Crew! o7";
        }
        else
        {
            // ── Erstabo ──
            payload = new JObject
            {
                ["alertType"] = "sub",
                ["user"]      = user,
                ["tier"]      = tier,
                ["avatar"]    = avatar,
            };
            chatMsg = tier == "3000"
                ? $"💎 TIER 3 ABO! {user} kauft uns praktisch ein neues Schiff – Legende! o7"
                : tier == "2000"
                    ? $"⭐ TIER 2 ABO von {user}! Volle Triebwerke, danke!"
                    : $"🚀 {user} ist der Chaos Crew beigetreten! Willkommen an Bord! o7";
        }

        CPH.SendMessage(chatMsg);
        return Send(payload, payload["alertType"].ToString());
    }

    // tier → "1000" | "2000" | "3000"; akzeptiert "1"/"2"/"3", "Tier 2", "prime", "2000" …
    private string NormTier(string t)
    {
        if (string.IsNullOrEmpty(t)) return "1000";
        t = t.ToLower();
        if (t.Contains("3")) return "3000";
        if (t.Contains("2")) return "2000";
        return "1000";
    }

    private int ParseInt(string s)
    {
        int n; return int.TryParse(s, out n) ? n : 0;
    }

    private bool Send(JObject payload, string tag)
    {
        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn($"[CC Sub:{tag}] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        CPH.LogInfo($"[CC Sub:{tag}] → Overlay broadcast");
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
