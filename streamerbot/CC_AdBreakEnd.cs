// Action: "CC – Ad Break End"
// Trigger: Twitch → Ad Break End
//
// Sendet eine Chatnachricht wenn Werbung endet.

public class CPHInline
{
    public bool Execute()
    {
        CPH.SendMessage("▶ Werbung vorbei – willkommen zurück in der Chaos Crew! chaoscrHype");
        CPH.LogInfo("[CC AdBreak] End");
        return true;
    }
}
