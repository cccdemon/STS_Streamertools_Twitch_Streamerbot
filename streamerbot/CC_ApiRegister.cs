// Action: "CC – API Register"
// Trigger: Core → WebSocket → Custom Server → Message
//
// Die API verbindet sich beim Start mit Streamerbots WS-Server
// und schickt { event: "cc_api_register" }.
// Diese Action speichert die Session-ID der Verbindung als
// cc_api_session GlobalVar – danach können alle anderen Actions
// WebsocketCustomServerBroadcast nutzen.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        if (!args.ContainsKey("data") || args["data"] == null) return true;

        JObject msg;
        try { msg = JObject.Parse(args["data"].ToString()); }
        catch { return true; }

        if (msg["event"]?.ToString() != "cc_api_register") return true;

        // sessionId wird von Streamerbot automatisch in args gesetzt
        string sessionId = args.ContainsKey("sessionId") ? args["sessionId"]?.ToString() : null;
        if (string.IsNullOrEmpty(sessionId)) return true;

        CPH.SetGlobalVar("cc_api_session", sessionId, false);
        CPH.LogInfo("[CC] API registriert – Session: " + sessionId);

        return true;
    }
}
