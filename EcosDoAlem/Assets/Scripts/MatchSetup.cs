using UnityEngine;

/// <summary>
/// Monta a partida escolhida no menu: cria o jogador local (com câmera, lanterna, aspirador e áudio)
/// e os demais participantes, coloca todos nos pontos de spawn e inicia o GhostGameManager.
///
/// Se a cena já tiver fantasmas/caçadores montados à mão (guia, seção 3), eles são usados como estão
/// e nada é criado.
///
/// Sem multiplayer em rede, os outros participantes ficam parados (isLocallyControlled = false):
/// o menu chama isso de modo treino.
/// </summary>
public class MatchSetup : MonoBehaviour
{
    public GhostGameManager manager;
    public MansionLayoutLoader loader;
    public GameHUD hud;

    [Header("Sons dos jogadores criados (preenchidos sozinhos no editor a partir de Assets/Audio)")]
    public AudioClip emfBeepClip;          // emf_detector_beep.wav
    public AudioClip hunterHurtClip;       // cacador_ferido.wav
    public AudioClip ghostAttackClip;      // ataque_fantasma.wav
    public AudioClip instabilityAlertClip; // fantasma_instabilidade_alerta.wav
    public AudioClip forcedEjectClip;      // fantasma_ejecao_forcada.wav

    [Header("Corpo (CharacterController)")]
    public float hunterHeight = 1.8f;
    public float hunterRadius = 0.35f;
    public float ghostHeight = 1.6f;
    public float ghostRadius = 0.35f;

    [Header("Lanterna do caçador")]
    public float flashlightRange = 18f;
    public float flashlightAngle = 55f;
    public float flashlightIntensity = 2.2f;

    /// <summary>A cena já tinha jogadores montados antes do menu.</summary>
    public bool HasScenePlayers { get; private set; }
    public GhostController LocalGhost { get; private set; }
    public HunterController LocalHunter { get; private set; }
    /// <summary>Time do jogador local, ou null se nenhum personagem é controlado localmente.</summary>
    public PlayerTeam? LocalTeam => LocalHunter != null ? PlayerTeam.Hunter : LocalGhost != null ? PlayerTeam.Ghost : (PlayerTeam?)null;

    static Material beamMaterial;
    bool spawned;

    void Awake()
    {
        if (manager == null) manager = GetComponent<GhostGameManager>();
        if (manager == null) manager = FindObjectOfType<GhostGameManager>();
        if (loader == null) loader = FindObjectOfType<MansionLayoutLoader>();
        if (hud == null) hud = FindObjectOfType<GameHUD>();

        SpectralVisibility.Visible = false; // estado estático que pode ter sobrado da partida anterior
        HasScenePlayers = FindObjectsOfType<GhostController>().Length + FindObjectsOfType<HunterController>().Length > 0;
    }

    /// <summary>Cria os jogadores (se preciso), posiciona e começa a partida.</summary>
    public void BeginMatch()
    {
        if (!HasScenePlayers && !spawned)
        {
            SpawnTeams();
            spawned = true;
        }

        if (loader != null) loader.PlacePlayersAtSpawnPoints();
        FaceMansionCenter();
        FindLocalPlayer();

        if (manager != null)
        {
            manager.ghosts.Clear();
            manager.ghosts.AddRange(FindObjectsOfType<GhostController>());
            manager.hunters.Clear();
            manager.hunters.AddRange(FindObjectsOfType<HunterController>());
            manager.roundDuration = MatchSettings.RoundMinutes * 60f;
            manager.enableReversal = MatchSettings.Reversal;
        }

        MatchSettings.Apply();
        if (hud != null) hud.Bind(manager, LocalGhost, LocalHunter);
        if (manager != null) manager.StartMatch();
    }

    void SpawnTeams()
    {
        bool playGhost = MatchSettings.Team == PlayerTeam.Ghost;
        int hunters = Mathf.Clamp(MatchSettings.Hunters, playGhost ? 0 : 1, MatchSettings.MaxHunters);
        int ghosts = Mathf.Clamp(MatchSettings.Ghosts, playGhost ? 1 : 0, MatchSettings.MaxGhosts);

        for (int i = 0; i < hunters; i++) CreateHunter(i, !playGhost && i == 0);
        for (int i = 0; i < ghosts; i++) CreateGhost(i, playGhost && i == 0);
    }

    void FindLocalPlayer()
    {
        LocalGhost = null;
        LocalHunter = null;
        foreach (var h in FindObjectsOfType<HunterController>())
            if (h.isLocallyControlled) { LocalHunter = h; break; }
        if (LocalHunter == null)
            foreach (var g in FindObjectsOfType<GhostController>())
                if (g.isLocallyControlled) { LocalGhost = g; break; }
    }

    // ------------------------------------------------------------------ Caçador

