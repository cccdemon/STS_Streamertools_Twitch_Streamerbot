// Action: "Hauling" – Frachttransport-Chatgame
// Trigger: Command  !haul
//
// Spieler nimmt einen Frachtauftrag an. Erfolg/Misserfolg nach
// auftrags-abhängigem Risiko. Reicher Chat-Output (Risiko-Meter,
// Rang-Badge, Streak) + optionaler Broadcast ans OBS-Overlay
// (haul.html, Session cc_haul_session) für grafische Effekte.
//
// Twitch UserVars (persisted): haulPoints, haulStreak, haulRuns,
// haulWins, haulLast (Unix-Sekunden, Cooldown).

using System;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    const string CurrencyName = "Hauling-Punkte";
    const string VarPoints = "haulPoints";
    const string VarStreak = "haulStreak";
    const string VarRuns   = "haulRuns";
    const string VarWins   = "haulWins";
    // Cooldown wird im Streamerbot-Command gesteuert (nicht im Code).

    class Job
    {
        public string Name, Emoji, Tier;
        public double Prob;
        public int MinWin, MaxWin, MinLoss, MaxLoss;
        public Job(string n, string e, string t, double p, int mw, int xw, int ml, int xl)
        { Name=n; Emoji=e; Tier=t; Prob=p; MinWin=mw; MaxWin=xw; MinLoss=ml; MaxLoss=xl; }
    }

    // Aufträge in 4 Risiko-Stufen. Höheres Risiko = mehr Gewinn, mehr Verlust.
    static readonly Job[] Jobs = new[]
    {
        // LEICHT (~65% Erfolg)
        new Job("Koloniegüter-Lieferung","📦","LEICHT",0.66, 80, 320, 20, 140),
        new Job("Stadt-Kurierlauf","🛵","LEICHT",0.68, 70, 280, 15, 120),
        new Job("Lebensmittel-Konvoi","🥫","LEICHT",0.64, 90, 340, 25, 150),
        new Job("Baumaterial-Transport","🧱","LEICHT",0.65, 100, 360, 30, 160),
        new Job("Express-Paketdienst","✉️","LEICHT",0.67, 80, 300, 20, 130),
        new Job("Wassertank-Versorgung","🚰","LEICHT",0.66, 85, 330, 25, 145),

        // MITTEL (~50% Erfolg)
        new Job("Weltraum-Erztransport","🪨","MITTEL",0.50, 180, 620, 80, 360),
        new Job("Wüsten-Konvoi","🏜️","MITTEL",0.49, 200, 640, 90, 380),
        new Job("Arktis-Versorgungslauf","❄️","MITTEL",0.48, 210, 660, 100, 400),
        new Job("Schwerlast-Transport","🏗️","MITTEL",0.50, 220, 680, 110, 420),
        new Job("Medizin-Sondertransport","💊","MITTEL",0.51, 200, 600, 90, 360),
        new Job("Treibstoff-Tanker","⛽","MITTEL",0.47, 230, 700, 120, 440),
        new Job("Maschinen-Großteil","⚙️","MITTEL",0.49, 210, 650, 100, 400),

        // SCHWER (~35% Erfolg)
        new Job("Gefahrgut-Schlepper","☢️","SCHWER",0.36, 450, 1250, 260, 720),
        new Job("VIP-Frachteskorte","🤵","SCHWER",0.35, 500, 1300, 280, 760),
        new Job("Tiefseeminen-Abholung","🌊","SCHWER",0.34, 520, 1350, 300, 800),
        new Job("Kriegsgebiet-Versorgung","🪖","SCHWER",0.33, 560, 1400, 320, 840),
        new Job("Schmuggel-Route","🕶️","SCHWER",0.32, 600, 1500, 360, 900),
        new Job("Reaktor-Kernfracht","🔋","SCHWER",0.35, 540, 1380, 300, 820),

        // EXTREM (~25% Erfolg)
        new Job("Hochsicherheits-Fracht","🛡️","EXTREM",0.26, 900, 2400, 600, 1500),
        new Job("Schwarzes-Loch-Bergung","🕳️","EXTREM",0.23, 1100, 2800, 750, 1800),
        new Job("Alien-Artefakt-Bergung","👽","EXTREM",0.24, 1000, 2600, 700, 1700),
        new Job("Plasmasturm-Durchquerung","🌩️","EXTREM",0.22, 1200, 3000, 800, 2000),
        new Job("Piratenraum-Schmuggel","🏴‍☠️","EXTREM",0.25, 950, 2500, 650, 1600),
    };

    readonly Random rng = new Random();

    public bool Execute()
    {
        CPH.TryGetArg("userName", out string userName);     // Twitch-Login (klein)
        CPH.TryGetArg("user", out string displayName);      // Anzeigename
        if (string.IsNullOrEmpty(userName))
        {
            CPH.SendMessage("Konnte den Benutzer nicht ermitteln. Versuch's nochmal.");
            return false;
        }
        if (string.IsNullOrEmpty(displayName)) displayName = userName;

        // ── Zustand laden ──
        int balance = CPH.GetTwitchUserVar<int?>(userName, VarPoints, true) ?? 0;
        int streak  = CPH.GetTwitchUserVar<int?>(userName, VarStreak, true) ?? 0;
        int runs    = CPH.GetTwitchUserVar<int?>(userName, VarRuns, true) ?? 0;
        int wins    = CPH.GetTwitchUserVar<int?>(userName, VarWins, true) ?? 0;

        // ── Auftrag würfeln ──
        Job job = Jobs[rng.Next(Jobs.Length)];
        bool success = rng.NextDouble() < job.Prob;
        runs++;

        int amount;           // +Gewinn oder -Verlust (für Overlay/Anzeige)
        bool crit = false, jackpot = false, ambush = false;
        string fxLine;

        if (success)
        {
            int reward = rng.Next(job.MinWin, job.MaxWin + 1);
            int streakBonus = Math.Min(streak * 5, 50);          // bis +50%
            if (streakBonus > 0) reward += reward * streakBonus / 100;
            crit = rng.Next(100) < 8;                            // Volltreffer ×2
            if (crit) reward *= 2;
            jackpot = rng.Next(100) < 2;                         // seltener Jackpot
            if (jackpot) reward += 2000;

            balance = checked(balance + reward);
            streak++;
            wins++;
            amount = reward;

            string tag = jackpot ? " 🎰 JACKPOT +2000!" : (crit ? " 💥 VOLLTREFFER ×2!" : "");
            string streakTxt = streak >= 3 ? $" · 🔥 Streak {streak}" : "";
            fxLine = $"✅💰 GESCHAFFT! +{reward} {CurrencyName}{tag}{streakTxt}";
        }
        else
        {
            int loss = rng.Next(job.MinLoss, job.MaxLoss + 1);
            ambush = rng.Next(100) < 12;                         // Überfall +50%
            if (ambush) loss += loss / 2;

            balance = Math.Max(0, balance - loss);
            int lostStreak = streak;
            streak = 0;
            amount = -loss;

            string reason = ambush ? "🏴‍☠️ Piratenüberfall!" : Mishap();
            string streakTxt = lostStreak >= 3 ? $" · Streak ({lostStreak}) futsch" : "";
            fxLine = $"💥🛑 VERMASSELT! {reason} −{loss} {CurrencyName}{streakTxt}";
        }

        // ── Persistieren ──
        CPH.SetTwitchUserVar(userName, VarPoints, balance, true);
        CPH.SetTwitchUserVar(userName, VarStreak, streak, true);
        CPH.SetTwitchUserVar(userName, VarRuns, runs, true);
        CPH.SetTwitchUserVar(userName, VarWins, wins, true);

        // ── Chat-Output (2 Zeilen, grafisch untermalt) ──
        var rank = Rank(balance);
        int pct = (int)Math.Round(job.Prob * 100);
        CPH.SendMessage($"🚚{job.Emoji} {displayName} » Auftrag „{job.Name}\" [{job.Tier}] · Risiko {RiskMeter(job.Prob)} {pct}% Erfolg");
        CPH.SendMessage($"{fxLine} · Konto: {balance} {rank.Item2} {rank.Item1}");

        // ── Overlay-Broadcast (Phase 2, no-op wenn Overlay nicht registriert) ──
        BroadcastOverlay(displayName, job, success, amount, balance, streak, crit, jackpot, ambush, rank.Item1, rank.Item2);

        return true;
    }

    // 10-Segment-Risikobalken: gefüllt = Erfolgschance
    static string RiskMeter(double prob)
    {
        int filled = (int)Math.Round(prob * 10);
        if (filled < 0) filled = 0; if (filled > 10) filled = 10;
        return new string('▰', filled) + new string('▱', 10 - filled);
    }

    // Rang-Badge nach Kontostand → (Name, Emoji)
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

    static readonly string[] Mishaps =
    {
        "Motorschaden!", "Ladung verrutscht!", "Im Stau stecken geblieben!",
        "Falsche Koordinaten!", "Zoll kassiert ab!", "Reifenplatzer!",
        "Navigations-Crash!", "Treibstoff leer!", "Fracht beschädigt!",
    };
    string Mishap() => Mishaps[rng.Next(Mishaps.Length)];

    void BroadcastOverlay(string user, Job job, bool success, int amount, int balance,
                          int streak, bool crit, bool jackpot, bool ambush, string rankName, string rankBadge)
    {
        string session = CPH.GetGlobalVar<string>("cc_haul_session", false);
        if (string.IsNullOrEmpty(session)) return;   // Overlay nicht offen → still
        try
        {
            var payload = new JObject
            {
                ["type"]     = "haul",
                ["user"]     = user,
                ["job"]      = job.Name,
                ["emoji"]    = job.Emoji,
                ["tier"]     = job.Tier,
                ["success"]  = success,
                ["amount"]   = amount,
                ["balance"]  = balance,
                ["streak"]   = streak,
                ["crit"]     = crit,
                ["jackpot"]  = jackpot,
                ["ambush"]   = ambush,
                ["rank"]     = rankName,
                ["badge"]    = rankBadge,
            };
            CPH.WebsocketCustomServerBroadcast(payload.ToString(), session, 0);
        }
        catch (Exception ex) { CPH.LogWarn("[Hauling] Overlay-Broadcast fehlgeschlagen: " + ex.Message); }
    }
}
