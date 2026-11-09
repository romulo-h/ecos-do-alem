using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

public enum MenuScreen { None, Main, Setup, Options, Controls, Pause, Results }

/// <summary>
/// Interface fora da partida (OnGUI, sem Canvas nem pacotes):
///   Menu principal → Nova partida (time, nº de jogadores, duração, Caçada Invertida) → partida
///   Esc durante a partida → Pausa (continuar, opções, controles, reiniciar, menu)
///   Fim da partida → Resultado (vencedor, motivo, placar, jogar de novo)
/// Opções (sensibilidade, volumes, tela cheia, qualidade) ficam gravadas em PlayerPrefs.
///
/// Coloque no mesmo objeto do GhostGameManager e do GameHUD. Com o menu na cena, o GhostGameManager
/// deixa de começar sozinho: a partida começa pelo botão "Começar partida".
/// </summary>
[DefaultExecutionOrder(-50)]
[RequireComponent(typeof(MatchSetup))]
public class GameMenu : MonoBehaviour
{
    static GameMenu instance;

    /// <summary>Controladores não leem teclado/mouse enquanto há um menu aberto.</summary>
    public static bool InputBlocked => instance != null && instance.screen != MenuScreen.None;
    /// <summary>A HUD da partida some antes de a partida começar e na tela de resultado.</summary>
    public static bool HidesHud => instance != null && (!instance.matchStarted || instance.screen == MenuScreen.Results);
    public static bool IsPresent => instance != null;

    public string versionLabel = "v1.8";
    [Tooltip("Desligado: pula o menu e começa a partida direto (comportamento antigo).")]
    public bool showMenuOnStart = true;
    [Tooltip("Espera antes da tela de resultado, para ver a animação de morte/exorcismo.")]
    public float resultsDelay = 1.6f;
    public KeyCode pauseKey = KeyCode.Escape;
    [Tooltip("Segunda tecla de pausa. No navegador o Esc é usado para soltar o mouse e pode não chegar ao jogo.")]
    public KeyCode altPauseKey = KeyCode.P;
    [Tooltip("Pausa quando a janela/aba perde o foco (alt-tab, clique fora do jogo).")]
    public bool pauseOnFocusLoss = true;

    [Header("Câmera do menu (orbita a mansão)")]
    public Vector3 menuOrbitCenter = new Vector3(0f, 2f, 0f);
    public float menuOrbitRadius = 24f;
    public float menuOrbitHeight = 13f;
    [Tooltip("Graus por segundo.")]
    public float menuOrbitSpeed = 4f;

    MenuScreen screen = MenuScreen.Main;
    MenuScreen returnScreen = MenuScreen.Main; // para onde Opções/Controles voltam
    bool matchStarted;
    float matchStartTime, matchEndTime;
    float endedAtUnscaled = -1f;
    float resultsShownAt;
    bool hadPointerLock; // o navegador chegou a prender o mouse nesta partida (WebGL)

    MatchSetup setup;
    GhostGameManager manager;
    Camera menuCamera;

    static readonly string[] GhostCountLabels = { "1", "2", "3", "4" };
    static readonly string[] HunterCountLabels = { "1", "2" };
    static readonly string[] OnOff = { "Ligada (2 min)", "Desligada" };
    static readonly string[] YesNo = { "Sim", "Não" };

    // ------------------------------------------------------------------ Ciclo de vida

    void Awake()
    {
        instance = this;
        setup = GetComponent<MatchSetup>();
        manager = GetComponent<GhostGameManager>();
        if (manager == null) manager = FindObjectOfType<GhostGameManager>();

        MatchSettings.Load();
        if (manager != null)
        {
            manager.autoStart = false; // o menu decide quando começa
            manager.ambientVolume = MatchSettings.AmbientVolume;
            manager.MatchEnded += OnMatchEnded;
        }
        Time.timeScale = 1f;
        AudioListener.pause = false;
    }

    void OnDestroy()
    {
        if (manager != null) manager.MatchEnded -= OnMatchEnded;
        if (instance == this)
        {
            instance = null;
            Time.timeScale = 1f;
            AudioListener.pause = false;
        }
    }

