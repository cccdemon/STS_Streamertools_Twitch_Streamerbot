// Action: "GW – Time Info"
// Trigger: Core → Command → "time" oder "coin"
//
// v5: API berechnet Watchtime und schickt chat_reply zurück.
// Streamerbot wartet auf chat_reply Event und sendet es in den Chat.

public class CPHInline
{
    public bool Execute()
    {
        string user = "";
        if (args.ContainsKey("user") && args["user"] != null)
            user = args["user"].ToString().Trim();
        else if (args.ContainsKey("userName") && args["userName"] != null)
            user = args["userName"].ToString().Trim();

        if (string.IsNullOrEmpty(user)) return true;

        var payload = Newtonsoft.Json.JsonConvert.SerializeObject(new System.Collections.Generic.Dictionary<string, object>
        {
            ["event"] = "time_cmd",
            ["user"]  = user
        });

        string apiSession = CPH.GetGlobalVar<string>("cc_api_session", false);
        if (!string.IsNullOrEmpty(apiSession))
            CPH.WebsocketCustomServerBroadcast(payload, apiSession, 0);

        return true;
    }
}
