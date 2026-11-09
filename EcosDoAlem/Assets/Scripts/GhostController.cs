using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Fantasma: forma etérea em 3ª pessoa + possessão de móveis com a Regra dos 20 Segundos.
///
/// Controles padrão:
///   WASD  - mover (relativo à câmera)       E      - possuir móvel mirado / sair do móvel
///   Space - sair do móvel                   Q      - Salto Espectral (dentro de um móvel, até 6 m, CD 20 s)
///   R     - Assombração Ativa (CD 12 s; de dentro do móvel, num móvel próximo ou batendo uma porta)
///   Botão esquerdo - Toque Gélido (só na Caçada Invertida: o fantasma caça os caçadores)
/// O fantasma atravessa portas fechadas (MansionDoor), mas não paredes.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class GhostController : MonoBehaviour
{
    public static readonly List<GhostController> All = new List<GhostController>();

    [Header("Controle")]
    [Tooltip("Somente o jogador local lê teclado/mouse. Em rede, marque apenas o fantasma do dono.")]
    public bool isLocallyControlled = true;
    [Tooltip("Desligado pelo GhostGameManager no fim da partida.")]
    public bool inputEnabled = true;
    [Tooltip("Câmera em 3ª pessoa (GhostCamera). Se vazio usa Camera.main.")]
    public Transform ghostCamera;
    public KeyCode possessKey = KeyCode.E;
    public KeyCode ejectKey = KeyCode.Space;
    public KeyCode spectralJumpKey = KeyCode.Q;
    public KeyCode hauntKey = KeyCode.R;

    [Header("Instância de Modelo (GLB Character)")]
    public GameObject ghostVisualModel; // Malha visual do Fantasma vinda do cacador_e_fantasma.glb
    public Material normalGhostMaterial;
    public Material warningMaterial;
    public Material exposedMaterial;

    [Header("Movimento Etéreo")]
    public float moveSpeed = 5.0f;
    public float gravity = 12.0f;
    public float turnSpeed = 12.0f;

    [Header("Possessão & Regra dos 20 Segundos")]
    public float maxStayDuration = 20.0f;
    public float warningThreshold = 15.0f;
    [Tooltip("Ficar em móveis dentro deste raio conta como o mesmo esconderijo.")]
    public float zoneRadius = 2.0f;
    [Tooltip("Tempo fora da zona para o contador zerar. Após expulsão forçada a zona fica bloqueada por este tempo.")]
    public float zoneMemoryDuration = 10.0f;
    public float possessRange = 3.5f;
    public float exposedDuration = 3.0f;
    public float maxTrembleIntensity = 0.015f;

    [Header("Salto Espectral")]
    public float spectralJumpRange = 6.0f;
    public float spectralJumpCooldown = 20.0f;

    [Header("Assombração Ativa")]
    public float hauntCooldown = 12.0f;
    public float hauntRange = 3.5f;

    [Header("Vida / Exorcismo")]
    public float maxHealth = 100.0f;
    public float health = 100.0f;
    [Tooltip("Dano por segundo do aspirador quando o fantasma está DENTRO de um móvel.")]
    public float beamDamageOnProp = 10.0f;
    [Tooltip("Dano por segundo do aspirador na forma etérea.")]
    public float beamDamageEthereal = 35.0f;
    public float exposedDamageMultiplier = 1.5f;
    [Tooltip("Segundos de feixe contínuo no móvel para expulsar o fantasma à força.")]
    public float beamExpulsionTime = 1.5f;
    public float regenDelay = 4.0f;
    public float regenPerSecond = 5.0f;

    [Header("Pegadas Espectrais (Câmera Térmica)")]
    public GameObject footprintPrefab;
    public float footprintSpacing = 0.8f;
    public float footprintLifetime = 12.0f;

    [Header("Caçada Invertida (fantasma caça)")]
    public float huntMoveSpeed = 5.6f;
    public float attackRange = 1.8f;
    [Tooltip("Meio-ângulo do cone de ataque, em graus, em torno da direção da câmera.")]
    public float attackAngle = 70f;
    public float attackDamage = 34f;
    public float attackCooldown = 1.1f;
    public AudioClip attackClip; // ataque_fantasma.wav

    [Header("Animação")]
    [Tooltip("Gerado automaticamente se vazio (figura procedural).")]
    public CharacterAnimator characterAnimator;

    [Header("Áudio")]
    [Tooltip("Fonte 2D só do jogador local (alertas da HUD).")]
    public AudioSource localAudio;
    public AudioClip instabilityAlertClip;   // fantasma_instabilidade_alerta.wav
    public AudioClip forcedEjectClip;        // fantasma_ejecao_forcada.wav (3D, todos ouvem)
    public float forcedEjectVolume = 1.0f;

    public event Action<GhostController> Exorcised;
    public event Action<GhostController> InstabilityWarning;
    public event Action<GhostController> ForcedEjected;

    // ---- Estado público (HUD / rede) ----
    public bool IsPossessing { get; private set; }
    public bool IsExorcised { get; private set; }
    public bool IsExposed => Time.time < exposedUntil;
    public bool HuntMode { get; private set; }
    public float AttackCooldownRemaining => Mathf.Max(0f, attackReadyAt - Time.time);
    public PossessableProp CurrentProp => currentProp;
    public float PossessionTime => possessionTimer;
    public float InstabilityNormalized => Mathf.Clamp01(possessionTimer / maxStayDuration);
    public bool IsInWarning => IsPossessing && possessionTimer >= warningThreshold;
    public float SpectralJumpCooldownRemaining => Mathf.Max(0f, jumpReadyAt - Time.time);
    public float HauntCooldownRemaining => Mathf.Max(0f, hauntReadyAt - Time.time);
    public float Health01 => Mathf.Clamp01(health / maxHealth);
    public float BeamExpulsion01 => Mathf.Clamp01(expulsionMeter / beamExpulsionTime);
    public Vector3 CameraFocus => IsPossessing && currentProp != null ? currentProp.Center : transform.position + Vector3.up * 1.2f;

    // ---- Estado interno ----
    private CharacterController controller;
    private PossessableProp currentProp;
    private float possessionTimer;
    private bool hasZone;
    private Vector3 zoneAnchor;
    private float zoneLeftTime = -999f;
    private Vector3 burnedAnchor;
    private float burnedUntil = -999f;
    private bool warningRaised;
    private float exposedUntil = -999f;
    private float jumpReadyAt;
    private float hauntReadyAt;
    private float verticalVelocity;
    private float lastDamageTime = -999f;
    private float expulsionMeter;
    private float lastBeamTime = -999f;
    private Vector3 lastFootprintPos;
    private bool leftFoot;
    private Coroutine exposedRoutine;
    private float attackReadyAt;

    bool CanReadInput => isLocallyControlled && inputEnabled && !GameMenu.InputBlocked;
    Transform AimTransform => ghostCamera != null ? ghostCamera : (Camera.main != null ? Camera.main.transform : transform);

    void Awake()
    {
        controller = GetComponent<CharacterController>();
        controller.stepOffset = Mathf.Max(controller.stepOffset, 0.35f);
        controller.slopeLimit = Mathf.Max(controller.slopeLimit, 55f); // escada de serviço ~49°
        health = maxHealth;
        lastFootprintPos = transform.position;

        // Figura e animação procedurais enquanto o modelo real não existe
        if (ghostVisualModel == null)
            ghostVisualModel = ProceduralCharacterRig.Create(transform, CharacterStyle.Ghost).gameObject;
        if (characterAnimator == null) characterAnimator = GetComponent<CharacterAnimator>();
        if (characterAnimator == null) characterAnimator = gameObject.AddComponent<CharacterAnimator>();
        characterAnimator.style = CharacterStyle.Ghost;
        if (characterAnimator.rig == null) characterAnimator.rig = ghostVisualModel.GetComponent<ProceduralCharacterRig>();
        if (characterAnimator.animator == null) characterAnimator.animator = ghostVisualModel.GetComponentInChildren<Animator>();
    }

    void OnEnable() { if (!All.Contains(this)) All.Add(this); }
    void OnDisable() { All.Remove(this); }

    void Update()
    {
        if (IsExorcised) return;

        UpdateHealthRegen();
        DecayBeamExpulsion();

        if (IsPossessing)
        {
            UpdatePossession();
            if (!IsPossessing) return; // foi expulso neste frame

            if (CanReadInput)
            {
                if (Input.GetKeyDown(ejectKey) || Input.GetKeyDown(possessKey)) { Eject(false); return; }
                if (Input.GetKeyDown(spectralJumpKey)) TrySpectralJump();
                if (Input.GetKeyDown(hauntKey)) TryHaunt();
            }
        }
        else
        {
            HandleGhostMovement(CanReadInput);
            HandleFootprints();

            if (CanReadInput)
            {
                if (HuntMode)
                {
                    if (Input.GetButtonDown("Fire1")) TryAttack();
                    if (Input.GetKeyDown(hauntKey)) TryHaunt(); // ainda pode bater portas para assustar
                }
                else if (Input.GetKeyDown(possessKey)) TryPossessAimed();
                else if (Input.GetKeyDown(hauntKey)) TryHaunt();
            }
        }
    }

    // ------------------------------------------------------------------ Movimento etéreo

    void HandleGhostMovement(bool readInput)
    {
        Vector3 move = Vector3.zero;
        if (readInput)
        {
            float h = Input.GetAxisRaw("Horizontal");
            float v = Input.GetAxisRaw("Vertical");
            Transform aim = AimTransform;
            Vector3 fwd = Vector3.ProjectOnPlane(aim.forward, Vector3.up).normalized;
            Vector3 right = Vector3.ProjectOnPlane(aim.right, Vector3.up).normalized;
            move = Vector3.ClampMagnitude(fwd * v + right * h, 1f) * (HuntMode ? huntMoveSpeed : moveSpeed);
        }

        if (controller.isGrounded) verticalVelocity = -1f;
        else verticalVelocity -= gravity * Time.deltaTime;

        Vector3 horizontalStep = move * Time.deltaTime;
        if (horizontalStep.sqrMagnitude > 0f &&
            SaltBarrier.BlocksMove(transform.position, transform.position + horizontalStep, controller.radius))
        {
            horizontalStep = Vector3.zero; // Sal Purificador bloqueia a passagem
        }

        controller.Move(horizontalStep + Vector3.up * verticalVelocity * Time.deltaTime);

        if (move.sqrMagnitude > 0.01f && ghostVisualModel != null)
        {
            Quaternion target = Quaternion.LookRotation(move.normalized, Vector3.up);
            ghostVisualModel.transform.rotation = Quaternion.Slerp(ghostVisualModel.transform.rotation, target, Time.deltaTime * turnSpeed);
        }
    }

    void HandleFootprints()
    {
        if (!controller.isGrounded) return;
        Vector3 flat = transform.position - lastFootprintPos;
        flat.y = 0f;
        if (flat.magnitude < footprintSpacing) return;

        Vector3 dir = flat.normalized;
        Vector3 side = Vector3.Cross(Vector3.up, dir) * (leftFoot ? 0.12f : -0.12f);
        leftFoot = !leftFoot;
        SpectralFootprint.Spawn(footprintPrefab, transform.position + side, Quaternion.LookRotation(dir, Vector3.up), footprintLifetime);
        lastFootprintPos = transform.position;
    }

    // ------------------------------------------------------------------ Possessão

    void UpdatePossession()
    {
        if (currentProp == null) { Eject(false); return; }

        possessionTimer += Time.deltaTime;
        transform.position = currentProp.transform.position;

        if (possessionTimer >= warningThreshold && possessionTimer < maxStayDuration)
        {
            float factor = (possessionTimer - warningThreshold) / (maxStayDuration - warningThreshold);
            float sizeScale = currentProp.category == PropCategory.Louca ? 0.35f : 1f; // objetos pequenos tremem menos
            currentProp.SetTremble(Mathf.Lerp(maxTrembleIntensity * 0.25f, maxTrembleIntensity, factor) * sizeScale);

            if (!warningRaised)
            {
                warningRaised = true;
                if (isLocallyControlled && localAudio != null && instabilityAlertClip != null)
                    localAudio.PlayOneShot(instabilityAlertClip);
                InstabilityWarning?.Invoke(this);
            }
        }

        if (possessionTimer >= maxStayDuration)
            ForceEject();
    }

    bool IsInsideZone(Vector3 anchor, Vector3 point)
    {
        Vector3 d = point - anchor;
        if (Mathf.Abs(d.y) > 2.5f) return false; // outro andar
        d.y = 0f;
        return d.magnitude <= zoneRadius;
    }

    /// <summary>Zona bloqueada após uma expulsão forçada.</summary>
    public bool IsZoneBurned(PossessableProp prop)
    {
        return Time.time < burnedUntil && IsInsideZone(burnedAnchor, prop.transform.position);
    }

    public bool CanPossess(PossessableProp prop)
    {
        return prop != null && !prop.isPossessed && !IsZoneBurned(prop);
    }

    void TryPossessAimed()
    {
        PossessableProp prop = FindAimedProp(transform.position, possessRange, null);
        if (prop == null) prop = FindNearestProp(transform.position, 1.5f, null, false);
        if (prop != null) Possess(prop);
    }

    public bool Possess(PossessableProp prop)
    {
        if (HuntMode || !CanPossess(prop)) return false;
        if (!prop.TryPossess(this)) return false;

        // Regra dos 20s: mesmo móvel ou móvel a até 2 m do esconderijo anterior continua o contador.
        bool sameZone = hasZone && IsInsideZone(zoneAnchor, prop.transform.position) &&
                        (IsPossessing || Time.time - zoneLeftTime <= zoneMemoryDuration);
        if (!sameZone)
        {
            hasZone = true;
            zoneAnchor = prop.transform.position;
            possessionTimer = 0f;
            warningRaised = false;
        }

        currentProp = prop;
        IsPossessing = true;
        expulsionMeter = 0f;

        controller.enabled = false;
        if (ghostVisualModel != null) ghostVisualModel.SetActive(false);
        characterAnimator.SetPossessing(true);
        transform.position = prop.transform.position;
        return true;
    }

    public void Eject(bool forced)
    {
        if (!IsPossessing) return;

        Vector3 propPos = currentProp != null ? currentProp.transform.position : transform.position;
        Collider propCol = currentProp != null ? currentProp.PropCollider : null;
        if (currentProp != null)
        {
            currentProp.SetTremble(0f);
            currentProp.Release();
            currentProp = null;
        }

        IsPossessing = false;
        zoneLeftTime = Time.time;
        expulsionMeter = 0f;

        transform.position = FindExitPosition(propPos, propCol);
        verticalVelocity = 0f;
        lastFootprintPos = transform.position;
        controller.enabled = true;
        if (ghostVisualModel != null) ghostVisualModel.SetActive(true);
        characterAnimator.SetPossessing(false);
        characterAnimator.PlayEmerge();

        if (forced)
        {
            exposedUntil = Time.time + exposedDuration;
            if (exposedRoutine != null) StopCoroutine(exposedRoutine);
            exposedRoutine = StartCoroutine(ExposedRoutine(exposedDuration));
        }
    }

    void ForceEject()
    {
        if (!IsPossessing) return;

        Vector3 pos = currentProp != null ? currentProp.Center : transform.position;
        if (forcedEjectClip != null)
            AudioSource.PlayClipAtPoint(forcedEjectClip, pos, forcedEjectVolume); // ruído audível para todos

        burnedAnchor = zoneAnchor;
        burnedUntil = Time.time + zoneMemoryDuration;
        hasZone = false;
        possessionTimer = 0f;
        warningRaised = false;

        Eject(true);
        ForcedEjected?.Invoke(this);
    }

    Vector3 FindExitPosition(Vector3 propPos, Collider propCol)
    {
        float radius = controller.radius;
        float height = controller.height;
        float[] distances = { 1.0f, 1.6f, 2.4f };
        if (propCol != null)
        {
            float ext = Mathf.Max(propCol.bounds.extents.x, propCol.bounds.extents.z);
            distances = new[] { ext + radius + 0.2f, ext + radius + 0.8f, ext + radius + 1.5f };
        }

        for (int d = 0; d < distances.Length; d++)
        {
            for (int i = 0; i < 8; i++)
            {
                float ang = i * 45f;
                Vector3 dir = Quaternion.Euler(0f, ang, 0f) * Vector3.forward;
                Vector3 probe = propPos + dir * distances[d] + Vector3.up * 0.6f;

                if (!Physics.Raycast(probe, Vector3.down, out RaycastHit ground, 4.0f, ~0, QueryTriggerInteraction.Ignore))
                    continue;

                Vector3 feet = ground.point + Vector3.up * 0.05f;
                Vector3 bottom = feet + Vector3.up * radius;
                Vector3 top = feet + Vector3.up * Mathf.Max(radius, height - radius);
                if (Physics.CheckCapsule(bottom, top, radius * 0.95f, ~0, QueryTriggerInteraction.Ignore)) continue;
                if (SaltBarrier.BlocksMove(propPos, feet, radius)) continue;
                return feet;
            }
        }
        return propPos + Vector3.up * 0.5f;
    }

    IEnumerator ExposedRoutine(float duration)
    {
        Renderer[] rends = ghostVisualModel != null ? ghostVisualModel.GetComponentsInChildren<Renderer>(true) : new Renderer[0];
        if (exposedMaterial != null) foreach (var r in rends) r.material = exposedMaterial;
        characterAnimator.SetExposed(true); // figura pisca em branco

        yield return new WaitForSeconds(duration);

        if (normalGhostMaterial != null) foreach (var r in rends) r.material = normalGhostMaterial;
        characterAnimator.SetExposed(false);
        exposedRoutine = null;
    }

    // ------------------------------------------------------------------ Habilidades

    public bool TrySpectralJump()
    {
        if (!IsPossessing || currentProp == null || Time.time < jumpReadyAt) return false;

        Vector3 origin = currentProp.transform.position;
        PossessableProp target = FindAimedProp(origin, spectralJumpRange, currentProp);
        if (target == null) target = FindPropInViewCone(origin, spectralJumpRange, currentProp);
        if (target == null) return false;
        if (SaltBarrier.SegmentBlocked(currentProp.Center, target.Center)) return false;

        // Transferência direta: não revela a forma espiritual.
        PossessableProp previous = currentProp;
        previous.SetTremble(0f);
        previous.Release();
        currentProp = null;
        IsPossessing = false;
        zoneLeftTime = Time.time;

        if (!Possess(target))
        {
            // Não deveria ocorrer (CanPossess foi checado), mas volta ao móvel original por segurança.
            Possess(previous);
            return false;
        }

        jumpReadyAt = Time.time + spectralJumpCooldown;
        return true;
    }

    public bool TryHaunt()
    {
        if (Time.time < hauntReadyAt) return false;

        if (!IsPossessing)
        {
            MansionDoor door = FindAimedDoor(transform.position, hauntRange);
            if (door != null)
            {
                door.Slam(); // "bate portas para enganar os radares"
                hauntReadyAt = Time.time + hauntCooldown;
                return true;
            }
        }

        PossessableProp target = IsPossessing ? currentProp : FindAimedProp(transform.position, hauntRange, null);
        if (target == null) return false;

        target.TriggerHauntAction();
        hauntReadyAt = Time.time + hauntCooldown;
        return true;
    }

    // ------------------------------------------------------------------ Dano (chamado pelo HunterController)

    /// <summary>Aplica um frame de feixe do Aspirador Ectoplásmico.</summary>
    public void ApplyBeam(float deltaTime)
    {
        if (IsExorcised) return;
        lastBeamTime = Time.time;

        if (IsPossessing)
        {
            expulsionMeter += deltaTime;
            TakeDamage(beamDamageOnProp * deltaTime);
            if (!IsExorcised && expulsionMeter >= beamExpulsionTime) ForceEject();
        }
        else
        {
            float mult = IsExposed ? exposedDamageMultiplier : 1f;
            TakeDamage(beamDamageEthereal * mult * deltaTime);
        }
    }

    public void TakeDamage(float amount)
    {
        if (IsExorcised || amount <= 0f) return;
        health -= amount;
        lastDamageTime = Time.time;
        if (health <= 0f) Exorcise();
    }

    void UpdateHealthRegen()
    {
        if (health < maxHealth && Time.time - lastDamageTime >= regenDelay)
            health = Mathf.Min(maxHealth, health + regenPerSecond * Time.deltaTime);
    }

    void DecayBeamExpulsion()
    {
        if (expulsionMeter > 0f && Time.time - lastBeamTime > 0.25f)
            expulsionMeter = Mathf.Max(0f, expulsionMeter - Time.deltaTime);
    }

    void Exorcise()
    {
        health = 0f;
        Eject(false);
        IsExorcised = true;
        controller.enabled = false;
        characterAnimator.SetDead(true); // gira, sobe e se desfaz
        Exorcised?.Invoke(this);
        StartCoroutine(DisableAfter(CharacterPoseSolver.DeathDuration + 0.1f));
    }

    IEnumerator DisableAfter(float seconds)
    {
        yield return new WaitForSeconds(seconds);
        gameObject.SetActive(false);
    }

    // ------------------------------------------------------------------ Caçada Invertida

    /// <summary>Ligado pelo GhostGameManager quando o tempo de busca acaba: o fantasma sai do móvel e passa a caçar.</summary>
    public void SetHuntMode(bool on)
    {
        if (IsExorcised) return;
        HuntMode = on;
        if (on && IsPossessing) Eject(false);
        characterAnimator.SetFury(on);
    }

    public bool TryAttack()
    {
        if (!HuntMode || IsPossessing || IsExorcised || Time.time < attackReadyAt) return false;
        attackReadyAt = Time.time + attackCooldown;

        // Vira o corpo para onde a câmera olha e golpeia
        Vector3 fwd = Vector3.ProjectOnPlane(AimTransform.forward, Vector3.up).normalized;
        if (ghostVisualModel != null && fwd.sqrMagnitude > 0.01f) ghostVisualModel.transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
        characterAnimator.TriggerAttack();
        if (attackClip != null) AudioSource.PlayClipAtPoint(attackClip, transform.position + Vector3.up, 1f);
        StartCoroutine(ResolveAttack(fwd));
        return true;
    }

    /// <summary>O dano sai no instante do golpe da animação (dá para o caçador desviar no último segundo).</summary>
    IEnumerator ResolveAttack(Vector3 fwd)
    {
        yield return new WaitForSeconds(CharacterPoseSolver.AttackStrikeTime);
        if (IsExorcised || !HuntMode) yield break;

        Vector3 chest = transform.position + Vector3.up * 1.1f;
        HunterController best = null;
        float bestDist = float.MaxValue;
        foreach (var hunter in HunterController.All)
        {
            if (hunter == null || hunter.IsDead) continue;
            Vector3 target = hunter.transform.position + Vector3.up * 1.1f;
            Vector3 to = target - chest;
            float dist = to.magnitude;
            if (dist > attackRange + 0.4f) continue; // +raio dos corpos
            Vector3 flat = Vector3.ProjectOnPlane(to, Vector3.up);
            if (flat.sqrMagnitude > 0.0001f && Vector3.Angle(fwd, flat) > attackAngle) continue;
            if (SaltBarrier.SegmentBlocked(chest, target)) continue; // o sal protege
            if (!HasLineOfSight(chest, target, hunter.transform)) continue; // parede ou porta fechada no meio
            if (dist < bestDist) { bestDist = dist; best = hunter; }
        }
        if (best != null) best.TakeDamage(attackDamage, this);
    }

    bool HasLineOfSight(Vector3 from, Vector3 to, Transform target)
    {
        Vector3 dir = to - from;
        RaycastHit[] hits = Physics.RaycastAll(new Ray(from, dir.normalized), dir.magnitude, ~0, QueryTriggerInteraction.Ignore);
        foreach (var h in hits)
        {
            if (IsOwnCollider(h.collider)) continue;
            if (h.collider.transform == target || h.collider.transform.IsChildOf(target)) continue;
            return false;
        }
        return true;
    }

    // ------------------------------------------------------------------ Busca de móveis

    bool IsOwnCollider(Collider c) => c.transform == transform || c.transform.IsChildOf(transform);

    /// <summary>Móvel no centro da mira cuja distância até 'origin' é no máximo 'range'.</summary>
    PossessableProp FindAimedProp(Vector3 origin, float range, PossessableProp exclude)
    {
        Transform aim = AimTransform;
        float camDist = Vector3.Distance(aim.position, origin);
        RaycastHit[] hits = Physics.RaycastAll(new Ray(aim.position, aim.forward), camDist + range + 1f, ~0, QueryTriggerInteraction.Ignore);
        Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));

        foreach (var hit in hits)
        {
            if (IsOwnCollider(hit.collider)) continue;
            PossessableProp prop = hit.collider.GetComponentInParent<PossessableProp>();
            if (prop == null)
            {
                if (hit.distance > camDist) return null; // parede/obstáculo na frente
                continue;                                // obstáculo entre câmera e fantasma: ignora
            }
            if (prop == exclude) continue;
            if (prop.DistanceTo(origin) > range) return null;
            return CanPossess(prop) || !IsPossessing ? prop : null;
        }
        return null;
    }

    MansionDoor FindAimedDoor(Vector3 origin, float range)
    {
        Transform aim = AimTransform;
        float camDist = Vector3.Distance(aim.position, origin);
        RaycastHit[] hits = Physics.RaycastAll(new Ray(aim.position, aim.forward), camDist + range + 1f, ~0, QueryTriggerInteraction.Ignore);
        Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
        foreach (var hit in hits)
        {
            if (IsOwnCollider(hit.collider)) continue;
            MansionDoor door = hit.collider.GetComponentInParent<MansionDoor>();
            if (door == null)
            {
                if (hit.distance > camDist) return null;
                continue;
            }
            return Vector3.Distance(origin, hit.point) <= range ? door : null;
        }
        return null;
    }

    PossessableProp FindNearestProp(Vector3 origin, float range, PossessableProp exclude, bool requirePossessable)
    {
        PossessableProp best = null;
        float bestDist = range;
        foreach (var prop in PossessableProp.All)
        {
            if (prop == exclude || (requirePossessable && !CanPossess(prop))) continue;
            float d = prop.DistanceTo(origin);
            if (d <= bestDist) { bestDist = d; best = prop; }
        }
        return best;
    }

    PossessableProp FindPropInViewCone(Vector3 origin, float range, PossessableProp exclude)
    {
        Vector3 fwd = Vector3.ProjectOnPlane(AimTransform.forward, Vector3.up).normalized;
        PossessableProp best = null;
        float bestScore = float.MaxValue;
        foreach (var prop in PossessableProp.All)
        {
            if (prop == exclude || !CanPossess(prop)) continue;
            Vector3 to = prop.transform.position - origin;
            float dist = to.magnitude;
            if (dist > range || dist < 0.01f) continue;
            Vector3 flat = Vector3.ProjectOnPlane(to, Vector3.up);
            float dot = flat.sqrMagnitude > 0.0001f ? Vector3.Dot(fwd, flat.normalized) : 0f;
            if (dot < 0.75f) continue;
            float score = dist * (2f - dot);
            if (score < bestScore) { bestScore = score; best = prop; }
        }
        return best;
    }
}