    void Start()
    {
        MatchSettings.Apply();
        if (MatchSettings.StartImmediately || !showMenuOnStart)
        {
            MatchSettings.StartImmediately = false;
            StartMatch();
        }
        else
        {
            screen = MenuScreen.Main;
            CreateMenuCamera();
        }
    }

    void Update()
    {
        if (Input.GetKeyDown(pauseKey)) HandleBack();
        else if (Input.GetKeyDown(altPauseKey)) TogglePause();
        WatchPointerLock();

        if (endedAtUnscaled >= 0f && screen == MenuScreen.None && Time.unscaledTime - endedAtUnscaled >= resultsDelay)
        {
            screen = MenuScreen.Results;
            resultsShownAt = Time.unscaledTime;
        }

        bool cursorFree = screen != MenuScreen.None || endedAtUnscaled >= 0f;
        Cursor.lockState = cursorFree ? CursorLockMode.None : CursorLockMode.Locked;
        Cursor.visible = cursorFree;

        UpdateMenuCamera();
    }

    // ------------------------------------------------------------------ Ações

    void StartMatch()
    {
        MatchSettings.Save();
        screen = MenuScreen.None;
        StartCoroutine(BeginNextFrame());
    }

    IEnumerator BeginNextFrame()
    {
        // Um frame de folga: garante que o loader e o GhostGameManager já passaram pelo Start.
        yield return null;
        if (menuCamera != null) Destroy(menuCamera.gameObject);
        setup.BeginMatch();
        matchStarted = true;
        matchStartTime = Time.time;
        endedAtUnscaled = -1f;
    }

    void OnMatchEnded(bool ghostsWon)
    {
        if (screen == MenuScreen.Pause) Resume();
        matchEndTime = Time.time;
        endedAtUnscaled = Time.unscaledTime;
    }

    void Pause()
    {
        screen = MenuScreen.Pause;
        Time.timeScale = 0f;
        AudioListener.pause = true;
    }

    void Resume()
    {
        screen = MenuScreen.None;
        Time.timeScale = 1f;
        AudioListener.pause = false;
        hadPointerLock = false; // no navegador, o mouse só volta a ser preso no próximo clique
    }

    bool MatchRunning => matchStarted && manager != null && manager.Phase != MatchPhase.Ended;

    /// <summary>Tecla P: pausa e despausa, sem navegar pelos submenus como o Esc.</summary>
    void TogglePause()
    {
        if (screen == MenuScreen.None && MatchRunning) Pause();
        else if (screen == MenuScreen.Pause) Resume();
    }

    void OnApplicationFocus(bool hasFocus)
    {
        if (!hasFocus && pauseOnFocusLoss && screen == MenuScreen.None && MatchRunning) Pause();
    }

    /// <summary>
    /// No navegador, o Esc solta o mouse sem que o jogo receba a tecla. Quando o mouse que estava preso
    /// é solto no meio da partida, pausa como se o Esc tivesse chegado.
    /// </summary>
    void WatchPointerLock()
    {
        if (!IsWebGL || screen != MenuScreen.None || !MatchRunning) return;
        if (PointerLocked) hadPointerLock = true;
        else if (hadPointerLock) Pause();
    }

    static bool IsWebGL => Application.platform == RuntimePlatform.WebGLPlayer;
    /// <summary>Página web não pode fechar o próprio jogo: no WebGL o botão Sair some.</summary>
    static bool CanQuit => !IsWebGL;

#if UNITY_WEBGL && !UNITY_EDITOR
    // Assets/Plugins/WebGL/EcosPointerLock.jslib
    [System.Runtime.InteropServices.DllImport("__Internal")]
    static extern int EcosPointerLockActive();
    static bool PointerLocked => EcosPointerLockActive() != 0;
#else
    static bool PointerLocked => Cursor.lockState == CursorLockMode.Locked;
#endif

    /// <summary>Esc: pausa durante o jogo; nos menus, volta uma tela.</summary>
    void HandleBack()
    {
        switch (screen)
        {
            case MenuScreen.None:
                if (matchStarted && manager != null && manager.Phase != MatchPhase.Ended) Pause();
                break;
            case MenuScreen.Pause: Resume(); break;
            case MenuScreen.Options: MatchSettings.Save(); screen = returnScreen; break;
            case MenuScreen.Controls: screen = returnScreen; break;
            case MenuScreen.Setup: screen = MenuScreen.Main; break;
        }
    }

