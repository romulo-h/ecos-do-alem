using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Caçador em primeira pessoa.
///
/// Controles padrão:
///   Mouse - olhar        WASD - andar      Shift - correr       F - lanterna
///   Botão esquerdo (Fire1) - Aspirador Ectoplásmico   Botão direito (Fire2) - mira (FOV 75→50)
///   T - Câmera Térmica/UV (mostra pegadas espectrais)  G - Sal Purificador (bloqueia passagem/escada)
///   E - abrir/fechar porta
/// Caçada Invertida: o aspirador fica sem bateria; corra (estamina), feche caminhos com sal e sobreviva.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class HunterController : MonoBehaviour
{
    public static readonly List<HunterController> All = new List<HunterController>();

    [Header("Controle")]
    [Tooltip("Somente o jogador local lê teclado/mouse. Em rede, marque apenas o caçador do dono.")]
    public bool isLocallyControlled = true;
    public KeyCode flashlightKey = KeyCode.F;
    public KeyCode thermalKey = KeyCode.T;
    public KeyCode saltKey = KeyCode.G;
    public KeyCode sprintKey = KeyCode.LeftShift;
    public KeyCode interactKey = KeyCode.E;
    public float interactRange = 2.5f;

    [Header("Visão em Primeira Pessoa (FPS)")]
    public Transform firstPersonCamera; // Câmera na altura dos olhos (~1.65m)
    public float eyeHeight = 1.65f;
    public float lookSensitivity = 2.0f;
    public float maxLookAngle = 85.0f;
    public float fovNormal = 75.0f;
    public float fovAim = 50.0f;

    [Header("Head Bobbing (Passos no Assoalho)")]
    public bool enableHeadBob = true;
    public float bobSpeed = 10.0f;
    public float bobAmount = 0.04f;

    [Header("Modelo 3D (cacador_e_fantasma.glb)")]
    public GameObject hunterBodyModel;        // Corpo: só projeta sombra na visão 1P
    public GameObject firstPersonWeaponModel; // Arma/Sensor segurado em primeira pessoa

    [Header("Locomoção")]
    public float walkSpeed = 3.8f;
    public float sprintSpeed = 6.2f;
    public float gravity = 18.0f;

    [Header("Vida & Estamina")]
    public float maxHealth = 100f;
    public float health = 100f;
    public float maxStamina = 100f;
    public float stamina = 100f;
    public float staminaDrainPerSecond = 20f;
    public float staminaRegenPerSecond = 15f;
    public float staminaRegenDelay = 0.8f;
    [Tooltip("Depois de esgotar, só volta a correr com esta estamina.")]
    public float staminaRecoverThreshold = 25f;
    public AudioClip hurtClip; // cacador_ferido.wav

    [Header("Animação")]
    [Tooltip("Gerado automaticamente se vazio (figura procedural).")]
    public CharacterAnimator characterAnimator;

    [Header("Lanterna")]
    public Light flashlight;

    [Header("Sensor EMF")]
    public float emfRange = 6.5f;
    [Tooltip("Peso da distância vertical: móveis em outro andar marcam menos.")]
    public float emfVerticalWeight = 1.5f;
    public AudioSource emfAudioSource;
    public AudioClip emfBeepClip; // emf_detector_beep.wav
    [Tooltip("Intervalo entre bipes para os níveis 1..5.")]
    public float[] emfBeepIntervals = { 1.0f, 0.7f, 0.45f, 0.28f, 0.15f };

    [Header("Câmera Térmica / UV")]
    [Tooltip("Objeto opcional ligado junto com a câmera térmica (ex.: Volume de pós-processamento ou overlay).")]
    public GameObject thermalOverlay;

    [Header("Aspirador Ectoplásmico")]
    public LineRenderer protonBeam;
    public float captureDistance = 6.0f;

    [Header("Sal Purificador")]
    public GameObject saltBarrierPrefab;
    public int saltCharges = 3;
    public float saltPlaceRange = 3.0f;
    public float saltDuration = 20.0f;
    public Vector3 saltBarrierSize = new Vector3(1.6f, 2.4f, 0.4f);

    // ---- Estado público (HUD) ----
    public int CurrentEmfLevel { get; private set; }
    public bool ThermalActive { get; private set; }
    public bool CanMove => canMove;
    public bool IsBeamActive => protonBeam != null && protonBeam.enabled;
    public int SaltChargesRemaining => saltCharges;
    public bool IsDead { get; private set; }
    public bool FleeMode { get; private set; }
    public float Health01 => Mathf.Clamp01(health / maxHealth);
    public float Stamina01 => Mathf.Clamp01(stamina / maxStamina);
    public bool IsExhausted => exhausted;
    public float TimeSinceHurt => Time.time - lastHurtTime;
    public event Action<HunterController> Died;

    private CharacterController controller;
    private Camera cam;
    private float verticalVelocity;
    private float pitch;
    private bool canMove = true;
    private float bobTimer;
    private float defaultCameraPosY;
    private float nextBeepTime;
    private bool exhausted;
    private float lastSprintTime = -999f;
    private float lastHurtTime = -999f;

    void OnEnable() { if (!All.Contains(this)) All.Add(this); }
    void OnDisable() { All.Remove(this); }

    void Awake()
    {
        controller = GetComponent<CharacterController>();
        controller.stepOffset = Mathf.Max(controller.stepOffset, 0.35f);
        controller.slopeLimit = Mathf.Max(controller.slopeLimit, 55f); // escada de serviço ~49°

        if (isLocallyControlled)
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        if (firstPersonCamera != null)
        {
            defaultCameraPosY = eyeHeight;
            firstPersonCamera.localPosition = new Vector3(0, defaultCameraPosY, 0);
            cam = firstPersonCamera.GetComponent<Camera>();
            if (cam != null) cam.fieldOfView = fovNormal;
        }

        // Figura e animação procedurais enquanto o modelo real não existe
        if (hunterBodyModel == null)
            hunterBodyModel = ProceduralCharacterRig.Create(transform, CharacterStyle.Hunter).gameObject;
        if (characterAnimator == null) characterAnimator = GetComponent<CharacterAnimator>();
        if (characterAnimator == null) characterAnimator = gameObject.AddComponent<CharacterAnimator>();
        characterAnimator.style = CharacterStyle.Hunter;
        if (characterAnimator.rig == null) characterAnimator.rig = hunterBodyModel.GetComponent<ProceduralCharacterRig>();
        if (characterAnimator.animator == null) characterAnimator.animator = hunterBodyModel.GetComponentInChildren<Animator>();

        // Na visão em 1ª pessoa o próprio corpo só projeta sombra; os outros jogadores veem o corpo inteiro
        if (isLocallyControlled)
        {
            foreach (var r in hunterBodyModel.GetComponentsInChildren<Renderer>())
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.ShadowsOnly;
        }
        health = maxHealth;
        stamina = maxStamina;

        if (protonBeam != null) protonBeam.enabled = false;
        if (thermalOverlay != null) thermalOverlay.SetActive(false);
    }

    public void SetCanMove(bool state)
    {
        canMove = state && !IsDead;
        if (!state)
        {
            if (protonBeam != null) protonBeam.enabled = false;
            CurrentEmfLevel = 0;
        }
    }

    void Update()
    {
        if (!canMove || !isLocallyControlled || GameMenu.InputBlocked)
        {
            if (characterAnimator != null) { characterAnimator.SetSprinting(false); characterAnimator.SetAiming(false); }
            return;
        }

        HandleFPSLook();
        HandleMovement();
        HandleHeadBob();
        HandleFlashlight();
        HandleThermal();
        HandleSalt();
        HandleDoors();
        HandleEMFScan();
        HandleCaptureBeam();
    }

    void HandleFPSLook()
    {
        float mouseX = Input.GetAxis("Mouse X") * lookSensitivity;
        float mouseY = Input.GetAxis("Mouse Y") * lookSensitivity;

        transform.Rotate(Vector3.up * mouseX);
        pitch = Mathf.Clamp(pitch - mouseY, -maxLookAngle, maxLookAngle);

        if (firstPersonCamera != null)
        {
            firstPersonCamera.localRotation = Quaternion.Euler(pitch, 0, 0);
            if (cam != null)
            {
                float targetFOV = Input.GetButton("Fire2") ? fovAim : fovNormal;
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, targetFOV, Time.deltaTime * 10f);
            }
        }
    }

    void HandleMovement()
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        Vector3 move = Vector3.ClampMagnitude(transform.forward * v + transform.right * h, 1f);

        // Estamina: correr gasta; esgotou, precisa recuperar um pouco antes de correr de novo
        bool wantsSprint = Input.GetKey(sprintKey) && move.sqrMagnitude > 0.01f;
        bool sprinting = wantsSprint && !exhausted && stamina > 0f;
        if (sprinting)
        {
            stamina = Mathf.Max(0f, stamina - staminaDrainPerSecond * Time.deltaTime);
            lastSprintTime = Time.time;
            if (stamina <= 0f) exhausted = true;
        }
        else if (Time.time - lastSprintTime >= staminaRegenDelay)
        {
            stamina = Mathf.Min(maxStamina, stamina + staminaRegenPerSecond * Time.deltaTime);
        }
        if (exhausted && stamina >= staminaRecoverThreshold) exhausted = false;
        float speed = sprinting ? sprintSpeed : walkSpeed;
        characterAnimator.SetSprinting(sprinting);

        if (controller.isGrounded) verticalVelocity = -0.5f;
        else verticalVelocity -= gravity * Time.deltaTime;

        Vector3 velocity = move * speed;
        velocity.y = verticalVelocity;
        controller.Move(velocity * Time.deltaTime);
    }

    void HandleHeadBob()
    {
        if (!enableHeadBob || firstPersonCamera == null) return;

        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        Vector3 p = firstPersonCamera.localPosition;

        if (Mathf.Abs(h) > 0.1f || Mathf.Abs(v) > 0.1f)
        {
            float speedMultiplier = characterAnimator != null && Input.GetKey(sprintKey) && !exhausted ? 1.4f : 1.0f;
            bobTimer += Time.deltaTime * bobSpeed * speedMultiplier;
            p.y = defaultCameraPosY + Mathf.Sin(bobTimer) * bobAmount;
        }
        else
        {
            bobTimer = 0f;
            p.y = Mathf.Lerp(p.y, defaultCameraPosY, Time.deltaTime * 8f);
        }
        firstPersonCamera.localPosition = p;
    }

    void HandleFlashlight()
    {
        if (Input.GetKeyDown(flashlightKey) && flashlight != null)
            flashlight.enabled = !flashlight.enabled;
    }

    void HandleThermal()
    {
        if (!Input.GetKeyDown(thermalKey)) return;
        ThermalActive = !ThermalActive;
        SpectralVisibility.Visible = ThermalActive; // pegadas só aparecem para o caçador local com a câmera ligada
        if (thermalOverlay != null) thermalOverlay.SetActive(ThermalActive);
    }

    void HandleSalt()
    {
        if (!Input.GetKeyDown(saltKey) || saltCharges <= 0 || firstPersonCamera == null) return;

        Vector3 pos;
        Ray ray = new Ray(firstPersonCamera.position, firstPersonCamera.forward);
        if (RaycastIgnoringSelf(ray, saltPlaceRange, out RaycastHit hit) && hit.normal.y > 0.7f)
        {
            pos = hit.point;
        }
        else
        {
            Vector3 flatFwd = Vector3.ProjectOnPlane(firstPersonCamera.forward, Vector3.up).normalized;
            Vector3 probe = transform.position + flatFwd * 1.5f + Vector3.up * 1.0f;
            if (!Physics.Raycast(probe, Vector3.down, out RaycastHit ground, 3.0f, ~0, QueryTriggerInteraction.Ignore)) return;
            pos = ground.point;
        }

        Quaternion rot = Quaternion.Euler(0f, transform.eulerAngles.y, 0f);
        SaltBarrier.Create(saltBarrierPrefab, pos, rot, saltBarrierSize, saltDuration);
        saltCharges--;
    }

    void HandleDoors()
    {
        if (!Input.GetKeyDown(interactKey) || firstPersonCamera == null) return;
        Ray ray = new Ray(firstPersonCamera.position, firstPersonCamera.forward);
        if (!RaycastIgnoringSelf(ray, interactRange, out RaycastHit hit)) return;
        MansionDoor door = hit.collider.GetComponentInParent<MansionDoor>();
        if (door != null) door.Toggle();
    }

    void HandleEMFScan()
    {
        Vector3 origin = firstPersonCamera != null ? firstPersonCamera.position : transform.position;
        int level = 0;

        foreach (var prop in PossessableProp.All)
        {
            if (!prop.IsEmfActive) continue;

            Vector3 closest = prop.PropCollider != null ? prop.PropCollider.bounds.ClosestPoint(origin) : prop.transform.position;
            Vector3 d = closest - origin;
            d.y *= emfVerticalWeight;
            float dist = d.magnitude;
            if (dist > emfRange) continue;

            int propLevel = Mathf.Clamp(Mathf.CeilToInt((1.0f - dist / emfRange) * 5f), 1, 5);
            if (propLevel > level) level = propLevel;
        }

        // Na Caçada Invertida o sensor também acusa fantasmas por perto (ajuda a fugir)
        if (FleeMode)
        {
            foreach (var ghost in GhostController.All)
            {
                if (ghost == null || ghost.IsExorcised) continue;
                Vector3 d = ghost.transform.position + Vector3.up - origin;
                d.y *= emfVerticalWeight;
                float dist = d.magnitude;
                if (dist > emfRange) continue;
                level = Mathf.Max(level, Mathf.Clamp(Mathf.CeilToInt((1.0f - dist / emfRange) * 5f), 1, 5));
            }
        }

        CurrentEmfLevel = level;

        if (level > 0 && Time.time >= nextBeepTime)
        {
            if (emfAudioSource != null && emfBeepClip != null)
            {
                emfAudioSource.pitch = 0.9f + 0.08f * level;
                emfAudioSource.PlayOneShot(emfBeepClip);
            }
            int idx = Mathf.Clamp(level - 1, 0, emfBeepIntervals.Length - 1);
            nextBeepTime = Time.time + (emfBeepIntervals.Length > 0 ? emfBeepIntervals[idx] : 0.5f);
        }
    }

    void HandleCaptureBeam()
    {
        if (protonBeam == null || firstPersonCamera == null) return;
        characterAnimator.SetAiming(Input.GetButton("Fire2") || (Input.GetButton("Fire1") && !FleeMode));

        if (!Input.GetButton("Fire1") || FleeMode) // na Caçada Invertida o aspirador está sem bateria
        {
            protonBeam.enabled = false;
            return;
        }

        protonBeam.enabled = true;
        Vector3 origin = firstPersonWeaponModel != null
            ? firstPersonWeaponModel.transform.position
            : firstPersonCamera.position + firstPersonCamera.forward * 0.3f;
        protonBeam.SetPosition(0, origin);

        Ray ray = new Ray(firstPersonCamera.position, firstPersonCamera.forward);
        if (RaycastIgnoringSelf(ray, captureDistance, out RaycastHit hit))
        {
            protonBeam.SetPosition(1, hit.point);

            // Fantasma na forma etérea (inclusive exposto após expulsão)
            GhostController ghost = hit.collider.GetComponentInParent<GhostController>();
            if (ghost == null)
            {
                // Fantasma dentro de um móvel
                PossessableProp prop = hit.collider.GetComponentInParent<PossessableProp>();
                if (prop != null && prop.isPossessed) ghost = prop.CurrentGhost;
            }
            if (ghost != null) ghost.ApplyBeam(Time.deltaTime);
        }
        else
        {
            protonBeam.SetPosition(1, ray.origin + ray.direction * captureDistance);
        }
    }

    // ------------------------------------------------------------------ Caçada Invertida

    /// <summary>Ligado pelo GhostGameManager: os fantasmas caçam, o aspirador para e o caçador precisa fugir.</summary>
    public void SetFleeMode(bool on)
    {
        FleeMode = on;
        if (on && protonBeam != null) protonBeam.enabled = false;
    }

    public void TakeDamage(float amount, GhostController source)
    {
        if (IsDead || amount <= 0f) return;
        health -= amount;
        lastHurtTime = Time.time;
        characterAnimator.TriggerHit();
        if (hurtClip != null) AudioSource.PlayClipAtPoint(hurtClip, transform.position + Vector3.up, 1f);
        if (health <= 0f) Die();
    }

    void Die()
    {
        health = 0f;
        IsDead = true;
        canMove = false;
        CurrentEmfLevel = 0;
        if (protonBeam != null) protonBeam.enabled = false;
        if (flashlight != null) flashlight.enabled = false;
        characterAnimator.SetDead(true);
        if (isLocallyControlled && firstPersonCamera != null) StartCoroutine(DeathCamera());
        Died?.Invoke(this);
    }

    /// <summary>Câmera em 1ª pessoa cai de lado até o chão.</summary>
    IEnumerator DeathCamera()
    {
        Vector3 startPos = firstPersonCamera.localPosition;
        Quaternion startRot = firstPersonCamera.localRotation;
        Vector3 endPos = new Vector3(0f, 0.3f, -0.4f);
        Quaternion endRot = Quaternion.Euler(-25f, 0f, 75f);
        float t = 0f;
        while (t < 1f)
        {
            t += Time.deltaTime / CharacterPoseSolver.DeathDuration;
            float e = t * t * (3f - 2f * t);
            firstPersonCamera.localPosition = Vector3.Lerp(startPos, endPos, e);
            firstPersonCamera.localRotation = Quaternion.Slerp(startRot, endRot, e);
            yield return null;
        }
    }

    bool RaycastIgnoringSelf(Ray ray, float distance, out RaycastHit result)
    {
        RaycastHit[] hits = Physics.RaycastAll(ray, distance, ~0, QueryTriggerInteraction.Ignore);
        Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
        foreach (var h in hits)
        {
            if (h.collider.transform == transform || h.collider.transform.IsChildOf(transform)) continue;
            result = h;
            return true;
        }
        result = default(RaycastHit);
        return false;
    }
}
