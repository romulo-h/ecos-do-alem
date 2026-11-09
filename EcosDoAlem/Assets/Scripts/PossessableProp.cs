using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public enum PropCategory
{
    Decoracao,
    Assento,
    Armazenamento,
    Iluminacao,
    Sanitario,
    Hidraulica,
    Dormitorio,
    Louca,   // copos, taças: tilintam ao serem assombrados
    Planta   // vasos de planta: folhas farfalham
}

/// <summary>
/// Móvel que pode ser possuído por um fantasma.
/// Não depende de Tag nem de Layer: todos os móveis ficam registrados em PossessableProp.All.
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(Collider))]
public class PossessableProp : MonoBehaviour
{
    public static readonly List<PossessableProp> All = new List<PossessableProp>();

    [Header("Identificação do Objeto")]
    public string propId = "";
    public string propName = "Móvel Vitoriano";
    public string roomName = "Sala Indefinida";
    public int floorIndex = 0;
    public PropCategory category = PropCategory.Decoracao;

    [Header("Efeitos & Habilidades Únicas")]
    [Tooltip("Vapor do chuveiro, faíscas do candelabro, água da pia...")]
    public ParticleSystem specialEffectParticles;
    [Tooltip("Luz que pisca quando o lustre/candelabro é assombrado.")]
    public Light linkedLight;
    public AudioSource propAudioSource;
    public AudioClip possessSound;
    [Tooltip("Descarga, molas da cama, estalo do candelabro... (padrão: interacao_movel_assombrado.wav)")]
    public AudioClip hauntActionSound;
    [Tooltip("Som contínuo do objeto, ex.: relogio_pendulo_tic_tac.wav no relógio.")]
    public AudioClip idleLoopSound;

    [Header("Apoio")]
    [Tooltip("Móvel sobre o qual este objeto está (ex.: copo sobre a mesa). Preenchido pelo loader via on_top_of.")]
    public PossessableProp supportedBy;

    [Header("Assombração Ativa / Isca para o EMF")]
    [Tooltip("Por quantos segundos o móvel continua 'acendendo' o EMF depois de assombrado, mesmo sem fantasma dentro.")]
    public float decoyEmfDuration = 6f;
    public float hauntShakeDuration = 0.8f;

    // ---- Estado ----
    private GhostController currentGhost;
    private Vector3 originalPosition;
    private Quaternion originalRotation;
    private float trembleIntensity;
    private float shakeIntensity;
    private float shakeUntil;
    private float decoyEmfUntil = -999f;
    private bool displaced;
    private Coroutine flickerRoutine;

    public bool isPossessed => currentGhost != null;
    public GhostController CurrentGhost => currentGhost;
    /// <summary>Verdadeiro se o EMF deve detectar este móvel (possuído ou isca recente).</summary>
    public bool IsEmfActive => isPossessed || Time.time < decoyEmfUntil;
    public Collider PropCollider { get; private set; }
    public Vector3 Center => PropCollider != null ? PropCollider.bounds.center : transform.position;

    void Awake()
    {
        PropCollider = GetComponent<Collider>();
        originalPosition = transform.position;
        originalRotation = transform.rotation;

        if (propAudioSource == null)
            propAudioSource = GetComponent<AudioSource>();
    }

    void OnEnable() { if (!All.Contains(this)) All.Add(this); }
    void OnDisable() { All.Remove(this); }

    void Start()
    {
        if (idleLoopSound != null && propAudioSource != null)
        {
            propAudioSource.clip = idleLoopSound;
            propAudioSource.loop = true;
            propAudioSource.Play();
        }
    }

    void Update()
    {
        float intensity = trembleIntensity;
        if (Time.time < shakeUntil) intensity = Mathf.Max(intensity, shakeIntensity);

        if (intensity > 0f)
        {
            transform.position = originalPosition + Random.insideUnitSphere * intensity;
            displaced = true;
        }
        else if (displaced)
        {
            transform.position = originalPosition;
            transform.rotation = originalRotation;
            displaced = false;
        }
    }

    /// <summary>Distância de um ponto até a superfície do móvel (útil para móveis grandes).</summary>
    public float DistanceTo(Vector3 point)
    {
        if (PropCollider == null) return Vector3.Distance(point, transform.position);
        return Vector3.Distance(point, PropCollider.bounds.ClosestPoint(point));
    }

