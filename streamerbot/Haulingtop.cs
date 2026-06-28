// Action: "Hauling Top" – Bestenliste
// Trigger: Command  !haultop

using System;
using System.Collections.Generic;

public class CPHInline
{
    const string VarPoints = "haulPoints";

    public bool Execute()
    {
        List<UserVariableValue<int>> list = CPH.GetTwitchUsersVar<int>(VarPoints, true);

        if (list == null || list.Count == 0)
        {
            CPH.SendMessage("📦 Noch keine Spieler in der Hauling-Liga. Starte mit !haul");
            return true;
        }

        // Sortieren: Punkte absteigend, dann Name A–Z
        list.Sort((a, b) =>
        {
            int cmp = b.Value.CompareTo(a.Value);
            if (cmp != 0) return cmp;
            return string.Compare(a.UserName, b.UserName, StringComparison.OrdinalIgnoreCase);
        });

        string[] medals = { "🥇", "🥈", "🥉" };
        var parts = new List<string>();
        int max = Math.Min(5, list.Count);
        for (int i = 0; i < max; i++)
        {
            var e = list[i];
            string pos = i < 3 ? medals[i] : $"{i + 1}.";
            parts.Add($"{pos} {e.UserName} {Badge(e.Value)} {e.Value}");
        }

        CPH.SendMessage("🏆 HAULING TOP 5 🏆 ┃ " + string.Join("  ┃  ", parts));
        return true;
    }

    static string Badge(int balance)
    {
        if (balance >= 50000) return "🌟";
        if (balance >= 25000) return "🟣";
        if (balance >= 10000) return "🔴";
        if (balance >= 5000)  return "🟠";
        if (balance >= 2000)  return "🟡";
        if (balance >= 500)   return "🟢";
        return "⚪";
    }
}
