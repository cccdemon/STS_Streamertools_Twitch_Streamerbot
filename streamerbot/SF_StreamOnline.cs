// Action: "SF – Stream Online"
// Trigger: Twitch → Stream Online
//
// Sendet stream_online an die API. Spacefight-Service setzt
// daraufhin SF_LIVE=true in Redis, sodass !fight-Kommandos
// ab sofort durchgelassen werden.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        var payload = new JObject { ["event"] = "stream_online" };
        Send(payload);
        CPH.LogInfo("[SF StreamOnline] → API broadcast");
        return true;
    }

    private void Send(JObject payload)
    {
        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (string.IsNullOrEmpty(apiSession))
        {
            CPH.LogWarn("[SF] cc_api_session nicht gesetzt");
            return;
        }
        CPH.WebsocketCustomServerBroadcast(payload.ToString(), apiSession, 0);
    }
}