    void OpenSubScreen(MenuScreen target)
    {
        returnScreen = screen;
        screen = target;
    }

    /// <summary>Recarrega a cena: partida nova e limpa (móveis, portas, sal e pegadas voltam ao início).</summary>
    void ReloadScene(bool startImmediately)
    {
        MatchSettings.Save();
        MatchSettings.StartImmediately = startImmediately;
        Time.timeScale = 1f;
        AudioListener.pause = false;

        Scene s = SceneManager.GetActiveScene();
        if (s.buildIndex >= 0)
        {
            SceneManager.LoadScene(s.buildIndex);
            return;
        }
#if UNITY_EDITOR
        // Cena fora do Build Settings: no editor dá para recarregar pelo caminho do arquivo.
        if (!string.IsNullOrEmpty(s.path))
        {
            UnityEditor.SceneManagement.EditorSceneManager.LoadSceneInPlayMode(s.path, new LoadSceneParameters(LoadSceneMode.Single));
            return;
        }
#endif
        Debug.LogWarning("[GameMenu] Salve a cena e adicione-a em File > Build Settings para reiniciar a partida.");
        MatchSettings.StartImmediately = false;
    }

    static void Quit()
    {
        MatchSettings.Save();
#if UNITY_EDITOR
        UnityEditor.EditorApplication.isPlaying = false;
#else
        Application.Quit();
#endif
    }

    // ------------------------------------------------------------------ Câmera do menu

    void CreateMenuCamera()
    {
        var go = new GameObject("MenuCamera");
        menuCamera = go.AddComponent<Camera>();
        menuCamera.depth = 50; // por cima de câmeras de jogadores montados na cena
        menuCamera.clearFlags = CameraClearFlags.SolidColor;
        menuCamera.backgroundColor = new Color(0.02f, 0.02f, 0.035f);
        menuCamera.fieldOfView = 50f;
        if (FindObjectOfType<AudioListener>() == null) go.AddComponent<AudioListener>();
        UpdateMenuCamera();
    }

    void UpdateMenuCamera()
    {
        if (menuCamera == null) return;
        float a = Time.unscaledTime * menuOrbitSpeed * Mathf.Deg2Rad;
        Vector3 pos = menuOrbitCenter + new Vector3(Mathf.Sin(a) * menuOrbitRadius, menuOrbitHeight, Mathf.Cos(a) * menuOrbitRadius);
        menuCamera.transform.position = pos;
        menuCamera.transform.LookAt(menuOrbitCenter);
    }

    // ------------------------------------------------------------------ Desenho

    void OnGUI()
    {
        GUI.depth = -10; // por cima do GameHUD
        UITheme.Begin();

        switch (screen)
        {
            case MenuScreen.None: DrawPauseHint(); break;
            case MenuScreen.Main: DrawMain(); break;
            case MenuScreen.Setup: DrawSetup(); break;
            case MenuScreen.Options: DrawOptions(); break;
            case MenuScreen.Controls: DrawControls(); break;
            case MenuScreen.Pause: DrawPause(); break;
            case MenuScreen.Results: DrawResults(); break;
        }
    }

    /// <summary>Fundo dos submenus: sobre o jogo escurecido (pausa) ou sobre a mansão orbitando (menu principal).</summary>
    void Backdrop()
    {
        if (matchStarted) UITheme.Fill(new Rect(0, 0, UITheme.Width, UITheme.Height), new Color(0f, 0f, 0f, 0.62f));
        else UITheme.SideShade(UITheme.Width, 0.55f);
        UITheme.Vignette(0.9f);
    }

    static Rect CenterPanel(float w, float h) => new Rect((UITheme.Width - w) * 0.5f, (UITheme.Height - h) * 0.5f, w, h);

    void DrawPauseHint()
    {
        if (!MatchRunning) return;
        UITheme.Text(new Rect(20, 18, 300, 26), $"Esc ou {altPauseKey}  ·  Pausar", UITheme.Small, new Color(1f, 1f, 1f, 0.45f));

        // No navegador o mouse só é preso depois de um clique na página.
        if (IsWebGL && !PointerLocked)
        {
            Rect r = new Rect(UITheme.Width * 0.5f - 330, UITheme.Height * 0.62f, 660, 64);
            UITheme.Fill(r, new Color(0f, 0f, 0f, 0.65f));
            UITheme.Text(r, "Clique na tela para controlar o personagem", UITheme.BodyCenter, UITheme.Gold);
        }
    }

