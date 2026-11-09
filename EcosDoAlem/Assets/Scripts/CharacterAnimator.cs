using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Anima o personagem. Dois modos, que podem coexistir:
///   1) Procedural: aplica as poses do CharacterPoseSolver na figura ProceduralCharacterRig.
///   2) Animator: se houver um Animator (modelo real com clipes), envia os parâmetros
///      Speed (float), Sprint, Aiming, Dead, Possessing, Fury (bool) e Attack, Hit, Emerge (trigger).
///      Só envia os parâmetros que existirem no Animator Controller.
/// Os controladores (GhostController/HunterController) só chamam os métodos públicos abaixo.
/// </summary>
public class CharacterAnimator : MonoBehaviour
{
    public CharacterStyle style = CharacterStyle.Hunter;
    public ProceduralCharacterRig rig;
    public Animator animator;
    [Tooltip("Velocidade em que o ciclo de passos completa uma volta por metro.")]
    public float strideRadiansPerMeter = 3.6f;
    public float speedSmoothing = 10f;

    private readonly AnimState state = new AnimState();
    private Vector3 lastPos;
    private float smoothSpeed;
    private bool aiming, dead, possessing, fury, exposed;
    private float aimWeight, furyWeight;
    private HashSet<string> animParams;
    private bool lastFlash;
    private float lastFury;

    public bool IsDeathAnimationDone => dead && state.TimeSinceDeath >= CharacterPoseSolver.DeathDuration;

    void Start()
    {
        lastPos = transform.position;
        state.Style = style;
        if (animator != null)
        {
            animParams = new HashSet<string>();
            foreach (var p in animator.parameters) animParams.Add(p.name);
        }
    }

    // ---- API usada pelos controladores
    public void SetSprinting(bool on) { state.Sprinting = on; SetBool("Sprint", on); }
    public void SetAiming(bool on) { aiming = on; SetBool("Aiming", on); }
    public void SetPossessing(bool on) { possessing = on; SetBool("Possessing", on); }
    public void SetFury(bool on) { fury = on; SetBool("Fury", on); }
    public void SetExposed(bool on) { exposed = on; }
    public void TriggerAttack() { state.TimeSinceAttack = 0f; SetTrigger("Attack"); }
    public void TriggerHit() { state.TimeSinceHit = 0f; SetTrigger("Hit"); }
    public void PlayEmerge() { state.TimeSinceEmerge = 0f; SetTrigger("Emerge"); }
    public void SetDead(bool on)
    {
        if (on && !dead) state.TimeSinceDeath = 0f;
        if (!on) state.TimeSinceDeath = -1f;
        dead = on; SetBool("Dead", on);
    }

    void Update()
    {
        float dt = Time.deltaTime;
        Vector3 delta = transform.position - lastPos;
        lastPos = transform.position;
        delta.y = 0f;
        float rawSpeed = dt > 0f ? delta.magnitude / dt : 0f;
        if (rawSpeed > 20f || possessing) rawSpeed = 0f; // teleporte (spawn/possessão) não conta
        smoothSpeed = Mathf.Lerp(smoothSpeed, rawSpeed, 1f - Mathf.Exp(-speedSmoothing * dt));
        if (dead) smoothSpeed = 0f;

        aimWeight = Mathf.MoveTowards(aimWeight, aiming ? 1f : 0f, dt * 6f);
        furyWeight = Mathf.MoveTowards(furyWeight, fury ? 1f : 0f, dt * 2f);

        state.Time += dt;
        state.Speed = smoothSpeed;
        state.CyclePhase += smoothSpeed * strideRadiansPerMeter * dt;
        state.AimWeight = aimWeight;
        state.FuryWeight = furyWeight;
        state.TimeSinceHit += dt;
        state.TimeSinceAttack += dt;
        state.TimeSinceEmerge += dt;
        if (state.TimeSinceDeath >= 0f) state.TimeSinceDeath += dt;

        if (animator != null) SetFloat("Speed", smoothSpeed);
        if (rig != null && rig.RigRoot != null) ApplyPose(CharacterPoseSolver.Solve(state));
    }

    void ApplyPose(CharacterPose pose)
    {
        foreach (var kv in rig.bones)
        {
            if (kv.Key == RigBone.Body) continue;
            RigVec r = pose.Get(kv.Key);
            kv.Value.localRotation = Quaternion.Euler(r.x, r.y, r.z);
        }
        Transform root = rig.RigRoot;
        root.localPosition = new Vector3(pose.RootOffset.x, pose.RootOffset.y, pose.RootOffset.z);
        root.localRotation = Quaternion.Euler(pose.RootEuler.x, pose.RootEuler.y, pose.RootEuler.z);
        root.localScale = Vector3.one * pose.RootScale;

        bool flash = exposed && Mathf.Repeat(Time.time, 0.2f) < 0.1f;
        if (flash != lastFlash || Mathf.Abs(furyWeight - lastFury) > 0.02f)
        {
            rig.ApplyColors(flash, furyWeight);
            lastFlash = flash; lastFury = furyWeight;
        }
    }

    void SetBool(string n, bool v) { if (Has(n)) animator.SetBool(n, v); }
    void SetFloat(string n, float v) { if (Has(n)) animator.SetFloat(n, v); }
    void SetTrigger(string n) { if (Has(n)) animator.SetTrigger(n); }
    bool Has(string n) => animator != null && animParams != null && animParams.Contains(n);
}
