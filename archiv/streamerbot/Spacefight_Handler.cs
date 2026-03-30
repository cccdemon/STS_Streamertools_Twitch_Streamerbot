// Action: "Spacefight – Result Handler"
// Trigger: WebSocket Server → Custom Server Message
//          Filter: Message enthält "spacefight_result"
//
// WICHTIG: Nur EINEN Trigger in Streamerbot konfigurieren.
// Deduplication via GlobalVar verhindert Doppel-Posts wenn
// das Event mehrfach durch den WS-Bus durchläuft.

using System;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string raw = null;
        if (args.ContainsKey("data")) raw = args["data"].ToString();
        if (string.IsNullOrEmpty(raw)) return true;
        if (!raw.Contains("spacefight_result")) return true;

        JObject msg;
        try { msg = JObject.Parse(raw); }
        catch { return true; }

        string evtType = msg["event"]?.ToString() ?? "";

        // ── Rejection Handler ──────────────────────────────
        if (evtType == "spacefight_rejected")
        {
            string reason   = msg["reason"]?.ToString() ?? "";
            string attacker = msg["attacker"]?.ToString() ?? "";
            var rng = new Random();

            if (reason == "stream_offline")
            {
                string[] offline = {
                    $"@{attacker} Kein Treibstoff, keine Munition – der Hangar ist offline. Kämpfe nur während des Streams!",
                    $"@{attacker} Schiffe bleiben geerdet. Kämpfe gibt es nur wenn der Stream läuft!",
                    $"@{attacker} Munitionslager gesperrt – komm wieder wenn wir live sind. o7",
                    $"@{attacker} Keine aktive Streammission. Kämpfe erst wenn wir fliegen!",
                };
                CPH.SendMessage(offline[rng.Next(offline.Length)], true);
            }
            else if (reason == "not_in_chat")
            {
                string defender = msg["defender"]?.ToString() ?? "";
                string[] nothere = {
                    $"@{attacker} {defender} ist nicht im Chat aktiv – kein Ziel, kein Kampf!",
                    $"@{attacker} {defender} reagiert nicht auf Funk. Ziel muss im Chat sein!",
                    $"@{attacker} Kein Kontakt zu {defender}. Ziel ist nicht in Reichweite!",
                };
                CPH.SendMessage(nothere[rng.Next(nothere.Length)], true);
            }
            else if (reason == "challenge_declined")
            {
                string defender = msg["defender"]?.ToString() ?? "";
                string[] declined = {
                    $"@{attacker} {defender} lehnt das Duell ab. Feige! o7",
                    $"@{attacker} {defender} hat den Kampf verweigert. Kein Duell heute.",
                    $"@{attacker} {defender} weicht aus – kein Interesse am Kampf!",
                };
                CPH.SendMessage(declined[rng.Next(declined.Length)], true);
            }
            else if (reason == "challenge_timeout")
            {
                string defender = msg["defender"]?.ToString() ?? "";
                CPH.SendMessage($"@{attacker} {defender} hat nicht reagiert – Duell abgebrochen. o7", true);
            }
            return true;
        }

        if (evtType == "spacefight_challenge")
        {
            string attacker = msg["attacker"]?.ToString() ?? "";
            string defender = msg["defender"]?.ToString() ?? "";
            if (string.IsNullOrEmpty(attacker) || string.IsNullOrEmpty(defender)) return true;
            CPH.SendMessage($"@{defender}, du wirst von @{attacker} zu einem Duell herausgefordert! Willst du den Kampf annehmen (!ja) oder fliehen (!nein)? Du hast 30 Sekunden. o7", true);
            CPH.LogInfo($"[Spacefight] Challenge: {attacker} → {defender}");
            return true;
        }

        if (evtType != "spacefight_result") return true;

        string winner = msg["winner"]?.ToString() ?? "";
        string loser  = msg["loser"]?.ToString()  ?? "";
        string shipW  = msg["ship_w"]?.ToString()  ?? "";
        string shipL  = msg["ship_l"]?.ToString()  ?? "";
        string ts     = msg["ts"]?.ToString()      ?? "";

        if (string.IsNullOrEmpty(winner)) return true;

        // ── Deduplication ──────────────────────────────────
        // Gleicher Kampf (winner+loser+ts) darf nur 1x in Chat
        string dedupKey = $"sf_last_{winner.ToLower()}_{loser.ToLower()}";
        string lastTs   = CPH.GetGlobalVar<string>(dedupKey, false) ?? "";
        if (!string.IsNullOrEmpty(ts) && ts == lastTs)
        {
            CPH.LogInfo($"[Spacefight] Duplikat ignoriert: {winner} vs {loser}");
            return true;
        }
        CPH.SetGlobalVar(dedupKey, ts, false);

        // ── Chat-Nachricht ─────────────────────────────────
        var rand = new Random();
        string[] templates = {
            $"[SF] {winner} ({shipW}) hat {loser} ({shipL}) vernichtet! GG o7",
            $"[SF] {winner} fliegt als Sieger davon! {loser}s {shipL} treibt antriebslos. o7",
            $"[SF] {loser} ({shipL}) ist Geschichte! {winner} ({shipW}) secured the kill! GG",
            $"[SF] {winner} [{shipW}] besiegt {loser} [{shipL}]. Chaos is a Plan! o7",
        };

        string chatMsg = templates[rand.Next(templates.Length)];
        CPH.SendMessage(chatMsg, true);

        CPH.LogInfo($"[Spacefight] {winner} defeated {loser}");
        return true;
    }
}
