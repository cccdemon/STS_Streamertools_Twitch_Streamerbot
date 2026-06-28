// Action: "CC – ID / Steckbrief"
// Trigger: Core → Command → !id   (Berechtigung: Everyone, Cooldown empfohlen)
//
// Zeigt dem aufrufenden User seinen Steckbrief im Alert-Overlay (overlay.html):
// Watchtime, Errungenschaften, Status (Followage, Abo, Bits ...) + ein
// netter Status-Satz.
//
// Diese Action macht KEIN HTTP (Streamerbots Inline-C# referenziert System.Net
// nicht). Sie sammelt nur die Twitch-/Hauling-Felder und broadcastet sie als
// alertType:"profile_request" an cc_alert_session. Das Overlay (Browser) ruft
// dann selbst /alerts/api/profile auf, reichert mit Watchtime + Giveaway- +
// Spacefight-Daten an und rendert die Personalakte.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        // ── Subjekt = aufrufender User ────────────────────────
        CPH.TryGetArg("userName", out string login);       // Twitch-Login (klein)
        CPH.TryGetArg("user", out string display);         // Anzeigename
        if (string.IsNullOrEmpty(login))
        {
            CPH.SendMessage("Konnte deinen Account nicht lesen. Versuch's nochmal.");
            return false;
        }
        if (string.IsNullOrEmpty(display)) display = login;

        // ── Twitch-Status (best effort, fehlende Werte = Default) ──
        string avatar = (args.ContainsKey("userProfileImageUrl") && args["userProfileImageUrl"] != null)
            ? args["userProfileImageUrl"].ToString() : "";

        bool isSub = false;
        if (args.ContainsKey("isSubscribed") && args["isSubscribed"] != null)
            bool.TryParse(args["isSubscribed"].ToString(), out isSub);

        string tier = (args.ContainsKey("subscriptionTier") && args["subscriptionTier"] != null)
            ? args["subscriptionTier"].ToString() : "";   // "1000"/"2000"/"3000" o. leer

        int subMon = 0;
        if (args.ContainsKey("cumulativeMonths") && args["cumulativeMonths"] != null)
            int.TryParse(args["cumulativeMonths"].ToString(), out subMon);
        if (subMon == 0 && args.ContainsKey("subscriptionMonths") && args["subscriptionMonths"] != null)
            int.TryParse(args["subscriptionMonths"].ToString(), out subMon);

        long bits = 0;
        if (args.ContainsKey("bits") && args["bits"] != null)
            long.TryParse(args["bits"].ToString(), out bits);

        int followDays = 0;                                // optional via Sub-Action befüllen
        if (args.ContainsKey("followAgeDays") && args["followAgeDays"] != null)
            int.TryParse(args["followAgeDays"].ToString(), out followDays);

        // Bits-Gesamt bevorzugt aus persistenter UserVar (falls getrackt)
        long bitsVar = CPH.GetTwitchUserVar<long?>(login, "bitsTotal", true) ?? 0;
        if (bitsVar > bits) bits = bitsVar;

        // Hauling-Punkte + Rang (eigenes Chatgame)
        int haulPoints = CPH.GetTwitchUserVar<int?>(login, "haulPoints", true) ?? 0;

        // ── Rohfelder ans Overlay; Anreicherung macht der Browser-Fetch ──
        var payload = new JObject
        {
            ["alertType"]     = "profile_request",
            ["login"]         = login,
            ["display"]       = display,
            ["avatar"]        = avatar,
            ["isSub"]         = isSub,
            ["subTier"]       = string.IsNullOrEmpty(tier) ? "1000" : tier,
            ["subMonths"]     = subMon,
            ["bitsTotal"]     = bits,
            ["followageDays"] = followDays,
            ["haulPoints"]    = haulPoints,
            ["haulRank"]      = haulPoints > 0 ? HaulRank(haulPoints) : "",
        };

        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn("[CC Id] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        CPH.LogInfo($"[CC Id] profile_request für {login} → Overlay");
        return true;
    }

    static string HaulRank(int balance)
    {
        if (balance >= 50000) return "Sternenspediteur";
        if (balance >= 25000) return "Logistik-Magnat";
        if (balance >= 10000) return "Frachtbaron";
        if (balance >= 5000)  return "Frachtprofi";
        if (balance >= 2000)  return "Kurierfahrer";
        if (balance >= 500)   return "Lehrling";
        return "Frachtanfänger";
    }
}
