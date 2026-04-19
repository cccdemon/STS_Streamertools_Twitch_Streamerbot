// Action: "SF – Stream Offline"
// Trigger: Twitch → Stream Offline
//
// Sendet stream_offline an die API. Spacefight-Service setzt
// SF_LIVE=false und weist neue !fight-Kommandos mit der
// "zu spät"-Nachricht ab.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        var payload = new JObject { ["event"] = "stream_offline" };
        Send(payload);
        CPH.LogInfo("[SF StreamOffline] → API broadcast");
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