    void DrawMain()
    {
        UITheme.SideShade(UITheme.Width * 0.62f, 0.95f);
        UITheme.Vignette(0.85f);

        const float x = 140f;
        // Título com leve tremulação de vela
        float flicker = 0.82f + 0.18f * Mathf.PerlinNoise(Time.unscaledTime * 2.5f, 0.3f);
        Color gold = UITheme.Gold * flicker;
        gold.a = 1f;
        UITheme.Text(new Rect(x, 210, 1300, 130), "ECOS DO ALÉM", UITheme.Title, gold, true);
        UITheme.Text(new Rect(x + 4, 336, 1000, 40), "Uma caçada assimétrica numa mansão vitoriana", UITheme.Subtitle, UITheme.Muted);
        UITheme.Line(x + 4, 396, 440, UITheme.GoldDim);

        float y = 440f;
        const float bw = 440f, bh = 64f, gap = 80f;
        if (UITheme.Btn(new Rect(x, y, bw, bh), "Jogar", true)) screen = MenuScreen.Setup;
        y += gap;
        if (UITheme.Btn(new Rect(x, y, bw, bh), "Opções")) OpenSubScreen(MenuScreen.Options);
        y += gap;
        if (UITheme.Btn(new Rect(x, y, bw, bh), "Controles")) OpenSubScreen(MenuScreen.Controls);
        y += gap;
        if (CanQuit && UITheme.Btn(new Rect(x, y, bw, bh), "Sair")) Quit();

        UITheme.Text(new Rect(x, UITheme.Height - 76, 900, 30),
            $"{versionLabel}  ·  2 caçadores × 4 fantasmas  ·  58 móveis possuíveis", UITheme.Small, UITheme.Muted);
    }

    void DrawSetup()
    {
        Backdrop();
        Rect p = CenterPanel(1040, 800);
        UITheme.Box(p);
        float x = p.x + 48, w = p.width - 96, y = p.y + 34;

        UITheme.Text(new Rect(p.x, y, p.width, 56), "NOVA PARTIDA", UITheme.Heading, UITheme.Gold);
        y += 84;

        if (setup.HasScenePlayers)
        {
            UITheme.Text(new Rect(x, y, w, 200),
                "Os jogadores já estão montados nesta cena. O time e a quantidade seguem a cena; " +
                "aqui você escolhe só a duração e a Caçada Invertida.", UITheme.BodyCenter, UITheme.Muted);
            y += 230;
        }
        else
        {
            float cw = (w - 24f) * 0.5f;
            if (TeamCard(new Rect(x, y, cw, 210), "FANTASMA", UITheme.Spectral,
                    "Possua móveis, salte entre esconderijos e engane o EMF. Sobreviva à busca; depois, a caçada se inverte.",
                    MatchSettings.Team == PlayerTeam.Ghost))
                MatchSettings.Team = PlayerTeam.Ghost;
            if (TeamCard(new Rect(x + cw + 24, y, cw, 210), "CAÇADOR", UITheme.Gold,
                    "Siga o EMF e as pegadas na câmera térmica, feche passagens com sal e exorcize todos com o aspirador.",
                    MatchSettings.Team == PlayerTeam.Hunter))
                MatchSettings.Team = PlayerTeam.Hunter;
            y += 240;

            MatchSettings.Ghosts = 1 + UITheme.Selector(new Rect(x, y, w, 58), "Fantasmas na mansão",
                GhostCountLabels, MatchSettings.Ghosts - 1);
            y += 66;
            MatchSettings.Hunters = 1 + UITheme.Selector(new Rect(x, y, w, 58), "Caçadores",
                HunterCountLabels, MatchSettings.Hunters - 1);
            y += 66;
        }

        string[] minutes = new string[MatchSettings.RoundMinuteOptions.Length];
        for (int i = 0; i < minutes.Length; i++) minutes[i] = MatchSettings.RoundMinuteOptions[i] + " min";
        int mi = System.Array.IndexOf(MatchSettings.RoundMinuteOptions, MatchSettings.RoundMinutes);
        mi = UITheme.Selector(new Rect(x, y, w, 58), "Duração da busca", minutes, Mathf.Max(0, mi));
        MatchSettings.RoundMinutes = MatchSettings.RoundMinuteOptions[mi];
        y += 66;
        MatchSettings.Reversal = UITheme.Selector(new Rect(x, y, w, 58), "Caçada Invertida", OnOff, MatchSettings.Reversal ? 0 : 1) == 0;
        y += 74;

        if (!setup.HasScenePlayers)
            UITheme.Text(new Rect(x, y, w, 52),
                "Modo treino: ainda não há multiplayer em rede, então os outros jogadores ficam parados nos seus spawns.",
                UITheme.SmallCenter, UITheme.Muted);

        float by = p.yMax - 96;
        if (UITheme.Btn(new Rect(x, by, 260, 62), "Voltar")) screen = MenuScreen.Main;
        if (UITheme.Btn(new Rect(x + w - 360, by, 360, 62), "Começar partida", true)) StartMatch();
    }

