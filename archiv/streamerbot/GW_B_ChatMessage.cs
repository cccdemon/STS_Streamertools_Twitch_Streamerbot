// Action: "GW – Chat Message"
// Trigger: Twitch → Chat Message (alle)

using System;
using System.Collections.Generic;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly string[] BOTS = {
        "streamelements","nightbot","moobot","fossabot",
        "wizebot","botrixoficial","commanderroot"
    };

    const int COOLDOWN_SECS   = 10;   // min. 10s Abstand zwischen zählenden Nachrichten
    const int MIN_WORDS       = 5;    // min. 5 Wörter
    const int SECS_PER_MSG    = 5;    // +5s Watchtime pro qualifizierender Nachricht
    const int SECS_PER_TICKET = 7200; // 2h = 1 Coin/Ticket

    public bool Execute()
    {
        if (!CPH.ObsIsStreaming(0)) return true;

        string gwOpen = CPH.GetGlobalVar<string>("gw_open", true);
        if (gwOpen != "true") return true;

        string user = GetUser();
        if (string.IsNullOrEmpty(user)) return true;
        if (IsBot(user)) return true;

        string userKey = user.ToLower();

        // Nachricht lesen + bereinigen
        string message = "";
        if (args.ContainsKey("message") && args["message"] != null)
        {
            message = args["message"].ToString().Trim();
            var _sb = new System.Text.StringBuilder();
            foreach (char _ch in message)
                if (_ch >= ' ' && _ch != '\x7f') _sb.Append(_ch);
            message = _sb.ToString();
            if (message.Length > 500) message = message.Substring(0, 500);
        }

        // ── Keyword-Check: Teilnahme registrieren ─────────────
        string keyword = CPH.GetGlobalVar<string>("gw_keyword", true);
        if (!string.IsNullOrEmpty(keyword))
        {
            if (message.Equals(keyword, StringComparison.OrdinalIgnoreCase))
            {
                var pJoin = LoadUser(userKey);
                if (!(bool)pJoin["banned"])
                {
                    pJoin["display"] = user;
                    bool isNew = !IsRegistered(userKey);
                    SetBool(pJoin, "registered", true);
                    SaveUser(userKey, pJoin);
                    AddToIndex(userKey);
                    if (isNew)
                    {
                        CPH.SendMessage($"@{user} du hast dich erfolgreich gemeldet! Viel Glueck! o7", true);
                        var joinMsg = new Dictionary<string, object>
                        {
                            ["event"] = "gw_join",
                            ["user"]  = user
                        };
                        string joinSession = CPH.GetGlobalVar<string>("gw_join_session", false);
                        if (!string.IsNullOrEmpty(joinSession))
                            CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(joinMsg), joinSession, 0);
                    }
                }
                return true;
            }

            // Watchtime/Chat-Bonus nur für registrierte Teilnehmer
            if (!IsRegistered(userKey)) return true;
        }

        // ── Spamschutz 1: Mindestens 5 Wörter ────────────────
        int wordCount = 0;
        bool inWord = false;
        foreach (char ch in message)
        {
            if (ch == ' ' || ch == '\t') { inWord = false; }
            else if (!inWord) { inWord = true; wordCount++; }
        }
        if (wordCount < MIN_WORDS) return true;

        // ── Spamschutz 2: Cooldown 10s ────────────────────────
        string lastTimeKey = "gw_lasttime_" + userKey;
        string lastTimeRaw = CPH.GetGlobalVar<string>(lastTimeKey, false);
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (!string.IsNullOrEmpty(lastTimeRaw))
        {
            long lastTime;
            if (long.TryParse(lastTimeRaw, out lastTime))
                if ((now - lastTime) < COOLDOWN_SECS) return true;
        }
        CPH.SetGlobalVar(lastTimeKey, now.ToString(), false);

        // ── Spamschutz 3: Duplikat ────────────────────────────
        string lastMsgKey = "gw_lastmsg_" + userKey;
        string lastMsg    = CPH.GetGlobalVar<string>(lastMsgKey, false);
        if (!string.IsNullOrEmpty(lastMsg) && lastMsg == message) return true;
        CPH.SetGlobalVar(lastMsgKey, message, false);

        // ── +5 Sekunden Chat-Bonus auf watchSec ───────────────
        var p = LoadUser(userKey);
        if ((bool)p["banned"]) return true;

        int currentWatch = GetInt(p, "watchSec");
        int msgCount     = GetInt(p, "msgs");

        SetInt(p, "msgs",     msgCount + 1);
        SetInt(p, "watchSec", currentWatch + SECS_PER_MSG);

        // Coins = kumulierte watchSec / 7200 (Dezimalwert)
        double tickets = (currentWatch + SECS_PER_MSG) / (double)SECS_PER_TICKET;
        SetDouble(p, "tickets", tickets);

        SaveUser(userKey, p);
        return true;
    }

    // ── Helpers ──────────────────────────────────────────────
    private bool IsRegistered(string userKey)
    {
        string raw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
        if (string.IsNullOrEmpty(raw)) return false;
        try
        {
            var d = JsonConvert.DeserializeObject<Dictionary<string, object>>(raw);
            return d.ContainsKey("registered") && d["registered"] != null && Convert.ToBoolean(d["registered"]);
        }
        catch { return false; }
    }

    private string GetUser()
    {
        string raw = null;
        if (args.ContainsKey("userName") && args["userName"] != null) raw = args["userName"].ToString();
        else if (args.ContainsKey("user") && args["user"] != null) raw = args["user"].ToString();
        if (string.IsNullOrEmpty(raw)) return null;
        var _sb = new System.Text.StringBuilder();
        foreach (char _ch in raw.Trim())
            if ((_ch >= 'a' && _ch <= 'z') || (_ch >= 'A' && _ch <= 'Z') || (_ch >= '0' && _ch <= '9') || _ch == '_')
                _sb.Append(_ch);
        string clean = _sb.ToString();
        return clean.Length > 0 && clean.Length <= 25 ? clean : null;
    }

    private bool IsBot(string user)
    {
        string u = user.ToLower();
        foreach (var b in BOTS) if (u == b) return true;
        return false;
    }

    private Dictionary<string, object> LoadUser(string userKey)
    {
        string raw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
        if (!string.IsNullOrEmpty(raw))
            try { return JsonConvert.DeserializeObject<Dictionary<string, object>>(raw); } catch { }
        return new Dictionary<string, object>
        {
            { "display",    userKey },
            { "watchSec",   0 },
            { "msgs",       0 },
            { "tickets",    "0.0000" },
            { "banned",     false },
            { "registered", false }
        };
    }

    private void SaveUser(string userKey, Dictionary<string, object> data)
    {
        CPH.SetGlobalVar("gw_u_" + userKey, JsonConvert.SerializeObject(data), true);
    }

    private void AddToIndex(string userKey)
    {
        string raw = CPH.GetGlobalVar<string>("gw_index", true);
        var index = new List<string>();
        if (!string.IsNullOrEmpty(raw))
            try { index = JsonConvert.DeserializeObject<List<string>>(raw); } catch { }
        if (!index.Contains(userKey))
        {
            index.Add(userKey);
            CPH.SetGlobalVar("gw_index", JsonConvert.SerializeObject(index), true);
        }
    }

    private int GetInt(Dictionary<string, object> d, string key)
    {
        if (d.ContainsKey(key) && d[key] != null) return Convert.ToInt32(d[key]);
        return 0;
    }

    private void SetInt(Dictionary<string, object> d, string key, int val) { d[key] = val; }

    private void SetDouble(Dictionary<string, object> d, string key, double val)
    {
        d[key] = Math.Round(val, 4).ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
    }

    private void SetBool(Dictionary<string, object> d, string key, bool val) { d[key] = val; }
}
