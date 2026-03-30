// Action: "Spacefight – Stream Status"
// Trigger A: Twitch → Stream Online  → live=true
// Trigger B: Twitch → Stream Offline → live=false
//
// Informiert das Spacefight Overlay ob der Stream gerade läuft.

using System;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string sfSession = CPH.GetGlobalVar<string>("gw_spacefight_session", false);
        if (string.IsNullOrEmpty(sfSession)) return true;

        // live=true wenn "streamOnline" im Action-Namen, sonst false
        // Alternativ: eigene GlobalVar setzen
        bool isLive = false;
        if (args.ContainsKey("actionName") && args["actionName"] != null)
            isLive = args["actionName"].ToString().Contains("Online");

        // Kann auch über separate Actions gesteuert werden:
        // Action "SF Stream Online"  → isLive = true
        // Action "SF Stream Offline" → isLive = false
        if (args.ContainsKey("isLive") && args["isLive"] != null)
            bool.TryParse(args["isLive"].ToString(), out isLive);

        var payload = new JObject
        {
            ["event"]     = "sf_status",
            ["live"]      = isLive,
            ["streaming"] = isLive
        };

        CPH.WebsocketCustomServerBroadcast(payload.ToString(), sfSession, 0);
        CPH.SetGlobalVar("sf_stream_live", isLive, false);
        CPH.LogInfo($"[SF Status] Stream live: {isLive}");
        return true;
    }
}
