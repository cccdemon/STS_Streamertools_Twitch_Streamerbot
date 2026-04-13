// Action: "CC – Clip Created"
// Trigger: Twitch → Clip Created
//
// Sendet eine Chatnachricht mit Titel und URL des erstellten Clips.

public class CPHInline
{
    public bool Execute()
    {
        string title    = GetArg("clipTitle") ?? GetArg("title") ?? "Clip";
        string url      = GetArg("clipUrl")   ?? GetArg("url")   ?? "";
        string creator  = GetArg("createdBy") ?? GetArg("user")  ?? "";

        string msg = string.IsNullOrEmpty(url)
            ? $"🎬 Clip erstellt: \"{title}\""
            : $"🎬 Clip erstellt: \"{title}\" → {url}";

        if (!string.IsNullOrEmpty(creator))
            msg += $" (von {creator})";

        CPH.SendMessage(msg);
        CPH.LogInfo($"[CC Clip] {title}");
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
