using UnityEngine;

/// <summary>
/// HUD simples em OnGUI (não precisa de Canvas nem de pacotes). Mostra a visão do jogador local:
/// fantasma (vida, instabilidade com pulso vermelho, recargas) ou caçador (EMF 1–5, térmica, sal).
/// </summary>
public class GameHUD : MonoBehaviour
{
    public GhostGameManager manager;
    public GhostController localGhost;
    public HunterController localHunter;

    private GUIStyle big, small, center;

    void Start()
    {
        if (manager == null) manager = GhostGameManager.Instance != null ? GhostGameManager.Instance : FindObjectOfType<GhostGameManager>();
        if (localGhost == null && localHunter == null) FindLocalPlayer();
    }

    /// <summary>Chamado pelo MatchSetup quando os jogadores são criados depois do Start.</summary>
    public void Bind(GhostGameManager m, GhostController ghost, HunterController hunter)
    {
        if (m != null) manager = m;
        localGhost = ghost;
        localHunter = hunter;
        if (localGhost == null && localHunter == null) FindLocalPlayer();
    }

    void FindLocalPlayer()
    {
        foreach (var h in FindObjectsOfType<HunterController>())
            if (h.isLocallyControlled) { localHunter = h; return; }
        foreach (var g in FindObjectsOfType<GhostController>())
            if (g.isLocallyControlled) { localGhost = g; return; }
    }

