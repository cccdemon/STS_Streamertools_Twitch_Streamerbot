// Action: "Hauling Saldo" – Kontostand + Statistik
// Trigger: Command  !haulsaldo  (oder !konto)

using System;

public class CPHInline
{
    const string CurrencyName = "Hauling-Punkte";
    const string VarPoints = "haulPoints";
    const string VarStreak = "haulStreak";
    const string VarRuns   = "haulRuns";
    const string VarWins   = "haulWins";

    public bool Execute()
    {
        CPH.TryGetArg("userName", out string userName);
        CPH.TryGetArg("user", out string displayName);
        if (string.IsNullOrEmpty(userName)) return false;
        if (string.IsNullOrEmpty(displayName)) displayName = userName;

        int balance = CPH.GetTwitchUserVar<int?>(userName, VarPoints, true) ?? 0;
        int streak  = CPH.GetTwitchUserVar<int?>(userName, VarStreak, true) ?? 0;
        int runs    = CPH.GetTwitchUserVar<int?>(userName, VarRuns, true) ?? 0;
        int wins    = CPH.GetTwitchUserVar<int?>(userName, VarWins, true) ?? 0;

        var rank = Rank(balance);
        int winPct = runs > 0 ? (int)Math.Round(100.0 * wins / runs) : 0;
        string streakTxt = streak >= 3 ? $" · 🔥 Streak {streak}" : (streak > 0 ? $" · Streak {streak}" : "");

        CPH.SendMessage(
            $"💼 {displayName} {rank.Item2} {rank.Item1} · 💰 {balance} {CurrencyName} · " +
            $"📊 {wins}/{runs} ({winPct}% Erfolg){streakTxt} · {NextRank(balance)}");
        return true;
    }

    static Tuple<string,string> Rank(int balance)
    {
        if (balance >= 50000) return Tuple.Create("Sternenspediteur", "🌟");
        if (balance >= 25000) return Tuple.Create("Logistik-Magnat", "🟣");
        if (balance >= 10000) return Tuple.Create("Frachtbaron", "🔴");
        if (balance >= 5000)  return Tuple.Create("Frachtprofi", "🟠");
        if (balance >= 2000)  return Tuple.Create("Kurierfahrer", "🟡");
        if (balance >= 500)   return Tuple.Create("Lehrling", "🟢");
        return Tuple.Create("Frachtanfänger", "⚪");
    }

    // Fortschritt bis zum nächsten Rang als Mini-Balken
    static string NextRank(int balance)
    {
        int[] thr = { 500, 2000, 5000, 10000, 25000, 50000 };
        string[] nm = { "Lehrling", "Kurierfahrer", "Frachtprofi", "Frachtbaron", "Logistik-Magnat", "Sternenspediteur" };
        for (int i = 0; i < thr.Length; i++)
        {
            if (balance < thr[i])
            {
                int prev = i == 0 ? 0 : thr[i - 1];
                int filled = (int)Math.Round(10.0 * (balance - prev) / (thr[i] - prev));
                if (filled < 0) filled = 0; if (filled > 10) filled = 10;
                string bar = new string('▰', filled) + new string('▱', 10 - filled);
                return $"➡ {nm[i]}: {bar} (noch {thr[i] - balance})";
            }
        }
        return "👑 Maximaler Rang erreicht!";
    }
}
