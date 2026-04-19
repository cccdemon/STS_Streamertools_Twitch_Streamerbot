using Newtonsoft.Json;

public class CPHInline
{
    public bool Execute()
    {
        string sessionId = CPH.GetGlobalVar<string>("cc_alert_session", false);
        CPH.LogWarn("[CC] Redeem sending an cc_alert_session");
        if (string.IsNullOrEmpty(sessionId))
        {
            CPH.LogWarn("[CC] Keine registrierte Alert-Session gefunden.");
            return true;
        }

        string user = args.ContainsKey("userName")
            ? args["userName"]?.ToString()
            : "Unknown";

        string avatar = args.ContainsKey("userProfileImageUrl")
            ? args["userProfileImageUrl"]?.ToString()
            : "";

        string reward = args.ContainsKey("rewardName")
            ? args["rewardName"]?.ToString()
            : (args.ContainsKey("redemption.reward.title")
                ? args["redemption.reward.title"]?.ToString()
                : "");

        var payload = new
        {
            alertType = "redeem",
            reward = reward,
            user = user,
            avatar = avatar
        };

        string json = JsonConvert.SerializeObject(payload);

        CPH.WebsocketCustomServerBroadcast(json, sessionId, 0);

        CPH.LogInfo("[CC] Reward-Alert an Overlay gesendet: " + user);
        return true;
    }
}