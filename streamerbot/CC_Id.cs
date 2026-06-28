// Action: "CC – ID / Steckbrief"
// Trigger: Core → Command → !id   (Berechtigung: Everyone, Cooldown empfohlen)
//
// Zeigt dem aufrufenden User seinen Steckbrief im Alert-Overlay (overlay.html):
// Watchtime, Errungenschaften, Status (Followage, Abo, Bits ...) + ein
// netter Status-Satz. Ablauf:
//   1. Twitch-/Hauling-Daten des Users sammeln (soweit verfügbar).
//   2. POST an /alerts/api/profile → Service reichert mit Watchtime +
//      Giveaway- + Spacefight-Daten an und baut das fertige Payload.
//   3. Das zurückgegebene JSON (alertType:"profile") an cc_alert_session
//      broadcasten → Overlay rendert die Personalakte.
//
// GlobalVar API_HOST (z.B. http://192.168.178.34) — sonst Fallback unten.
// UserVars die NICHT vorhanden sein müssen werden mit 0 / leer behandelt.

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
        string avatar = ArgStr("userProfileImageUrl");
        bool   isSub  = ArgBool("isSubscribed");
        string tier   = ArgStr("subscriptionTier");        // "1000"/"2000"/"3000" o. leer
        int    subMon = ArgInt("cumulativeMonths", ArgInt("subscriptionMonths", 0));
        long   bits   = ArgLong("bits", 0);                // ggf. via UserVar unten ergänzt
        int    followDays = ArgInt("followAgeDays", 0);    // optional via Sub-Action befüllen

        // Bits-Gesamt bevorzugt aus persistenter UserVar (falls getrackt)
        long bitsVar = CPH.GetTwitchUserVar<long?>(login, "bitsTotal", true) ?? 0;
        if (bitsVar > bits) bits = bitsVar;

        // Hauling-Punkte + Rang (eigenes Chatgame)
        int haulPoints = CPH.GetTwitchUserVar<int?>(login, "haulPoints", true) ?? 0;
        string haulRank = HaulRank(haulPoints);

        // ── Payload an den Service ────────────────────────────
        var body = new JObject
        {
            ["login"]         = login,
            ["display"]       = display,
            ["avatar"]        = avatar,
            ["isSub"]         = isSub,
            ["subTier"]       = string.IsNullOrEmpty(tier) ? "1000" : tier,
            ["subMonths"]     = subMon,
            ["bitsTotal"]     = bits,
            ["followageDays"] = followDays,
            ["haulPoints"]    = haulPoints,
            ["haulRank"]      = haulPoints > 0 ? haulRank : "",
        };

        string host = CPH.GetGlobalVar<string>("API_HOST", false);
        if (string.IsNullOrEmpty(host)) host = "http://192.168.178.34";
        string url = host.TrimEnd('/') + "/alerts/api/profile";

        string respJson;
        try
        {
            using (var http = new System.Net.Http.HttpClient())
            {
                http.Timeout = System.TimeSpan.FromSeconds(6);
                var content = new System.Net.Http.StringContent(
                    body.ToString(), System.Text.Encoding.UTF8, "application/json");
                var resp = http.PostAsync(url, content).Result;
                respJson = resp.Content.ReadAsStringAsync().Result;
                if (!resp.IsSuccessStatusCode)
                {
                    CPH.LogWarn($"[CC Id] profile API {((int)resp.StatusCode)}: {respJson}");
                    return true;
                }
            }
        }
        catch (System.Exception ex)
        {
            CPH.LogWarn("[CC Id] profile API fehlgeschlagen: " + ex.Message);
            return true;
        }

        // ── An Overlay broadcasten ────────────────────────────
        string session = CPH.GetGlobalVar<string>("cc_alert_session", false);
        if (string.IsNullOrEmpty(session))
        {
            CPH.LogWarn("[CC Id] cc_alert_session nicht gesetzt – Overlay nicht registriert.");
            return true;
        }
        CPH.WebsocketCustomServerBroadcast(respJson, session, 0);
        CPH.LogInfo($"[CC Id] Steckbrief für {login} → Overlay");
        return true;
    }

    // ── Helfer: Args defensiv lesen ───────────────────────────
    string ArgStr(string key)
    {
        return (args.ContainsKey(key) && args[key] != null) ? args[key].ToString() : "";
    }
    bool ArgBool(string key)
    {
        if (!args.ContainsKey(key) || args[key] == null) return false;
        bool b; return bool.TryParse(args[key].ToString(), out b) && b;
    }
    int ArgInt(string key, int fallback)
    {
        if (!args.ContainsKey(key) || args[key] == null) return fallback;
        int n; return int.TryParse(args[key].ToString(), out n) ? n : fallback;
    }
    long ArgLong(string key, long fallback)
    {
        if (!args.ContainsKey(key) || args[key] == null) return fallback;
        long n; return long.TryParse(args[key].ToString(), out n) ? n : fallback;
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