    static bool TeamCard(Rect r, string title, Color accent, string description, bool selected)
    {
        bool clicked = GUI.Button(UITheme.R(r), GUIContent.none, selected ? UITheme.CardSelected : UITheme.Card);
        UITheme.Fill(new Rect(r.x + 3, r.y + 3, 6, r.height - 6), selected ? accent : new Color(accent.r, accent.g, accent.b, 0.25f));
        UITheme.Text(new Rect(r.x + 32, r.y + 22, r.width - 56, 44), title, UITheme.Heading, selected ? accent : UITheme.TextColor);
        UITheme.Text(new Rect(r.x + 32, r.y + 76, r.width - 56, 116), description, UITheme.BodyCenter,
            selected ? UITheme.TextColor : UITheme.Muted);
        return clicked;
    }

    void DrawOptions()
    {
        Backdrop();
        Rect p = CenterPanel(920, 640);
        UITheme.Box(p);
        float x = p.x + 52, w = p.width - 104, y = p.y + 34;

        UITheme.Text(new Rect(p.x, y, p.width, 56), "OPÇÕES", UITheme.Heading, UITheme.Gold);
        y += 96;

        float sens = UITheme.Slider(new Rect(x, y, w, 52), "Sensibilidade do mouse",
            MatchSettings.Sensitivity, 0.25f, 3f, $"{MatchSettings.Sensitivity:0.00}×");
        y += 66;
        float master = UITheme.Slider(new Rect(x, y, w, 52), "Volume geral",
            MatchSettings.MasterVolume, 0f, 1f, $"{Mathf.RoundToInt(MatchSettings.MasterVolume * 100)}%");
        y += 66;
        float ambient = UITheme.Slider(new Rect(x, y, w, 52), "Som ambiente da mansão",
            MatchSettings.AmbientVolume, 0f, 1f, $"{Mathf.RoundToInt(MatchSettings.AmbientVolume * 100)}%");
        y += 74;

        if (!Mathf.Approximately(sens, MatchSettings.Sensitivity) || !Mathf.Approximately(master, MatchSettings.MasterVolume)
            || !Mathf.Approximately(ambient, MatchSettings.AmbientVolume))
        {
            MatchSettings.Sensitivity = sens;
            MatchSettings.MasterVolume = master;
            MatchSettings.AmbientVolume = ambient;
            MatchSettings.Apply();
        }

        int fs = UITheme.Selector(new Rect(x, y, w, 58), "Tela cheia", YesNo, Screen.fullScreen ? 0 : 1);
        if ((fs == 0) != Screen.fullScreen) Screen.fullScreen = fs == 0;
        y += 66;

        string[] q = QualitySettings.names;
        if (q.Length > 0)
        {
            int cur = QualitySettings.GetQualityLevel();
            int nq = UITheme.Selector(new Rect(x, y, w, 58), "Qualidade gráfica", q, cur);
            if (nq != cur) QualitySettings.SetQualityLevel(nq, true);
        }

        if (UITheme.Btn(new Rect(p.x + (p.width - 300) * 0.5f, p.yMax - 96, 300, 62), "Voltar"))
        {
            MatchSettings.Save();
            screen = returnScreen;
        }
    }

