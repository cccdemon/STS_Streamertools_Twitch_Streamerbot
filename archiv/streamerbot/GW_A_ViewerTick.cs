// Action: "GW – Viewer Tick"
// Trigger: Present Viewer

using System;
using System.Collections.Generic;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly string[] BOTS = {
        "streamelements","nightbot","moobot","fossabot",
        "wizebot","botrixoficial","commanderroot"
    };

    const int SECS_PER_TICKET = 7200; // 2h = 1 Ticket

    public bool Execute()
    {
        if (!CPH.ObsIsStreaming(0)) return true;

        string gwOpen = CPH.GetGlobalVar<string>("gw_open", true);
        if (gwOpen != "true") return true;

        string user = GetUser();
        if (string.IsNullOrEmpty(user)) return true;
        if (IsBot(user)) return true;

        string userKey = user.ToLower();

        // ── Nur registrierte Teilnehmer bekommen Watchtime ────
        if (!IsRegistered(userKey)) return true;

        var p = LoadUser(userKey);
        if ((bool)p["banned"]) return true;

        // +60 Sekunden Watchtime pro Tick
        SetInt(p, "watchSec", GetInt(p, "watchSec") + 60);

        // Tickets als Dezimalwert: 1h = 0.5, 2h = 1.0
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
        string raw = null;
        if (args.ContainsKey("userName") && args["userName"] != null)
            raw = args["userName"].ToString();
        else if (args.ContainsKey("user") && args["user"] != null)
            raw = args["user"].ToString();
        if (string.IsNullOrEmpty(raw)) return null;
        var clean = new System.Func<string>(() => { var _sb = new System.Text.StringBuilder(); foreach (char _ch in raw.Trim()) if ((_ch >= 'a' && _ch <= 'z') || (_ch >= 'A' && _ch <= 'Z') || (_ch >= '0' && _ch <= '9') || _ch == '_') _sb.Append(_ch); return _sb.ToString(); })();
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
            { "tickets",    0.0 },
            { "banned",     false },
            { "registered", false }
        };
    }

    private void SaveUser(string userKey, Dictionary<string, object> data)
    {
        CPH.SetGlobalVar("gw_u_" + userKey, JsonConvert.SerializeObject(data), true);
        AddToIndex(userKey);
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
}
