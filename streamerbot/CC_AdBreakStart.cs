// Action: "CC – Ad Break Start"
// Trigger: Twitch → Ad Break Begin
//
// Sendet eine Chatnachricht wenn Werbung startet.

public class CPHInline
{
    public bool Execute()
    {
        string durationStr = GetArg("duration") ?? GetArg("adDuration") ?? "0";
        int.TryParse(durationStr, out int duration);

        string msg = duration > 0
            ? $"⏸ Kurze Werbepause ({duration}s) – gleich sind wir zurück! PauseChamp"
            : "⏸ Kurze Werbepause – gleich sind wir zurück! PauseChamp";

        CPH.SendMessage(msg);
        CPH.LogInfo($"[CC AdBreak] Start – {duration}s");
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