    void DrawControls()
    {
        Backdrop();
        Rect p = CenterPanel(1360, 760);
        UITheme.Box(p);
        UITheme.Text(new Rect(p.x, p.y + 34, p.width, 56), "CONTROLES", UITheme.Heading, UITheme.Gold);

        float colW = (p.width - 52 * 2 - 60) * 0.5f;
        float x1 = p.x + 52, x2 = x1 + colW + 60, top = p.y + 124;

        UITheme.Text(new Rect(x1, top, colW, 36), "FANTASMA  ·  3ª pessoa", UITheme.Body, UITheme.Spectral);
        UITheme.Line(x1, top + 42, colW, new Color(UITheme.Spectral.r, UITheme.Spectral.g, UITheme.Spectral.b, 0.4f));
        string[,] ghost =
        {
            { "W A S D", "Mover" },
            { "Mouse", "Câmera" },
            { "E", "Possuir o móvel mirado / sair" },
            { "Espaço", "Sair do móvel" },
            { "Q", "Salto Espectral (até 6 m)" },
            { "R", "Assombração Ativa · bater porta" },
            { "Botão esq.", "Toque Gélido (Caçada Invertida)" },
        };
        for (int i = 0; i < ghost.GetLength(0); i++) UITheme.KeyRow(x1, top + 62 + i * 54, colW, ghost[i, 0], ghost[i, 1]);

        UITheme.Text(new Rect(x2, top, colW, 36), "CAÇADOR  ·  1ª pessoa", UITheme.Body, UITheme.Gold);
        UITheme.Line(x2, top + 42, colW, new Color(UITheme.Gold.r, UITheme.Gold.g, UITheme.Gold.b, 0.4f));
        string[,] hunter =
        {
            { "W A S D", "Andar" },
            { "Shift", "Correr (gasta estamina)" },
            { "Botão esq.", "Aspirador Ectoplásmico" },
            { "Botão dir.", "Mirar" },
            { "E", "Abrir / fechar porta" },
            { "F  ·  T", "Lanterna  ·  Câmera Térmica/UV" },
            { "G", "Sal Purificador (3 cargas)" },
        };
        for (int i = 0; i < hunter.GetLength(0); i++) UITheme.KeyRow(x2, top + 62 + i * 54, colW, hunter[i, 0], hunter[i, 1]);

        UITheme.Text(new Rect(p.x, p.yMax - 150, p.width, 30),
            "Regra dos 20 s: o fantasma não pode ficar no mesmo móvel (ou num raio de 2 m) por mais de 20 segundos.",
            UITheme.SmallCenter, UITheme.Muted);

        if (UITheme.Btn(new Rect(p.x + (p.width - 300) * 0.5f, p.yMax - 96, 300, 62), "Voltar")) screen = returnScreen;
    }

    void DrawPause()
    {
        UITheme.Fill(new Rect(0, 0, UITheme.Width, UITheme.Height), new Color(0f, 0f, 0f, 0.6f));
        UITheme.Vignette(0.9f);

        Rect p = CenterPanel(560, 620);
        UITheme.Box(p);
        UITheme.Text(new Rect(p.x, p.y + 34, p.width, 56), "PAUSADO", UITheme.Heading, UITheme.Gold);
        UITheme.Text(new Rect(p.x, p.y + 92, p.width, 30), PhaseLabel(), UITheme.SmallCenter, UITheme.Muted);

        float x = p.x + 70, w = p.width - 140, y = p.y + 150;
        const float bh = 62f, gap = 78f;
        if (UITheme.Btn(new Rect(x, y, w, bh), "Continuar", true)) Resume();
        y += gap;
        if (UITheme.Btn(new Rect(x, y, w, bh), "Opções")) OpenSubScreen(MenuScreen.Options);
        y += gap;
        if (UITheme.Btn(new Rect(x, y, w, bh), "Controles")) OpenSubScreen(MenuScreen.Controls);
        y += gap;
        if (UITheme.Btn(new Rect(x, y, w, bh), "Reiniciar partida")) ReloadScene(true);
        y += gap;
        if (UITheme.Btn(new Rect(x, y, w, bh), "Menu principal")) ReloadScene(false);
    }

