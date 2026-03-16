// Action: "GW – Chat Message"
// Trigger: Twitch → Chat Message

using System;
using System.Collections.Generic;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly string[] BOTS = {
        "streamelements","nightbot","moobot","fossabot",
        "wizebot","botrixoficial","commanderroot"
    };

    const int    COOLDOWN_SECS   = 10;   // max 1 Msg pro 10s zählt
    const int    MIN_LENGTH      = 3;    // Mindestlänge
    const int    SECS_PER_MSG    = 5;    // +5s Watchtime pro Nachricht
    const int    SECS_PER_TICKET = 7200; // 2h = 1 Ticket

    public bool Execute()
    {
        if (!CPH.ObsIsStreaming(0)) return true;

        string gwOpen = CPH.GetGlobalVar<string>("gw_open", true);
        if (gwOpen != "true") return true;

        string user = GetUser();
        if (string.IsNullOrEmpty(user)) return true;
        if (IsBot(user)) return true;

        string userKey = user.ToLower();

        string message = "";
        if (args.ContainsKey("message") && args["message"] != null)
            message = args["message"].ToString().Trim();

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
                        CPH.SendMessage($"@{user} du hast dich erfolgreich freiwillig gemeldet! 🎟️", true);
                        var joinMsg = new System.Collections.Generic.Dictionary<string, object>();
                        joinMsg["event"] = "gw_join";
                        joinMsg["user"]  = user;
                        string joinSession = CPH.GetGlobalVar<string>("gw_join_session", false);
                        if (!string.IsNullOrEmpty(joinSession))
                            CPH.WebsocketCustomServerBroadcast(Newtonsoft.Json.JsonConvert.SerializeObject(joinMsg), joinSession, 0);
                    }
                }
                return true;
            }

            // Watchtime/Msgs nur für registrierte Teilnehmer
            if (!IsRegistered(userKey)) return true;
        }

        // ── Spamschutz 1: Mindestlänge ────────────────────────
        if (message.Length < MIN_LENGTH) return true;

        // ── Spamschutz 2: Duplikat ────────────────────────────
        string lastMsgKey = "gw_lastmsg_" + userKey;
        string lastMsg    = CPH.GetGlobalVar<string>(lastMsgKey, false);
        if (!string.IsNullOrEmpty(lastMsg) && lastMsg == message) return true;
        CPH.SetGlobalVar(lastMsgKey, message, false);

        // ── Spamschutz 3: Cooldown 10s ────────────────────────
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

        // ── +5 Sekunden Watchtime pro Nachricht ───────────────
        var p = LoadUser(userKey);
        if ((bool)p["banned"]) return true;

        SetInt(p, "msgs",     GetInt(p, "msgs") + 1);
        SetInt(p, "watchSec", GetInt(p, "watchSec") + SECS_PER_MSG);

        // Tickets als Dezimalwert aus Watchtime berechnen
        double tickets = GetInt(p, "watchSec") / (double)SECS_PER_TICKET;
        SetDouble(p, "tickets", tickets);

        SaveUser(userKey, p);
        return true;
    }

    private bool IsRegistered(string userKey)
    {
        string raw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
        if (string.IsNullOrEmpty(raw)) return false;
        try
        {
            var d = JsonConvert.DeserializeObject<Dictionary<string, object>>(raw);
            if (d.ContainsKey("registered") && d["registered"] != null)
                return Convert.ToBoolean(d["registered"]);
        }
        catch { }
        return false;
    }

    private string GetUser()
    {
        if (args.ContainsKey("userName") && args["userName"] != null)
            return args["userName"].ToString();
        if (args.ContainsKey("user") && args["user"] != null)
            return args["user"].ToString();
        return null;
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
            { "tickets",    0.0 },
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
        var index  = new List<string>();
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

    private double GetDouble(Dictionary<string, object> d, string key)
    {
        if (d.ContainsKey(key) && d[key] != null)
        {
            var val = d[key];
            if (val is string s)
                return double.Parse(s, System.Globalization.CultureInfo.InvariantCulture);
            return Convert.ToDouble(val, System.Globalization.CultureInfo.InvariantCulture);
        }
        return 0.0;
    }

    private void SetDouble(Dictionary<string, object> d, string key, double val)
    {
        d[key] = Math.Round(val, 4).ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
    }

    private void SetBool(Dictionary<string, object> d, string key, bool val) { d[key] = val; }
}