    public bool TryPossess(GhostController ghost)
    {
        if (isPossessed || ghost == null) return false;

        currentGhost = ghost;

        if (propAudioSource != null && possessSound != null)
            propAudioSource.PlayOneShot(possessSound);

        return true;
    }

    public void Release()
    {
        currentGhost = null;
        trembleIntensity = 0f;

        if (specialEffectParticles != null && specialEffectParticles.isPlaying)
            specialEffectParticles.Stop();
    }

    /// <summary>Tremor contínuo (aviso de instabilidade 15s–20s). Use 0 para parar.
    /// Objetos apoiados em cima (copos) tremem junto, um pouco menos.</summary>
    public void SetTremble(float intensity)
    {
        trembleIntensity = Mathf.Max(0f, intensity);
        foreach (var other in All)
            if (other != null && other.supportedBy == this && !other.isPossessed)
                other.trembleIntensity = trembleIntensity * 0.4f;
    }

    /// <summary>Sacudida curta com o som próprio, sem isca de EMF (usada quando o apoio é assombrado).</summary>
    public void Jiggle(float intensity, float duration)
    {
        shakeIntensity = intensity;
        shakeUntil = Time.time + duration;
        if (propAudioSource != null && hauntActionSound != null)
            propAudioSource.PlayOneShot(hauntActionSound, 0.6f);
    }

    /// <summary>
    /// Assombração Ativa. Pode ser disparada pelo fantasma de dentro do móvel ou à distância.
    /// Deixa uma "isca" no EMF por decoyEmfDuration segundos para enganar os caçadores.
    /// </summary>
    public void TriggerHauntAction()
    {
        decoyEmfUntil = Time.time + decoyEmfDuration;

        if (specialEffectParticles != null)
            specialEffectParticles.Play();

        if (propAudioSource != null && hauntActionSound != null)
            propAudioSource.PlayOneShot(hauntActionSound);

        float intensity;
        switch (category)
        {
            case PropCategory.Iluminacao: // Candelabro pisca e emite faíscas
                intensity = 0.04f;
                if (linkedLight != null)
                {
                    if (flickerRoutine != null) StopCoroutine(flickerRoutine);
                    flickerRoutine = StartCoroutine(FlickerLight(1.5f));
                }
                break;
            case PropCategory.Sanitario:  intensity = 0.02f; break;  // descarga barulhenta
            case PropCategory.Hidraulica: intensity = 0.01f; break;  // água / vapor
            case PropCategory.Dormitorio: intensity = 0.035f; break; // cama range
            case PropCategory.Louca:      intensity = 0.006f; break; // copo tilinta (objeto pequeno: tremor curto)
            case PropCategory.Planta:     intensity = 0.03f; break;  // folhas balançam
            default:                      intensity = 0.02f; break;
        }

        shakeIntensity = intensity;
        shakeUntil = Time.time + hauntShakeDuration;

        // Copos e objetos em cima tilintam e sacodem junto
        foreach (var other in All)
            if (other != null && other != this && other.supportedBy == this)
                other.Jiggle(0.006f, hauntShakeDuration);
    }

    IEnumerator FlickerLight(float duration)
    {
        bool initial = linkedLight.enabled;
        float end = Time.time + duration;
        while (Time.time < end)
        {
            linkedLight.enabled = !linkedLight.enabled;
            yield return new WaitForSeconds(Random.Range(0.04f, 0.15f));
        }
        linkedLight.enabled = initial;
        flickerRoutine = null;
    }

    /// <summary>Converte a categoria textual do props_layout.json para o enum.</summary>
    public static PropCategory ParseCategory(string value)
    {
        switch ((value ?? "").Trim().ToLowerInvariant())
        {
            case "decor":
            case "decoracao":
            case "decoração":     return PropCategory.Decoracao;
            case "assento":       return PropCategory.Assento;
            case "armazenamento": return PropCategory.Armazenamento;
            case "iluminacao":
            case "iluminação":    return PropCategory.Iluminacao;
            case "sanitario":
            case "sanitário":     return PropCategory.Sanitario;
            case "hidraulica":
            case "hidráulica":    return PropCategory.Hidraulica;
            case "dormitorio":
            case "dormitório":    return PropCategory.Dormitorio;
            case "louca":
            case "louça":         return PropCategory.Louca;
            case "planta":        return PropCategory.Planta;
            default:
                Debug.LogWarning($"[PossessableProp] Categoria desconhecida '{value}', usando Decoracao.");
                return PropCategory.Decoracao;
        }
    }
}
