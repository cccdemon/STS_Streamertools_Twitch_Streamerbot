// Action: "Hauling Delete" – löscht ALLE Hauling-UserVars komplett
// Trigger: Command  !hauldelete   (NUR Broadcaster – im Command-Recht setzen!)
//
// Härter als !haulreset: entfernt die Variablen ganz (kein Eintrag mehr).

public class CPHInline
{
    static readonly string[] AllVars = { "haulPoints", "haulStreak", "haulRuns", "haulWins", "haulLast" };

    public bool Execute()
    {
        foreach (var v in AllVars)
            CPH.ClearTwitchUsersVar(v, true);

        CPH.SendMessage("🧹 Alle Hauling-Daten vollständig gelöscht!");
        return true;
    }
}