    void EnsureStyles()
    {
        if (big != null) return;
        big = new GUIStyle(GUI.skin.label) { fontSize = 28, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
        big.normal.textColor = Color.white;
        small = new GUIStyle(GUI.skin.label) { fontSize = 16 };
        small.normal.textColor = Color.white;
        center = new GUIStyle(small) { alignment = TextAnchor.MiddleCenter };
    }

    void OnGUI()
    {
        if (GameMenu.HidesHud) return; // menu principal ou tela de resultado por cima
        EnsureStyles();
        float w = Screen.width, h = Screen.height;

        // Caçador cego durante a fase de esconderijo
        if (localHunter != null && manager != null && manager.Phase == MatchPhase.Hiding)
        {
            Fill(new Rect(0, 0, w, h), Color.black);
            GUI.Label(new Rect(0, h * 0.5f - 40, w, 40), "Os fantasmas estão se escondendo...", big);
            GUI.Label(new Rect(0, h * 0.5f, w, 30), $"{Mathf.CeilToInt(manager.HidePhaseRemaining)} s", center);
            return;
        }

        if (manager != null) DrawTimer(w);
        if (localGhost != null) DrawGhost(w, h);
        if (localHunter != null) DrawHunter(w, h);

        // Aviso da Caçada Invertida nos primeiros segundos
        if (manager != null && manager.Phase == MatchPhase.Reversal && manager.ReversalElapsed < 4f)
        {
            float a = 1f - Mathf.Clamp01((manager.ReversalElapsed - 3f));
            Fill(new Rect(0, h * 0.3f, w, 90), new Color(0.35f, 0, 0, 0.7f * a));
            GUI.Label(new Rect(0, h * 0.3f, w, 50), "A CAÇADA SE INVERTEU!", big);
            string sub = localHunter != null ? "Seu aspirador está sem bateria. FUJA e sobreviva!" : "Agora você caça. [Botão esq.] Toque Gélido";
            GUI.Label(new Rect(0, h * 0.3f + 50, w, 30), sub, center);
        }

        if (manager != null && manager.Phase == MatchPhase.Ended && !GameMenu.IsPresent) // com o menu, a tela de resultado substitui esta faixa
        {
            Fill(new Rect(0, h * 0.4f, w, 80), new Color(0, 0, 0, 0.75f));
            GUI.Label(new Rect(0, h * 0.4f, w, 50), manager.GhostsWon ? "VITÓRIA DOS FANTASMAS" : "VITÓRIA DOS CAÇADORES", big);
            GUI.Label(new Rect(0, h * 0.4f + 48, w, 28), manager.WinReason, center);
        }
    }

    void DrawTimer(float w)
    {
        bool rev = manager.Phase == MatchPhase.Reversal;
        float t = rev ? manager.ReversalRemaining : manager.TimeRemaining;
        string phase = manager.Phase == MatchPhase.Hiding ? "Esconderijo " + Mathf.CeilToInt(manager.HidePhaseRemaining) + "s  |  "
                     : rev ? "CAÇADA INVERTIDA  " : "";
        if (rev) Fill(new Rect(0, 0, w, 56), new Color(0.4f, 0f, 0f, 0.35f + 0.1f * Mathf.Sin(Time.time * 4f)));
        GUI.Label(new Rect(0, 10, w, 36), $"{phase}{(int)(t / 60f):0}:{(int)(t % 60f):00}   Fantasmas: {manager.AliveGhosts}   Caçadores: {manager.AliveHunters}", big);
    }

    void DrawGhost(float w, float h)
    {
        GhostController g = localGhost;
        if (g.IsExorcised)
        {
            GUI.Label(new Rect(0, h * 0.5f, w, 40), "Você foi exorcizado.", big);
            return;
        }

        // Pulso vermelho (15 s → 20 s)
        if (g.IsInWarning)
        {
            float a = 0.12f + 0.12f * Mathf.Sin(Time.time * 10f);
            Fill(new Rect(0, 0, w, h), new Color(1f, 0f, 0f, a));
        }
        if (g.IsExposed)
            GUI.Label(new Rect(0, h * 0.25f, w, 40), "EXPOSTO!", big);

        float x = 20, y = h - 130;
        Bar(new Rect(x, y, 260, 18), g.Health01, new Color(0.4f, 0.9f, 1f), "Ectoplasma");
        y += 26;
        if (g.IsPossessing)
        {
            Color c = g.IsInWarning ? Color.red : new Color(1f, 0.8f, 0.2f);
            Bar(new Rect(x, y, 260, 18), g.InstabilityNormalized, c, $"Instabilidade {g.PossessionTime:0.0}/{g.maxStayDuration:0}s");
            y += 26;
            if (g.BeamExpulsion01 > 0f) { Bar(new Rect(x, y, 260, 12), g.BeamExpulsion01, Color.magenta, ""); y += 18; }
            GUI.Label(new Rect(x, y, 600, 24), $"Possuindo: {g.CurrentProp.propName} ({g.CurrentProp.roomName})", small);
        }
        else
        {
            GUI.Label(new Rect(x, y, 600, 24), "[E] possuir móvel mirado   ·   portas não te seguram; [R] numa porta = batida", small);
        }

        string haunt = g.HauntCooldownRemaining > 0 ? $"{g.HauntCooldownRemaining:0}s" : "pronto";
        if (g.HuntMode)
        {
            string atk = g.AttackCooldownRemaining > 0 ? $"{g.AttackCooldownRemaining:0.0}s" : "pronto";
            GUI.Label(new Rect(w - 320, h - 60, 300, 24), $"[Botão esq.] Toque Gélido: {atk}", small);
        }
        else
        {
            string jump = g.SpectralJumpCooldownRemaining > 0 ? $"{g.SpectralJumpCooldownRemaining:0}s" : "pronto";
            GUI.Label(new Rect(w - 320, h - 60, 300, 24), $"[Q] Salto Espectral: {jump}", small);
        }
        GUI.Label(new Rect(w - 320, h - 36, 300, 24), $"[R] Assombração: {haunt}", small);

        Crosshair(w, h);
    }

    void DrawHunter(float w, float h)
    {
        HunterController hu = localHunter;

        if (hu.IsDead)
        {
            Fill(new Rect(0, 0, w, h), new Color(0.25f, 0f, 0f, 0.45f));
            GUI.Label(new Rect(0, h * 0.5f - 20, w, 40), "Você foi pego pelos fantasmas.", big);
            return;
        }
        if (hu.TimeSinceHurt < 0.6f) Fill(new Rect(0, 0, w, h), new Color(0.8f, 0f, 0f, 0.35f * (1f - hu.TimeSinceHurt / 0.6f)));

        Bar(new Rect(20, h - 150, 260, 18), hu.Health01, new Color(0.85f, 0.2f, 0.2f), "Vida");
        Bar(new Rect(20, h - 124, 260, 12), hu.Stamina01, hu.IsExhausted ? new Color(0.5f, 0.5f, 0.5f) : new Color(0.95f, 0.85f, 0.3f), "");
        if (hu.FleeMode)
            GUI.Label(new Rect(20, h - 108, 600, 24), "Aspirador sem bateria — FUJA!  [Shift] correr  ·  [G] sal bloqueia fantasmas", small);
        int level = hu.CurrentEmfLevel;

        float bx = w - 220, by = h - 70;
        GUI.Label(new Rect(bx, by - 26, 200, 24), "EMF", small);
        for (int i = 0; i < 5; i++)
        {
            Color on = Color.Lerp(Color.green, Color.red, i / 4f);
            Fill(new Rect(bx + i * 38, by, 32, 32), i < level ? on : new Color(0.2f, 0.2f, 0.2f, 0.8f));
        }

        GUI.Label(new Rect(20, h - 60, 400, 24), hu.ThermalActive ? "[T] Câmera Térmica: LIGADA" : "[T] Câmera Térmica: desligada", small);
        GUI.Label(new Rect(20, h - 36, 400, 24), $"[G] Sal Purificador: {hu.SaltChargesRemaining}", small);
        GUI.Label(new Rect(20, h - 84, 400, 24), "[E] abrir/fechar porta", small);

        if (hu.ThermalActive) Fill(new Rect(0, 0, w, h), new Color(0.1f, 0.3f, 0.6f, 0.12f));
        Crosshair(w, h);
    }

    void Crosshair(float w, float h)
    {
        Fill(new Rect(w * 0.5f - 1, h * 0.5f - 8, 2, 16), new Color(1, 1, 1, 0.7f));
        Fill(new Rect(w * 0.5f - 8, h * 0.5f - 1, 16, 2), new Color(1, 1, 1, 0.7f));
    }

    void Bar(Rect r, float value, Color c, string label)
    {
        Fill(r, new Color(0, 0, 0, 0.6f));
        Fill(new Rect(r.x, r.y, r.width * Mathf.Clamp01(value), r.height), c);
        if (!string.IsNullOrEmpty(label)) GUI.Label(new Rect(r.x + 6, r.y - 3, r.width, r.height + 6), label, small);
    }

    static void Fill(Rect r, Color c)
    {
        Color old = GUI.color;
        GUI.color = c;
        GUI.DrawTexture(r, Texture2D.whiteTexture);
        GUI.color = old;
    }
}