    string PhaseLabel()
    {
        if (manager == null) return "";
        switch (manager.Phase)
        {
            case MatchPhase.Hiding: return $"Fase de esconderijo  ·  {Clock(manager.HidePhaseRemaining)}";
            case MatchPhase.Hunting: return $"Busca  ·  {Clock(manager.TimeRemaining)} restantes";
            case MatchPhase.Reversal: return $"Caçada Invertida  ·  {Clock(manager.ReversalRemaining)} restantes";
            default: return "";
        }
    }

    void DrawResults()
    {
        float fade = Mathf.Clamp01((Time.unscaledTime - resultsShownAt) / 0.6f);
        UITheme.Fill(new Rect(0, 0, UITheme.Width, UITheme.Height), new Color(0f, 0f, 0f, 0.72f * fade));
        UITheme.Vignette(0.9f * fade);
        if (manager == null) return;

        bool ghostsWon = manager.GhostsWon;
        Color accent = ghostsWon ? UITheme.Spectral : UITheme.Gold;
        accent.a = fade;
        float cx = UITheme.Width * 0.5f;

        UITheme.Text(new Rect(0, 170, UITheme.Width, 120), ghostsWon ? "VITÓRIA DOS FANTASMAS" : "VITÓRIA DOS CAÇADORES",
            UITheme.Heading, accent, true);
        UITheme.Text(new Rect(0, 268, UITheme.Width, 40), manager.WinReason, UITheme.BodyCenter, new Color(1f, 1f, 1f, 0.85f * fade));

        PlayerTeam? team = setup.LocalTeam;
        if (team.HasValue)
        {
            bool won = (team.Value == PlayerTeam.Ghost) == ghostsWon;
            Color c = won ? UITheme.Gold : UITheme.Blood;
            c.a = fade;
            UITheme.Text(new Rect(0, 318, UITheme.Width, 44), won ? "Você venceu!" : "Você perdeu.", UITheme.BodyCenter, c);
        }

        Rect p = new Rect(cx - 340, 400, 680, 250);
        UITheme.Box(p);
        float y = p.y + 30, lx = p.x + 50, lw = p.width - 100;
        StatRow(lx, ref y, lw, "Fantasmas livres", $"{manager.AliveGhosts} / {manager.ghosts.Count}");
        StatRow(lx, ref y, lw, "Caçadores de pé", $"{manager.AliveHunters} / {manager.hunters.Count}");
        StatRow(lx, ref y, lw, "Duração da partida", Clock(matchEndTime - matchStartTime));
        StatRow(lx, ref y, lw, "Seu destino", PersonalFate());

        // Três botões centralizados; sem "Sair" (WebGL), os dois restantes continuam centralizados.
        float by = p.yMax + 50, bw = 300f, gap = 20f;
        int count = CanQuit ? 3 : 2;
        float bx = cx - (count * bw + (count - 1) * gap) * 0.5f;
        if (UITheme.Btn(new Rect(bx, by, bw, 64), "Jogar de novo", true)) ReloadScene(true);
        bx += bw + gap;
        if (UITheme.Btn(new Rect(bx, by, bw, 64), "Menu principal")) ReloadScene(false);
        bx += bw + gap;
        if (CanQuit && UITheme.Btn(new Rect(bx, by, bw, 64), "Sair")) Quit();
    }

    static void StatRow(float x, ref float y, float w, string label, string value)
    {
        UITheme.Text(new Rect(x, y, w * 0.6f, 40), label, UITheme.Body, UITheme.Muted);
        UITheme.Text(new Rect(x + w * 0.6f, y, w * 0.4f, 40), value, UITheme.Body, UITheme.TextColor);
        y += 48;
    }

    string PersonalFate()
    {
        if (setup.LocalGhost != null) return setup.LocalGhost.IsExorcised ? "Exorcizado" : "Escapou";
        if (setup.LocalHunter != null) return setup.LocalHunter.IsDead ? "Pego pelos fantasmas" : "Sobreviveu";
        return "Espectador";
    }

    static string Clock(float seconds)
    {
        int s = Mathf.Max(0, Mathf.CeilToInt(seconds));
        return $"{s / 60}:{s % 60:00}";
    }
}
