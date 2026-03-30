// Action: "GW – WS Handler"
// Trigger: Core → WebSocket → Custom Server → Custom Server Message

using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    const int SECS_PER_TICKET = 7200;

    public bool Execute()
    {
        CPH.LogInfo("=== GW WS Handler fired ===");

        // ── Fight Command Trigger (Core → Commands → fight) ──
        // Wenn kein WS-Data vorhanden, prüfen ob es ein !fight Command ist
        if (!args.ContainsKey("data") || string.IsNullOrEmpty(args["data"]?.ToString()))
        {
            string attacker = args.ContainsKey("user") ? args["user"]?.ToString() ?? "" : "";
            string defender = args.ContainsKey("commandTarget") ? args["commandTarget"]?.ToString()?.TrimStart('@') ?? "" : "";

            if (!string.IsNullOrEmpty(attacker) && !string.IsNullOrEmpty(defender))
            {
                // Sanitieren
                var sba = new System.Text.StringBuilder();
                foreach (char ch in attacker)
                    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                        sba.Append(ch);
                attacker = sba.ToString();

                var sbd = new System.Text.StringBuilder();
                foreach (char ch in defender)
                    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                        sbd.Append(ch);
                defender = sbd.ToString();

                if (attacker.Length > 0 && defender.Length > 0 && attacker.ToLower() != defender.ToLower())
                {
                    string sfSession = CPH.GetGlobalVar<string>("gw_spacefight_session", false);
                    if (!string.IsNullOrEmpty(sfSession))
                    {
                        var payload = new JObject
                        {
                            ["event"]    = "fight_cmd",
                            ["attacker"] = attacker,
                            ["defender"] = defender,
                            ["ts"]       = DateTime.UtcNow.ToString("o")
                        };
                        CPH.WebsocketCustomServerBroadcast(payload.ToString(), sfSession, 0);
                        CPH.LogInfo($"[GW] fight_cmd: {attacker} vs {defender} → {sfSession}");
                    }
                }
            }
            return true;
        }

        string raw       = args["data"].ToString();
        string sessionId = args.ContainsKey("sessionId") ? args["sessionId"].ToString() : null;

        if (string.IsNullOrEmpty(sessionId)) { CPH.LogInfo("GW: keine sessionId"); return true; }

        CPH.LogInfo("GW raw: " + raw + " | sessionId: " + sessionId);

        if (!raw.Contains("gw_get_all") && !raw.Contains("gw_cmd") && !raw.Contains("gw_overlay") && !raw.Contains("gw_join_register") && !raw.Contains("gw_api_register") && !raw.Contains("spacefight_result") && !raw.Contains("chat_msg") && !raw.Contains("gw_spacefight_register") && !raw.Contains("sf_status_request") && !raw.Contains("spacefight_rejected") && !raw.Contains("spacefight_challenge"))
            return true;

        JObject msg;
        try { msg = JObject.Parse(raw); }
        catch { return true; }

        string evnt = msg["event"]?.ToString();

        // Overlay registriert sich – Session speichern
        if (evnt == "gw_overlay_register")
        {
            CPH.SetGlobalVar("gw_overlay_session", sessionId, false);
            CPH.LogInfo("GW: Overlay registriert, session=" + sessionId);
            return true;
        }

        if (evnt == "gw_join_register")
        {
            CPH.SetGlobalVar("gw_join_session", sessionId, false);
            CPH.LogInfo("GW: Join-Overlay registriert, session=" + sessionId);
            return true;
        }

        if (evnt == "gw_spacefight_register")
        {
            CPH.SetGlobalVar("gw_spacefight_session", sessionId, false);
            CPH.LogInfo("GW: Spacefight registriert, session=" + sessionId);
            // Sofort aktuellen Stream-Status zurücksenden
            bool isLive = CPH.GetGlobalVar<bool>("sf_stream_live", false);
            var statusMsg = new Newtonsoft.Json.Linq.JObject
            {
                ["event"]     = "sf_status",
                ["live"]      = isLive,
                ["streaming"] = isLive
            };
            CPH.WebsocketCustomServerBroadcast(statusMsg.ToString(), sessionId, 0);
            return true;
        }

        if (evnt == "sf_status_request")
        {
            bool isLive = CPH.GetGlobalVar<bool>("sf_stream_live", false);
            var statusMsg = new Newtonsoft.Json.Linq.JObject
            {
                ["event"]     = "sf_status",
                ["live"]      = isLive,
                ["streaming"] = isLive
            };
            CPH.WebsocketCustomServerBroadcast(statusMsg.ToString(), sessionId, 0);
            CPH.LogInfo("GW: sf_status gesendet, live=" + isLive);
            return true;
        }

        if (evnt == "gw_api_register")
        {
            CPH.SetGlobalVar("gw_api_session", sessionId, false);
            CPH.LogInfo("GW: API-Client registriert, session=" + sessionId);
            return true;
        }

        if (evnt == "gw_get_all")       return HandleGetAll(sessionId);
        if (evnt == "gw_cmd")           return HandleCommand(msg, sessionId);
        if (evnt == "gw_overlay")       return HandleOverlay(raw);
        if (evnt == "spacefight_result")   return HandleSpacefight(msg);
        if (evnt == "spacefight_rejected")  return HandleSpacefightRejected(msg);
        if (evnt == "spacefight_challenge") return HandleSpacefightChallenge(msg);
        if (evnt == "chat_msg")         return HandleChatRelay(msg, sessionId);

        return true;
    }

    private bool HandleGetAll(string sessionId)
    {
        string indexRaw = CPH.GetGlobalVar<string>("gw_index", true);
        var index = new List<string>();
        if (!string.IsNullOrEmpty(indexRaw))
            try { index = JsonConvert.DeserializeObject<List<string>>(indexRaw); } catch { }

        var participants = new List<object>();
        foreach (var userKey in index)
        {
            string uRaw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
            if (string.IsNullOrEmpty(uRaw)) continue;
            try
            {
                var p = JsonConvert.DeserializeObject<Dictionary<string, object>>(uRaw);
                p["key"] = userKey;
                // tickets als double mit InvariantCulture parsen
                if (p.ContainsKey("tickets"))
                    p["tickets"] = GetDbl(p, "tickets");
                participants.Add(p);
            }
            catch { }
        }

        string gwOpen = CPH.GetGlobalVar<string>("gw_open", true);

        var response = new Dictionary<string, object>();
        response["event"]        = "gw_data";
        response["open"]         = (gwOpen == "true");
        response["participants"] = participants;

        string json = JsonConvert.SerializeObject(response);
        // An anfragenden Client senden
        CPH.WebsocketCustomServerBroadcast(json, sessionId, 0);
        // Auch an API-Session senden falls vorhanden und verschieden
        string apiSession = CPH.GetGlobalVar<string>("gw_api_session", false);
        if (!string.IsNullOrEmpty(apiSession) && apiSession != sessionId)
            CPH.WebsocketCustomServerBroadcast(json, apiSession, 0);
        CPH.LogInfo("GW: gw_data gesendet an " + sessionId + " (+" + (apiSession != sessionId ? "API" : "") + "), " + participants.Count + " Teilnehmer");
        return true;
    }

    private bool HandleCommand(JObject msg, string sessionId)
    {
        string cmd  = msg["cmd"]?.ToString();
        // Username aus WS-Payload sanitieren: nur alphanumerisch + Unterstrich
        string rawUser = msg["user"]?.ToString() ?? "";
        var sbUser = new System.Text.StringBuilder();
        foreach (char ch in rawUser.Trim().ToLower())
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_')
                sbUser.Append(ch);
        string user = sbUser.ToString();
        if (user.Length > 25) user = user.Substring(0, 25);
        if (user.Length == 0) user = null;
        CPH.LogInfo("GW cmd: " + cmd + " user: " + user);

        var ack = new Dictionary<string, object>();

        switch (cmd)
        {
            case "gw_open":
                CPH.SetGlobalVar("gw_open", "true", true);
                var r1 = new Dictionary<string, object>();
                r1["event"]  = "gw_status";
                r1["status"] = "open";
                BroadcastToAll(JsonConvert.SerializeObject(r1), sessionId);
                break;

            case "gw_close":
                CPH.SetGlobalVar("gw_open", "false", true);
                var r2 = new Dictionary<string, object>();
                r2["event"]  = "gw_status";
                r2["status"] = "closed";
                BroadcastToAll(JsonConvert.SerializeObject(r2), sessionId);
                break;

            case "gw_add_ticket":
                if (!string.IsNullOrEmpty(user))
                {
                    try
                    {
                        var p = LoadUser(user);
                        CPH.LogInfo("GW add_ticket: raw tickets=" + p["tickets"] + " type=" + (p["tickets"]?.GetType()?.Name ?? "null"));
                        double curTickets = GetDbl(p, "tickets");
                        int curWatch = GetInt(p, "watchSec");
                        CPH.LogInfo("GW add_ticket: curTickets=" + curTickets + " curWatch=" + curWatch);
                        int newWatch = Math.Max(curWatch, (int)((curTickets + 1.0) * SECS_PER_TICKET));
                        double newTickets = newWatch / (double)SECS_PER_TICKET;
                        CPH.LogInfo("GW add_ticket: newWatch=" + newWatch + " newTickets=" + newTickets);
                        SetInt(p, "watchSec", newWatch);
                        SetDbl(p, "tickets", newTickets);
                        SaveUser(user, p);
                        AddToIndex(user);
                        CPH.LogInfo("GW add_ticket: saved tickets=" + p["tickets"]);
                        ack["event"] = "gw_ack"; ack["type"] = "ticket_added"; ack["user"] = user;
                        CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(ack), sessionId, 0);
                    }
                    catch (Exception ex)
                    {
                        CPH.LogInfo("GW add_ticket ERROR: " + ex.Message + " | " + ex.StackTrace);
                    }
                }
                break;

            case "gw_sub_ticket":
                if (!string.IsNullOrEmpty(user))
                {
                    var p = LoadUser(user);
                    double newT = Math.Max(0.0, GetDbl(p, "tickets") - 1.0);
                    SetDbl(p, "tickets", newT);
                    SetInt(p, "watchSec", (int)(newT * SECS_PER_TICKET));
                    ack["event"] = "gw_ack"; ack["type"] = "ticket_removed"; ack["user"] = user;
                    CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(ack), sessionId, 0);
                }
                break;

            case "gw_ban":
                if (!string.IsNullOrEmpty(user))
                {
                    var p = LoadUser(user);
                    p["banned"] = true;
                    SaveUser(user, p);
                    ack["event"] = "gw_ack"; ack["type"] = "banned"; ack["user"] = user;
                    CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(ack), sessionId, 0);
                }
                break;

            case "gw_unban":
                if (!string.IsNullOrEmpty(user))
                {
                    var p = LoadUser(user);
                    p["banned"] = false;
                    SaveUser(user, p);
                    ack["event"] = "gw_ack"; ack["type"] = "unbanned"; ack["user"] = user;
                    CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(ack), sessionId, 0);
                }
                break;

            case "gw_set_keyword":
                string kw = msg["keyword"]?.ToString() ?? "";
                CPH.SetGlobalVar("gw_keyword", kw, true);
                ack["event"] = "gw_ack"; ack["type"] = "keyword_set"; ack["keyword"] = kw;
                CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(ack), sessionId, 0);
                break;

            case "gw_get_keyword":
                string kwCurrent = CPH.GetGlobalVar<string>("gw_keyword", true) ?? "";
                var kwResp = new Dictionary<string, object>();
                kwResp["event"]   = "gw_keyword";
                kwResp["keyword"] = kwCurrent;
                CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(kwResp), sessionId, 0);
                break;

            case "gw_reset":
                string indexRaw = CPH.GetGlobalVar<string>("gw_index", true);
                if (!string.IsNullOrEmpty(indexRaw))
                    try
                    {
                        var idx = JsonConvert.DeserializeObject<List<string>>(indexRaw);
                        foreach (var u in idx)
                            CPH.UnsetGlobalVar("gw_u_" + u, true);
                    }
                    catch { }
                CPH.UnsetGlobalVar("gw_index", true);
                CPH.SetGlobalVar("gw_open", "false", true);
                ack["event"] = "gw_ack"; ack["type"] = "reset"; ack["user"] = "all";
                CPH.WebsocketCustomServerBroadcast(JsonConvert.SerializeObject(ack), sessionId, 0);
                break;
        }

        return true;
    }

    private Dictionary<string, object> LoadUser(string userKey)
    {
        string raw = CPH.GetGlobalVar<string>("gw_u_" + userKey, true);
        if (!string.IsNullOrEmpty(raw))
            try { return JsonConvert.DeserializeObject<Dictionary<string, object>>(raw); } catch { }
        return new Dictionary<string, object>
        {
            { "display",  userKey },
            { "watchSec", 0 },
            { "msgs",     0 },
            { "tickets",  0.0 },
            { "banned",   false }
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

    // Overlay-Broadcast: Admin-Panel → alle Clients (inkl. OBS Overlay)
    private bool HandleOverlay(string raw)
    {
        // sessionId des Senders kennen wir – an ALLE anderen senden
        // Wir iterieren nicht, sondern senden einfach an alle Sessions
        // indem wir die eigene sessionId weglassen und null übergeben
        // Streamerbot 1.0.4: null = kein Ziel → kein Send
        // Workaround: wir speichern alle bekannten Sessions nicht
        // → Admin-Panel und Overlay verbinden sich beide →
        //   Admin sendet gw_overlay → SB empfängt → broadcastet zurück an alle Sessions
        // Da wir sessionId des Overlays nicht kennen, nutzen wir einen Trick:
        // Wir speichern die letzte bekannte Overlay-SessionId als Global Var
        string overlaySession = CPH.GetGlobalVar<string>("gw_overlay_session", false);
        if (!string.IsNullOrEmpty(overlaySession))
            CPH.WebsocketCustomServerBroadcast(raw, overlaySession, 0);
        return true;
    }

    private bool HandleSpacefight(JObject msg)
    {
        string winner = msg["winner"]?.ToString() ?? "";
        string loser  = msg["loser"]?.ToString()  ?? "";
        string shipW  = msg["ship_w"]?.ToString()  ?? "";
        string shipL  = msg["ship_l"]?.ToString()  ?? "";
        if (string.IsNullOrEmpty(winner)) return true;
        string chatMsg = $"[SF] {winner.ToUpper()} ({shipW}) besiegt {loser.ToUpper()} ({shipL})! GG o7";
        CPH.SendMessage(chatMsg, true);
        return true;
    }

    private bool HandleSpacefightRejected(JObject msg)
    {
        string reason   = msg["reason"]?.ToString()   ?? "";
        string attacker = msg["attacker"]?.ToString() ?? "";
        string defender = msg["defender"]?.ToString() ?? "";
        if (string.IsNullOrEmpty(attacker)) return true;

        var rng = new Random();
        if (reason == "stream_offline")
        {
            string[] lines = {
                $"@{attacker} Kein Treibstoff, keine Munition - der Hangar ist offline. Kaempfe nur wenn wir live sind!",
                $"@{attacker} Schiffe bleiben geerdet. Kaempfe gibt es nur wenn der Stream laeuft!",
                $"@{attacker} Munitionslager gesperrt - komm wieder wenn wir live sind. o7",
                $"@{attacker} Keine aktive Streammission. Kaempfe erst wenn wir fliegen!",
            };
            CPH.SendMessage(lines[rng.Next(lines.Length)], true);
        }
        else if (reason == "not_in_chat")
        {
            string[] lines = {
                $"@{attacker} {defender} ist nicht im Chat aktiv - kein Ziel, kein Kampf!",
                $"@{attacker} {defender} reagiert nicht auf Funk. Ziel muss im Chat sein!",
                $"@{attacker} Kein Kontakt zu {defender}. Ziel ist nicht in Reichweite!",
            };
            CPH.SendMessage(lines[rng.Next(lines.Length)], true);
        }
        CPH.LogInfo($"[SF Rejected] reason={reason}, attacker={attacker}, defender={defender}");
        return true;
    }

    private bool HandleSpacefightChallenge(JObject msg)
    {
        // Wird direkt vom Spacefight_Handler verarbeitet
        // GW WS Handler leitet es nur weiter
        return true;
    }

    private bool HandleChatRelay(JObject msg, string sessionId)
    {
        // Chat-Nachrichten vom Overlay an Join-Animation und Spacefight weiterleiten
        string joinSession = CPH.GetGlobalVar<string>("gw_join_session", false);
        if (!string.IsNullOrEmpty(joinSession))
            CPH.WebsocketCustomServerBroadcast(msg.ToString(), joinSession, 0);
        string sfSession = CPH.GetGlobalVar<string>("gw_spacefight_session", false);
        if (!string.IsNullOrEmpty(sfSession))
            CPH.WebsocketCustomServerBroadcast(msg.ToString(), sfSession, 0);
        return true;
    }

    // Sendet an anfragenden Client UND API-Session
    private void BroadcastToAll(string json, string sessionId)
    {
        CPH.WebsocketCustomServerBroadcast(json, sessionId, 0);
        string apiSession = CPH.GetGlobalVar<string>("gw_api_session", false);
        if (!string.IsNullOrEmpty(apiSession) && apiSession != sessionId)
            CPH.WebsocketCustomServerBroadcast(json, apiSession, 0);
    }

    private int GetInt(Dictionary<string, object> d, string key)
    {
        if (d.ContainsKey(key) && d[key] != null)
            return Convert.ToInt32(d[key]);
        return 0;
    }

    private double GetDbl(Dictionary<string, object> d, string key)
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

    private void SetInt(Dictionary<string, object> d, string key, int val)
    {
        d[key] = val;
    }

    private void SetDbl(Dictionary<string, object> d, string key, double val)
    {
        // Als String mit Dezimalpunkt speichern damit Newtonsoft nicht als int serialisiert
        // Beim Lesen via GetDbl wird Convert.ToDouble den String korrekt parsen
        d[key] = Math.Round(val, 4).ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
    }
}
