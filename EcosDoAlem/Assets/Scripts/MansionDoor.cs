using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Porta com dobradiça (simples ou dupla).
///   • Caçador: tecla E abre/fecha (HunterController).
///   • Fantasma: atravessa portas fechadas (é um espírito) e pode BATER a porta com a Assombração Ativa (R).
/// Cada folha é um filho "Dobradica_*" que gira em Y; a folha em si é um BoxCollider.
/// </summary>
public class MansionDoor : MonoBehaviour
{
    public static readonly List<MansionDoor> All = new List<MansionDoor>();

    [Header("Estado")]
    public string doorId = "";
    public bool isOpen = false;
    public bool locked = false;
    [Tooltip("Fantasmas atravessam a porta fechada.")]
    public bool ghostsPassThrough = true;

    [Header("Movimento")]
    public float openAngle = 95f;
    public float openSpeed = 160f;   // graus/s
    public float slamSpeed = 900f;   // graus/s ao ser batida pelo fantasma
    [Tooltip("Folhas: dobradiças que giram. Preenchido pelo MansionLayoutLoader.")]
    public List<Transform> hinges = new List<Transform>();
    [Tooltip("+1 ou -1 por folha: sentido em que cada uma abre.")]
    public List<float> hingeSigns = new List<float>();

    [Header("Áudio")]
    public AudioSource audioSource;
    public AudioClip creakClip; // porta_rangendo.wav
    public AudioClip slamClip;  // porta_batendo.wav

    private float currentAngle;
    private float currentSpeed;

    public float OpenAmount => openAngle > 0f ? currentAngle / openAngle : 0f;

    void OnEnable() { if (!All.Contains(this)) All.Add(this); }
    void OnDisable() { All.Remove(this); }

    void Start()
    {
        currentAngle = isOpen ? openAngle : 0f;
        currentSpeed = openSpeed;
        ApplyAngle();
        if (ghostsPassThrough) IgnoreGhosts();
    }

    /// <summary>Faz todas as folhas ignorarem a colisão com os fantasmas da cena.</summary>
    public void IgnoreGhosts()
    {
        Collider[] mine = GetComponentsInChildren<Collider>();
        foreach (var ghost in FindObjectsOfType<GhostController>())
        {
            Collider gc = ghost.GetComponent<CharacterController>();
            if (gc == null) continue;
            foreach (var c in mine) Physics.IgnoreCollision(c, gc, true);
        }
    }

    void Update()
    {
        float target = isOpen ? openAngle : 0f;
        if (Mathf.Abs(currentAngle - target) < 0.01f) return;
        currentAngle = Mathf.MoveTowards(currentAngle, target, currentSpeed * Time.deltaTime);
        ApplyAngle();
        if (Mathf.Abs(currentAngle - target) < 0.01f) currentSpeed = openSpeed;
    }

    void ApplyAngle()
    {
        for (int i = 0; i < hinges.Count; i++)
        {
            if (hinges[i] == null) continue;
            float sign = i < hingeSigns.Count ? hingeSigns[i] : 1f;
            hinges[i].localRotation = Quaternion.Euler(0f, currentAngle * sign, 0f);
        }
    }

    /// <summary>Abrir/fechar normal (caçador). Retorna falso se estiver trancada.</summary>
    public bool Toggle()
    {
        if (locked) return false;
        isOpen = !isOpen;
        currentSpeed = openSpeed;
        if (audioSource != null && creakClip != null) audioSource.PlayOneShot(creakClip);
        return true;
    }

    /// <summary>Assombração: a porta bate com força (abre se estiver fechada, fecha se estiver aberta).</summary>
    public void Slam()
    {
        isOpen = !isOpen;
        currentSpeed = slamSpeed;
        if (audioSource != null && slamClip != null) audioSource.PlayOneShot(slamClip);
    }

    public Vector3 Center
    {
        get
        {
            Collider c = GetComponentInChildren<Collider>();
            return c != null ? c.bounds.center : transform.position;
        }
    }
}
