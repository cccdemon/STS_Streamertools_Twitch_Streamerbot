// Action: "GW – Leaderboard"
// Trigger: Core → Command → "!top"
// Permission: Everyone
// Cooldown: User: 30s, Global: 10s
//
// Queries the Stats service REST API and posts the top 3
// viewers (by total watchtime) into Twitch chat.
//
// Requires: API_HOST GlobalVar (set in CC_ApiRegister or hardcoded below)

public class CPHInline
{
    public bool Execute()
    {
        // ── Config ────────────────────────────────────────────
        // Change this to your server IP/hostname
        string apiHost = "192.168.178.34";
        string url = $"http://{apiHost}/stats/api/leaderboard?limit=3";

        // ── Fetch ─────────────────────────────────────────────
        string json;
        try
        {
            using var client = new System.Net.Http.HttpClient();
            client.Timeout = System.TimeSpan.FromSeconds(5);
            json = client.GetStringAsync(url).GetAwaiter().GetResult();
        }
        catch (System.Exception ex)
        {
            CPH.LogWarn($"[GW_Leaderboard] HTTP error: {ex.Message}");
            return true;
        }

        // ── Parse ─────────────────────────────────────────────
        var rows = Newtonsoft.Json.JsonConvert.DeserializeObject<
            System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object>>
        >(json);

        if (rows == null || rows.Count == 0)
        {
            CPH.SendMessage("Noch keine Leaderboard-Daten vorhanden.");
            return true;
        }

        // ── Format ────────────────────────────────────────────
        string FormatTime(long sec)
        {
            long h = sec / 3600;
            long m = (sec % 3600) / 60;
            return h > 0 ? $"{h}h {m}m" : $"{m}m";
        }

        var medals = new[] { "🥇", "🥈", "🥉" };
        var parts  = new System.Collections.Generic.List<string>();

        for (int i = 0; i < rows.Count; i++)
        {
            var row     = rows[i];
            string name = row.ContainsKey("display") ? row["display"]?.ToString() ?? "?" : "?";
            long   sec  = row.ContainsKey("total_watch_sec") ? System.Convert.ToInt64(row["total_watch_sec"] ?? 0) : 0;
            int    wins = row.ContainsKey("times_won")       ? System.Convert.ToInt32(row["times_won"]       ?? 0) : 0;

            string medal = i < medals.Length ? medals[i] + " " : $"{i + 1}. ";
            string entry = $"{medal}{name} ({FormatTime(sec)})";
            if (wins > 0) entry += $" [{wins}x gewonnen]";
            parts.Add(entry);
        }

        CPH.SendMessage("TOP CHAOS CREW: " + string.Join("  |  ", parts));
        return true;
    }
}