    HunterController CreateHunter(int index, bool local)
    {
        // Criado desativado: o Awake do HunterController só roda depois que os campos estão preenchidos.
        var go = new GameObject(local ? "Cacador (Voce)" : $"Cacador {index + 1}");
        go.SetActive(false);
        go.transform.position = new Vector3(index * 1.5f, 0.05f, 0f);

        var cc = go.AddComponent<CharacterController>();
        cc.height = hunterHeight;
        cc.radius = hunterRadius;
        cc.center = new Vector3(0f, hunterHeight * 0.5f, 0f);

        var h = go.AddComponent<HunterController>();
        h.isLocallyControlled = local;
        h.hurtClip = hunterHurtClip;

        if (local)
        {
            var camGo = new GameObject("FirstPersonCamera");
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(go.transform, false);
            camGo.transform.localPosition = new Vector3(0f, h.eyeHeight, 0f);
            var cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.05f;
            camGo.AddComponent<AudioListener>();
            h.firstPersonCamera = camGo.transform;

            var lightGo = new GameObject("Flashlight");
            lightGo.transform.SetParent(camGo.transform, false);
            lightGo.transform.localPosition = new Vector3(0.18f, -0.12f, 0.1f);
            var lamp = lightGo.AddComponent<Light>();
            lamp.type = LightType.Spot;
            lamp.range = flashlightRange;
            lamp.spotAngle = flashlightAngle;
            lamp.intensity = flashlightIntensity;
            lamp.color = new Color(1f, 0.93f, 0.8f);
            lamp.shadows = LightShadows.Soft;
            h.flashlight = lamp;

            var beamGo = new GameObject("Weapon_ProtonBeam");
            beamGo.transform.SetParent(go.transform, false);
            var lr = beamGo.AddComponent<LineRenderer>();
            lr.positionCount = 2;
            lr.useWorldSpace = true;
            lr.widthMultiplier = 0.05f;
            Material mat = BeamMaterial();
            if (mat != null) lr.sharedMaterial = mat;
            lr.startColor = new Color(0.6f, 1f, 1f, 0.95f);
            lr.endColor = new Color(0.3f, 0.6f, 1f, 0.6f);
            lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            lr.receiveShadows = false;
            lr.enabled = false;
            h.protonBeam = lr;

            var emf = go.AddComponent<AudioSource>();
            emf.playOnAwake = false;
            emf.spatialBlend = 0f;
            h.emfAudioSource = emf;
            h.emfBeepClip = emfBeepClip;
        }

        go.SetActive(true);
        return h;
    }

    static Material BeamMaterial()
    {
        if (beamMaterial != null) return beamMaterial;
        Shader s = Shader.Find("Sprites/Default");
        if (s == null) s = Shader.Find("Unlit/Color");
        if (s != null) beamMaterial = new Material(s);
        return beamMaterial;
    }

    // ------------------------------------------------------------------ Fantasma

    GhostController CreateGhost(int index, bool local)
    {
        var go = new GameObject(local ? "Fantasma (Voce)" : $"Fantasma {index + 1}");
        go.SetActive(false);
        go.transform.position = new Vector3(index * 1.5f, 0.05f, 2f);

        var cc = go.AddComponent<CharacterController>();
        cc.height = ghostHeight;
        cc.radius = ghostRadius;
        cc.center = new Vector3(0f, ghostHeight * 0.5f, 0f);

        var g = go.AddComponent<GhostController>();
        g.isLocallyControlled = local;
        g.attackClip = ghostAttackClip;
        g.forcedEjectClip = forcedEjectClip;
        g.instabilityAlertClip = instabilityAlertClip;

        if (local)
        {
            var alerts = go.AddComponent<AudioSource>();
            alerts.playOnAwake = false;
            alerts.spatialBlend = 0f;
            g.localAudio = alerts;
        }

        go.SetActive(true);

        if (local)
        {
            // Câmera separada (não filha), como pede o guia: não treme junto com o móvel possuído.
            var camGo = new GameObject("Ghost_Camera");
            camGo.SetActive(false);
            camGo.tag = "MainCamera";
            camGo.AddComponent<Camera>().nearClipPlane = 0.05f;
            camGo.AddComponent<AudioListener>();
            var gc = camGo.AddComponent<GhostCamera>();
            gc.ghost = g;
            g.ghostCamera = camGo.transform;
            camGo.SetActive(true);
        }
        return g;
    }

    // ------------------------------------------------------------------ Posição inicial

    /// <summary>Vira cada jogador para o centro da mansão (os spawns ficam em volta da origem).</summary>
    void FaceMansionCenter()
    {
        foreach (var h in FindObjectsOfType<HunterController>()) Face(h.transform);
        foreach (var g in FindObjectsOfType<GhostController>())
        {
            Face(g.transform);
            // A GhostCamera lê o yaw inicial no Start (próximo frame), então já começa olhando para a frente.
            if (g.ghostCamera != null) g.ghostCamera.rotation = g.transform.rotation;
        }
    }

    static void Face(Transform t)
    {
        Vector3 d = -t.position;
        d.y = 0f;
        if (d.sqrMagnitude > 0.01f) t.rotation = Quaternion.LookRotation(d.normalized, Vector3.up);
    }

#if UNITY_EDITOR
    void Reset()
    {
        emfBeepClip = LoadClip("emf_detector_beep");
        hunterHurtClip = LoadClip("cacador_ferido");
        ghostAttackClip = LoadClip("ataque_fantasma");
        instabilityAlertClip = LoadClip("fantasma_instabilidade_alerta");
        forcedEjectClip = LoadClip("fantasma_ejecao_forcada");
    }

    static AudioClip LoadClip(string clipName) =>
        UnityEditor.AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/Audio/{clipName}.wav");
#endif
}
