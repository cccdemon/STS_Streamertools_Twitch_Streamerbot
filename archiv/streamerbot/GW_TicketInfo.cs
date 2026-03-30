// Action: "GW – Ticket Info"
// Trigger: Core → Command → "coin" (Prefix: !)
//
// Antwortet im Chat: "@User du hast X.XX Tickets (Xh Xm Watchtime)"

using System;
using System.Collections.Generic;
using Newtonsoft.Json;

public class CPHInline
{
    const int SECS_PER_TICKET = 7200;

    public bool Execute()
    {
        string user = "";
        if (args.ContainsKey("user") && args["user"] != null)
            user = args["user"].ToString().Trim();
        else if (args.ContainsKey("userName") && args["userName"] != null)
            user = args["userName"].ToString().Trim();

        if (string.IsNullOrEmpty(user)) return true;
        string userKey = user.ToLower();

        string raw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
        if (string.IsNullOrEmpty(raw))
        {
            CPH.SendMessage($"@{user} Du bist noch nicht im Giveaway registriert. Schreib das Keyword im Chat um teilzunehmen!", true);
            return true;
        }

        Dictionary<string, object> p;
        try { p = JsonConvert.DeserializeObject<Dictionary<string, object>>(raw); }
        catch { return true; }

        // Tickets lesen (InvariantCulture)
        double tickets = 0;
        if (p.ContainsKey("tickets") && p["tickets"] != null)
        {
            var tv = p["tickets"];
            if (tv is string s)
                double.TryParse(s, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out tickets);
            else
                tickets = Convert.ToDouble(tv, System.Globalization.CultureInfo.InvariantCulture);
        }

        // Watchtime lesen
        int watchSec = 0;
        if (p.ContainsKey("watchSec") && p["watchSec"] != null)
            watchSec = Convert.ToInt32(p["watchSec"]);

        int hours   = watchSec / 3600;
        int minutes = (watchSec % 3600) / 60;

        // Nächstes volles Ticket berechnen
        double nextFull = Math.Ceiling(tickets);
        if (nextFull <= tickets) nextFull = tickets + 1;
        int secsToNext = (int)((nextFull - tickets) * SECS_PER_TICKET);
        int minsToNext = secsToNext / 60;

        bool isOpen = CPH.GetGlobalVar<string>("gw_open", true) == "true";

        string ticketStr = tickets.ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
        string timeStr = hours > 0 ? $"{hours}h {minutes}m" : $"{minutes}m";
        string nextStr = minsToNext > 60 ? $"{minsToNext/60}h {minsToNext%60}m" : $"{minsToNext}m";

        string msg;
        if (!isOpen)
            msg = $"@{user} Du hast {ticketStr} Tickets ({timeStr} Watchtime). Kein Giveaway aktiv.";
        else if (tickets < 0.01)
            msg = $"@{user} Du hast noch keine Tickets. Bleib dabei - nach 2h hast du 1 Ticket!";
        else
            msg = $"@{user} Du hast {ticketStr} Tickets ({timeStr} Watchtime). Naechstes volles Ticket in ca. {nextStr}.";

        CPH.SendMessage(msg, true);
        CPH.LogInfo($"[GW Tickets] {user}: {ticketStr}T, {watchSec}s");
        return true;
    }
}
