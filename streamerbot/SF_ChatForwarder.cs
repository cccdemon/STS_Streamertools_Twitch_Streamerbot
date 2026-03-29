// Action: "Spacefight – Chat Forwarder"
// Trigger: Core → Command → "fight" (Prefix: !)

using System;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string sfSession = CPH.GetGlobalVar<string>("gw_spacefight_session", false);
        CPH.LogInfo($"[SF Forwarder] session={sfSession ?? "NULL"}");
        if (string.IsNullOrEmpty(sfSession)) return true;

        string attacker = "";
        string defender = "";

        if (args.ContainsKey("user") && args["user"] != null)
            attacker = args["user"].ToString().Trim();
        else if (args.ContainsKey("userName") && args["userName"] != null)
            attacker = args["userName"].ToString().Trim();

        if (args.ContainsKey("commandTarget") && args["commandTarget"] != null)
            defender = args["commandTarget"].ToString().Trim().TrimStart('@');
        else if (args.ContainsKey("message") && args["message"] != null)
        {
            string msg = args["message"].ToString().Trim();
            if (msg.Length > 6)
                defender = msg.Substring(6).Trim().TrimStart('@');
        }

        if (string.IsNullOrEmpty(attacker) || string.IsNullOrEmpty(defender)) return true;

        var sb1 = new System.Text.StringBuilder();
        foreach (char ch in attacker)
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb1.Append(ch);
        attacker = sb1.ToString();

        var sb2 = new System.Text.StringBuilder();
        foreach (char ch in defender)
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
                sb2.Append(ch);
        defender = sb2.ToString();

        if (attacker.Length == 0 || attacker.Length > 25) return true;
        if (defender.Length == 0 || defender.Length > 25) return true;
        if (attacker.ToLower() == defender.ToLower()) return true;

        var payload = new JObject
        {
            ["event"]    = "fight_cmd",
            ["attacker"] = attacker,
            ["defender"] = defender,
            ["ts"]       = DateTime.UtcNow.ToString("o")
        };

        string json = payload.ToString();
        CPH.WebsocketCustomServerBroadcast(json, sfSession, 0);
        CPH.LogInfo($"[SF Forwarder] {attacker} vs {defender}");
        return true;
    }
}
