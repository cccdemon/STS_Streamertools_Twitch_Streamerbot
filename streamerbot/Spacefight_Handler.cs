// Action: "Spacefight – Result Handler"
// Trigger: WebSocket Server → Custom Server Message
//          (Message enthält "spacefight_result")
//
// Schreibt das Kampfergebnis in den Twitch Chat

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

        if (msg["event"]?.ToString() != "spacefight_result") return true;

        string winner = msg["winner"]?.ToString() ?? "";
        string loser  = msg["loser"]?.ToString()  ?? "";
        string shipW  = msg["ship_w"]?.ToString()  ?? "";
        string shipL  = msg["ship_l"]?.ToString()  ?? "";

        if (string.IsNullOrEmpty(winner)) return true;

        // Zufällige Kampf-Nachrichten
        var rand = new Random();
        string[] templates = {
            $"⚔️ RAUMKAMPF: {winner} ({shipW}) hat {loser} ({shipL}) vernichtet! GG o7",
            $"🚀 {winner} fliegt als Sieger davon! {loser}s {shipL} treibt antriebslos. o7",
            $"💥 {loser} ({shipL}) ist Geschichte! {winner} ({shipW}) secured the kill! GG",
            $"⚡ Kampf vorbei! {winner} [{shipW}] besiegt {loser} [{shipL}]. Chaos is a Plan! o7",
        };

        string chatMsg = templates[rand.Next(templates.Length)];
        CPH.SendMessage(chatMsg, true);

        CPH.LogInfo($"[Spacefight] {winner} defeated {loser}");
        return true;
    }
}
