// Action: "GW – Time Info"
// Trigger: Core → Command → "time" (Prefix: !)
//
// Zeigt dem Viewer seine aktuelle kumulierte Watchtime + Coins im Chat.

using System;
using System.Collections.Generic;
using Newtonsoft.Json;

public class CPHInline
{
    const int SECS_PER_TICKET = 7200; // 2h = 1 Coin

    public bool Execute()
    {
        string user = "";
        if (args.ContainsKey("user") && args["user"] != null)
            user = args["user"].ToString().Trim();
        else if (args.ContainsKey("userName") && args["userName"] != null)
            user = args["userName"].ToString().Trim();

        if (string.IsNullOrEmpty(user)) return true;
        string userKey = user.ToLower();

        bool gwOpen = CPH.GetGlobalVar<string>("gw_open", true) == "true";
        if (!gwOpen)
        {
            CPH.SendMessage($"@{user} Kein Giveaway aktiv.", true);
            return true;
        }

        string raw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
        if (string.IsNullOrEmpty(raw))
        {
            CPH.SendMessage($"@{user} Du bist noch nicht registriert. Schreib das Keyword um teilzunehmen!", true);
            return true;
        }

        Dictionary<string, object> p;
        try { p = JsonConvert.DeserializeObject<Dictionary<string, object>>(raw); }
        catch { return true; }

        // Watchtime lesen
        int watchSec = 0;
        if (p.ContainsKey("watchSec") && p["watchSec"] != null)
            watchSec = Convert.ToInt32(p["watchSec"]);

        // Coins (Dezimal)
        double coins = watchSec / (double)SECS_PER_TICKET;

        // Watchtime formatieren
        int h = watchSec / 3600;
        int m = (watchSec % 3600) / 60;
        int s = watchSec % 60;
        string timeStr;
        if (h > 0) timeStr = $"{h}h {m}m";
        else if (m > 0) timeStr = $"{m}m {s}s";
        else timeStr = $"{s}s";

        // Nächstes volles Coin
        double nextFull = Math.Floor(coins) + 1.0;
        int secsToNext = (int)((nextFull - coins) * SECS_PER_TICKET);
        int minsToNext = secsToNext / 60;
        string nextStr = minsToNext >= 60 ? $"{minsToNext/60}h {minsToNext%60}m" : $"{minsToNext}m";

        string coinsStr = coins.ToString("F2", System.Globalization.CultureInfo.InvariantCulture);

        string msg;
        if (watchSec == 0)
            msg = $"@{user} Du hast noch keine Watchtime. Bleib dabei!";
        else
            msg = $"@{user} Watchtime: {timeStr} | Coins: {coinsStr} | Naechstes Coin in ca. {nextStr}";

        CPH.SendMessage(msg, true);
        CPH.LogInfo($"[GW Time] {user}: {watchSec}s → {coinsStr} Coins");
        return true;
    }
}
