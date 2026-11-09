using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public enum MatchPhase { Waiting, Hiding, Hunting, Reversal, Ended }

/// <summary>
/// Controla a partida: esconderijo (15 s) → busca dos caçadores (6 min) → Caçada Invertida (2 min) → fim.
/// Caçada Invertida: quando a busca acaba com fantasmas vivos, eles saem dos móveis e caçam os caçadores,
/// que ficam sem o aspirador e precisam fugir. Fantasmas vencem se todos os caçadores forem pegos;
/// caçadores vencem se sobreviverem até o fim ou se exorcizarem todos os fantasmas antes.
/// (A classe HunterController duplicada que existia neste arquivo foi removida — causava erro CS0101.)
/// </summary>
public class GhostGameManager : MonoBehaviour
{
    public static GhostGameManager Instance { get; private set; }

    [Header("Configurações da Partida")]
    public float roundDuration = 360f; // 6 minutos
    public float hidePhaseDuration = 15f;
    [Tooltip("Se falso, os 15 s de esconderijo NÃO são descontados dos 6 minutos de caçada.")]
    public bool hidePhaseCountsTowardRound = false;
    public bool autoStart = true;
    [Tooltip("Preenche as listas automaticamente com todos os fantasmas/caçadores da cena.")]
    public bool autoFindPlayers = true;

    [Header("Caçada Invertida")]
    public bool enableReversal = true;
    public float reversalDuration = 120f;
    public AudioClip reversalSting; // inversao_cacada.wav
    [Range(0.5f, 1f)] public float reversalAmbientPitch = 0.85f;

    [Header("Times")]
    public List<GhostController> ghosts = new List<GhostController>();
    public List<HunterController> hunters = new List<HunterController>();

    [Header("Áudio Ambiente")]
    public AudioSource ambientSource;
    public AudioClip ambientDrone; // mansao_drone_ambiente.wav
    [Range(0f, 1f)] public float ambientVolume = 0.5f;

    public MatchPhase Phase { get; private set; } = MatchPhase.Waiting;
    public float TimeRemaining { get; private set; }
    public float HidePhaseRemaining { get; private set; }
    public bool GhostsWon { get; private set; }
    public int AliveGhosts { get; private set; }
    public int AliveHunters { get; private set; }
    public float ReversalRemaining { get; private set; }
    public float ReversalElapsed => Phase == MatchPhase.Reversal ? reversalDuration - ReversalRemaining : 0f;
    public string WinReason { get; private set; } = "";

    public event Action<MatchPhase> PhaseChanged;
    public event Action<bool> MatchEnded; // true = fantasmas venceram

    void Awake()
    {
        Instance = this;
    }

    void OnDestroy()
    {
        if (Instance == this) Instance = null;
    }

    void Start()
    {
        if (autoFindPlayers)
        {
            if (ghosts.Count == 0) ghosts.AddRange(FindObjectsOfType<GhostController>());
            if (hunters.Count == 0) hunters.AddRange(FindObjectsOfType<HunterController>());
        }

        if (ambientDrone != null)
        {
            if (ambientSource == null) ambientSource = gameObject.AddComponent<AudioSource>();
            ambientSource.clip = ambientDrone;
            ambientSource.loop = true;
            ambientSource.spatialBlend = 0f;
            ambientSource.volume = ambientVolume;
            ambientSource.Play();
        }

        if (autoStart) StartMatch();
    }

    public void StartMatch()
    {
        StopAllCoroutines();
        TimeRemaining = roundDuration;
        ReversalRemaining = reversalDuration;
        GhostsWon = false;
        WinReason = "";
        if (ambientSource != null) ambientSource.pitch = 1f;
        foreach (var g in ghosts) if (g != null) { g.inputEnabled = true; g.SetHuntMode(false); }
        foreach (var h in hunters) if (h != null) h.SetFleeMode(false);
        StartCoroutine(HidePhaseRoutine());
    }

    IEnumerator HidePhaseRoutine()
    {
        SetPhase(MatchPhase.Hiding);
        foreach (var hunter in hunters) if (hunter != null) hunter.SetCanMove(false);

        HidePhaseRemaining = hidePhaseDuration;
        while (HidePhaseRemaining > 0f)
        {
            HidePhaseRemaining -= Time.deltaTime;
            yield return null;
        }
        HidePhaseRemaining = 0f;

        foreach (var hunter in hunters) if (hunter != null) hunter.SetCanMove(true);
        SetPhase(MatchPhase.Hunting);
    }

    void Update()
    {
        if (Phase != MatchPhase.Hiding && Phase != MatchPhase.Hunting && Phase != MatchPhase.Reversal) return;

        if (Phase == MatchPhase.Hunting || (Phase == MatchPhase.Hiding && hidePhaseCountsTowardRound))
            TimeRemaining = Mathf.Max(0f, TimeRemaining - Time.deltaTime);

        int aliveG = 0, aliveH = 0;
        foreach (var ghost in ghosts) if (ghost != null && !ghost.IsExorcised) aliveG++;
        foreach (var hunter in hunters) if (hunter != null && !hunter.IsDead) aliveH++;
        AliveGhosts = aliveG;
        AliveHunters = aliveH;

        // Caçadores vencem: todos os fantasmas exorcizados
        if (ghosts.Count > 0 && aliveG == 0) { EndMatch(false, "Todos os espíritos foram exorcizados"); return; }
        // Fantasmas vencem: todos os caçadores mortos
        if (hunters.Count > 0 && aliveH == 0) { EndMatch(true, "Todos os caçadores foram pegos"); return; }

        if (Phase == MatchPhase.Reversal)
        {
            ReversalRemaining = Mathf.Max(0f, ReversalRemaining - Time.deltaTime);
            if (ReversalRemaining <= 0f) EndMatch(false, "Os caçadores sobreviveram à Caçada Invertida");
            return;
        }

        // Fim da busca com fantasmas vivos: começa a Caçada Invertida (ou, se desligada, os fantasmas vencem)
        if (TimeRemaining <= 0f)
        {
            if (enableReversal) StartReversal();
            else EndMatch(true, "O tempo acabou");
        }
    }

    void StartReversal()
    {
        StopAllCoroutines();
        ReversalRemaining = reversalDuration;
        SetPhase(MatchPhase.Reversal);
        foreach (var g in ghosts) if (g != null && !g.IsExorcised) g.SetHuntMode(true);
        foreach (var h in hunters) if (h != null) { h.SetCanMove(true); h.SetFleeMode(true); }

        if (ambientSource != null) ambientSource.pitch = reversalAmbientPitch;
        if (reversalSting != null)
        {
            if (ambientSource != null) ambientSource.PlayOneShot(reversalSting);
            else AudioSource.PlayClipAtPoint(reversalSting, Camera.main != null ? Camera.main.transform.position : Vector3.zero);
        }
        Debug.Log("A CAÇADA SE INVERTEU! Os fantasmas agora caçam os caçadores.");
    }

    void EndMatch(bool ghostsWon, string reason)
    {
        StopAllCoroutines();
        GhostsWon = ghostsWon;
        WinReason = reason;
        SetPhase(MatchPhase.Ended);

        foreach (var h in hunters) if (h != null) h.SetCanMove(false);
        foreach (var g in ghosts) if (g != null) g.inputEnabled = false;

        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;

        Debug.Log((ghostsWon ? "Vitória dos Fantasmas! " : "Vitória dos Caçadores! ") + reason);
        MatchEnded?.Invoke(ghostsWon);
    }

    void SetPhase(MatchPhase p)
    {
        Phase = p;
        PhaseChanged?.Invoke(p);
    }
}
