// Action: "CC – Chat Reply Handler"
// Trigger: Core → WebSocket → Custom Server Message
//
// Empfängt chat_reply Events von der API und
// schickt sie als Twitch-Chat-Nachricht.
// Alle Text-Antworten laufen über diesen Handler.

using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        if (!args.ContainsKey("data") || args["data"] == null) return true;
        string raw = args["data"].ToString();
        if (string.IsNullOrEmpty(raw)) return true;

        JObject msg;
        try { msg = JObject.Parse(raw); }
        catch { return true; }

        string evnt = msg["event"]?.ToString();
        if (evnt != "chat_reply") return true;

        string message = msg["message"]?.ToString();
        if (!string.IsNullOrEmpty(message))
            CPH.SendMessage(message, true);

        return true;
    }
}
