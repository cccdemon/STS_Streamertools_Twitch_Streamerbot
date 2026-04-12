// Action: "CC – Raid Broadcaster"
// Trigger: Twitch → Raid
//
// Wenn ein Raid eingeht, wird das Event an die API gesendet.
// Die API broadcastet an alle Browser-Overlays (9091):
// raid-info.html und alerts.html empfangen das Event.

using System;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string user    = GetArg("displayName") ?? GetArg("userName") ?? GetArg("user") ?? "Unbekannt";
        string viewers = GetArg("viewers") ?? GetArg("viewerCount") ?? "0";
        string avatar  = GetArg("profileImageUrl") ?? GetArg("userProfileImageUrl") ?? "";
        string game    = GetArg("gameName") ?? GetArg("game") ?? "";

        var payload = new JObject
        {
            ["event"]           = "raid",
            ["user"]            = user,
            ["amount"]          = viewers,
            ["profileImageUrl"] = avatar,
            ["game"]            = game
        };

        // An API senden → broadcastet an alle Browser-Overlays
        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
        {
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
            CPH.LogInfo($"[CC Raid] {user} mit {viewers} Viewern → API broadcast");
        }
        else
        {
            CPH.LogInfo("[CC Raid] WARNUNG: cc_api_session nicht gesetzt!");
        }

        return true;
    }

    private string GetArg(string key)
    {
        if (args.ContainsKey(key) && args[key] != null)
        {
            string val = args[key].ToString().Trim();
            return val.Length > 0 ? val : null;
        }
        return null;
    }
}
