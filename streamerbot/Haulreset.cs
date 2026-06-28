// Action: "Hauling Reset" – setzt alle Spielwerte auf 0 (Saison-Reset)
// Trigger: Command  !haulreset   (NUR Broadcaster/Mod – im Command-Recht setzen!)
//
// Behält die User-Einträge, nullt aber Punkte/Streak/Statistik.

public class CPHInline
{
    static readonly string[] IntVars = { "haulPoints", "haulStreak", "haulRuns", "haulWins" };

    public bool Execute()
    {
        var list = CPH.GetTwitchUsersVar<int>("haulPoints", true);
        if (list != null)
        {
            foreach (var entry in list)
                foreach (var v in IntVars)
                    CPH.SetTwitchUserVar(entry.UserName, v, 0, true);
        }
        // Cooldown-Zeitstempel global wegräumen
        CPH.ClearTwitchUsersVar("haulLast", true);

        CPH.SendMessage("🔁 Hauling-Saison zurückgesetzt! Alle Punkte, Streaks & Statistiken auf 0. Neue Runde – !haul");
        return true;
    }
}
