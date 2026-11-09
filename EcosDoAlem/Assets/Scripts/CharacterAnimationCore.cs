using System;
using System.Collections.Generic;

// Núcleo de animação procedural, sem UnityEngine (pode ser testado fora do Unity).
// Convenção de ângulos = Quaternion.Euler(x, y, z) do Unity, em graus, rotação local de cada osso.
//   • Para ossos que apontam para BAIXO (pernas, braços, saia): x positivo leva a ponta para TRÁS; negativo, para FRENTE.
//   • Para ossos que apontam para CIMA (coluna, cabeça): x positivo inclina para FRENTE.

public enum CharacterStyle { Hunter, Ghost }

public enum RigBone
{
    Body, Hips, Spine, Head,
    UpperArmL, ForearmL, UpperArmR, ForearmR,
    ThighL, ShinL, ThighR, ShinR,
    Skirt1, Skirt2, Skirt3
}

public enum PartShape { Box, Sphere, Capsule, Cylinder }

public enum PartColor { Coat, Pants, Skin, Hat, Shoe, Device, DeviceGlow, Shroud, ShroudDark, Eyes }

[Serializable]
public struct RigVec
{
    public float x, y, z;
    public RigVec(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
    public static readonly RigVec Zero = new RigVec(0, 0, 0);
    public static readonly RigVec One = new RigVec(1, 1, 1);
}

public class BoneDef
{
    public RigBone Bone; public RigBone? Parent; public RigVec Pivot;
    public BoneDef(RigBone b, RigBone? p, float x, float y, float z) { Bone = b; Parent = p; Pivot = new RigVec(x, y, z); }
}

public class PartDef
{
    public RigBone Bone; public PartShape Shape; public RigVec Center; public RigVec Size; public PartColor Color;
    public PartDef(RigBone b, PartShape s, PartColor c, float cx, float cy, float cz, float sx, float sy, float sz)
    { Bone = b; Shape = s; Color = c; Center = new RigVec(cx, cy, cz); Size = new RigVec(sx, sy, sz); }
}

/// <summary>Esqueleto e peças das figuras procedurais (metros; frente = +Z; pés em y = 0).</summary>
public static class CharacterBodyLayout
{
    public static List<BoneDef> Bones(CharacterStyle style)
    {
        if (style == CharacterStyle.Hunter)
            return new List<BoneDef>
            {
                new BoneDef(RigBone.Body, null, 0, 0, 0),
                new BoneDef(RigBone.Hips, RigBone.Body, 0, .95f, 0),
                new BoneDef(RigBone.Spine, RigBone.Hips, 0, .08f, 0),
                new BoneDef(RigBone.Head, RigBone.Spine, 0, .60f, 0),
                new BoneDef(RigBone.UpperArmL, RigBone.Spine, -.26f, .52f, 0),
                new BoneDef(RigBone.ForearmL, RigBone.UpperArmL, 0, -.30f, 0),
                new BoneDef(RigBone.UpperArmR, RigBone.Spine, .26f, .52f, 0),
                new BoneDef(RigBone.ForearmR, RigBone.UpperArmR, 0, -.30f, 0),
                new BoneDef(RigBone.ThighL, RigBone.Hips, -.10f, -.02f, 0),
                new BoneDef(RigBone.ShinL, RigBone.ThighL, 0, -.45f, 0),
                new BoneDef(RigBone.ThighR, RigBone.Hips, .10f, -.02f, 0),
                new BoneDef(RigBone.ShinR, RigBone.ThighR, 0, -.45f, 0),
            };
        return new List<BoneDef>
        {
            new BoneDef(RigBone.Body, null, 0, .25f, 0),
            new BoneDef(RigBone.Spine, RigBone.Body, 0, .62f, 0),
            new BoneDef(RigBone.Head, RigBone.Spine, 0, .62f, 0),
            new BoneDef(RigBone.UpperArmL, RigBone.Spine, -.27f, .50f, 0),
            new BoneDef(RigBone.ForearmL, RigBone.UpperArmL, 0, -.34f, 0),
            new BoneDef(RigBone.UpperArmR, RigBone.Spine, .27f, .50f, 0),
            new BoneDef(RigBone.ForearmR, RigBone.UpperArmR, 0, -.34f, 0),
            new BoneDef(RigBone.Skirt1, RigBone.Spine, 0, -.05f, 0),
            new BoneDef(RigBone.Skirt2, RigBone.Skirt1, 0, -.28f, 0),
            new BoneDef(RigBone.Skirt3, RigBone.Skirt2, 0, -.24f, 0),
        };
    }

    public static List<PartDef> Parts(CharacterStyle style)
    {
        if (style == CharacterStyle.Hunter)
            return new List<PartDef>
            {
                // casaco longo de investigador vitoriano, chapéu-coco, aspirador ectoplásmico na mão direita
                new PartDef(RigBone.Hips, PartShape.Box, PartColor.Coat, 0, -.10f, 0, .44f, .34f, .27f),
                new PartDef(RigBone.Spine, PartShape.Box, PartColor.Coat, 0, .30f, 0, .44f, .56f, .26f),
                new PartDef(RigBone.Spine, PartShape.Box, PartColor.Skin, 0, .56f, .02f, .14f, .08f, .14f),
                new PartDef(RigBone.Head, PartShape.Sphere, PartColor.Skin, 0, .12f, 0, .23f, .25f, .23f),
                new PartDef(RigBone.Head, PartShape.Cylinder, PartColor.Hat, 0, .21f, 0, .36f, .02f, .36f),
                new PartDef(RigBone.Head, PartShape.Cylinder, PartColor.Hat, 0, .29f, 0, .22f, .15f, .22f),
                new PartDef(RigBone.UpperArmL, PartShape.Capsule, PartColor.Coat, 0, -.15f, 0, .12f, .34f, .12f),
                new PartDef(RigBone.ForearmL, PartShape.Capsule, PartColor.Coat, 0, -.13f, 0, .11f, .30f, .11f),
                new PartDef(RigBone.ForearmL, PartShape.Sphere, PartColor.Skin, 0, -.29f, 0, .09f, .09f, .09f),
                new PartDef(RigBone.UpperArmR, PartShape.Capsule, PartColor.Coat, 0, -.15f, 0, .12f, .34f, .12f),
                new PartDef(RigBone.ForearmR, PartShape.Capsule, PartColor.Coat, 0, -.13f, 0, .11f, .30f, .11f),
                new PartDef(RigBone.ForearmR, PartShape.Sphere, PartColor.Skin, 0, -.29f, 0, .09f, .09f, .09f),
                new PartDef(RigBone.ForearmR, PartShape.Box, PartColor.Device, 0, -.44f, .04f, .09f, .34f, .09f),
                new PartDef(RigBone.ForearmR, PartShape.Cylinder, PartColor.DeviceGlow, 0, -.62f, .04f, .07f, .03f, .07f),
                new PartDef(RigBone.ThighL, PartShape.Capsule, PartColor.Pants, 0, -.22f, 0, .15f, .48f, .15f),
                new PartDef(RigBone.ShinL, PartShape.Capsule, PartColor.Pants, 0, -.21f, 0, .13f, .44f, .13f),
                new PartDef(RigBone.ShinL, PartShape.Box, PartColor.Shoe, 0, -.44f, .05f, .11f, .07f, .25f),
                new PartDef(RigBone.ThighR, PartShape.Capsule, PartColor.Pants, 0, -.22f, 0, .15f, .48f, .15f),
                new PartDef(RigBone.ShinR, PartShape.Capsule, PartColor.Pants, 0, -.21f, 0, .13f, .44f, .13f),
                new PartDef(RigBone.ShinR, PartShape.Box, PartColor.Shoe, 0, -.44f, .05f, .11f, .07f, .25f),
            };
        return new List<PartDef>
        {
            // mortalha com capuz, braços longos e cauda de três gomos que ondula
            new PartDef(RigBone.Spine, PartShape.Capsule, PartColor.Shroud, 0, .22f, 0, .50f, .80f, .40f),
            new PartDef(RigBone.Head, PartShape.Sphere, PartColor.Shroud, 0, .12f, -.02f, .32f, .34f, .32f),
            new PartDef(RigBone.Head, PartShape.Sphere, PartColor.ShroudDark, 0, .11f, .05f, .24f, .26f, .24f),
            new PartDef(RigBone.Head, PartShape.Sphere, PartColor.Eyes, -.055f, .13f, .16f, .05f, .035f, .03f),
            new PartDef(RigBone.Head, PartShape.Sphere, PartColor.Eyes, .055f, .13f, .16f, .05f, .035f, .03f),
            new PartDef(RigBone.UpperArmL, PartShape.Capsule, PartColor.Shroud, 0, -.17f, 0, .10f, .38f, .10f),
            new PartDef(RigBone.ForearmL, PartShape.Capsule, PartColor.Shroud, 0, -.16f, 0, .09f, .36f, .09f),
            new PartDef(RigBone.ForearmL, PartShape.Sphere, PartColor.ShroudDark, 0, -.35f, .02f, .10f, .07f, .12f),
            new PartDef(RigBone.UpperArmR, PartShape.Capsule, PartColor.Shroud, 0, -.17f, 0, .10f, .38f, .10f),
            new PartDef(RigBone.ForearmR, PartShape.Capsule, PartColor.Shroud, 0, -.16f, 0, .09f, .36f, .09f),
            new PartDef(RigBone.ForearmR, PartShape.Sphere, PartColor.ShroudDark, 0, -.35f, .02f, .10f, .07f, .12f),
            new PartDef(RigBone.Skirt1, PartShape.Capsule, PartColor.Shroud, 0, -.14f, 0, .48f, .36f, .38f),
            new PartDef(RigBone.Skirt2, PartShape.Capsule, PartColor.Shroud, 0, -.13f, 0, .36f, .32f, .29f),
            new PartDef(RigBone.Skirt3, PartShape.Capsule, PartColor.Shroud, 0, -.11f, 0, .20f, .28f, .17f),
        };
    }
}

/// <summary>Estado de entrada do animador (preenchido pelo CharacterAnimator a cada quadro).</summary>
public class AnimState
{
    public CharacterStyle Style;
    public float Time;               // relógio contínuo (s)
    public float Speed;              // velocidade horizontal (m/s)
    public float CyclePhase;         // fase integrada do ciclo de passos (rad)
    public bool Sprinting;
    public float AimWeight;          // 0..1 (suavizado)
    public float TimeSinceHit = 99f;
    public float TimeSinceAttack = 99f;
    public float TimeSinceDeath = -1f;   // <0 = vivo
    public float TimeSinceEmerge = 99f;
    public float FuryWeight;         // 0..1 (Caçada Invertida)
}

public class CharacterPose
{
    public readonly RigVec[] Rot = new RigVec[Enum.GetValues(typeof(RigBone)).Length];
    public RigVec RootOffset = RigVec.Zero;
    public RigVec RootEuler = RigVec.Zero;
    public float RootScale = 1f;
    public RigVec Get(RigBone b) => Rot[(int)b];
    public void Set(RigBone b, float x, float y, float z) => Rot[(int)b] = new RigVec(x, y, z);
    public void Add(RigBone b, float x, float y, float z) { var r = Rot[(int)b]; Rot[(int)b] = new RigVec(r.x + x, r.y + y, r.z + z); }
}

/// <summary>Calcula a pose de cada quadro. Puro e determinístico (mesma entrada → mesma pose).</summary>
public static class CharacterPoseSolver
{
    public const float AttackDuration = 0.45f;
    public const float AttackStrikeTime = 0.18f; // instante em que o golpe acerta
    public const float DeathDuration = 0.8f;
    public const float EmergeDuration = 0.4f;
    public const float HitDuration = 0.35f;

    static float Clamp01(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
    static float Smooth(float a, float b, float t) { t = Clamp01((t - a) / (b - a)); return t * t * (3 - 2 * t); }
    static float Sin(float v) => (float)Math.Sin(v);
    static float Cos(float v) => (float)Math.Cos(v);
    static float Lerp(float a, float b, float t) => a + (b - a) * t;

    public static CharacterPose Solve(AnimState s)
    {
        return s.Style == CharacterStyle.Hunter ? SolveHunter(s) : SolveGhost(s);
    }

    static CharacterPose SolveHunter(AnimState s)
    {
        var p = new CharacterPose();
        float walkW = Clamp01(s.Speed / 3.8f);
        float runW = Clamp01((s.Speed - 3.8f) / 2.4f);
        float amp = 28f * walkW + 17f * runW;
        float ph = s.CyclePhase;
        float sinL = Sin(ph), sinR = -sinL;

        // Pernas: coxa vai para frente (x negativo) e o joelho dobra quando a perna passa por trás
        p.Set(RigBone.ThighL, -sinL * amp, 0, 0);
        p.Set(RigBone.ThighR, -sinR * amp, 0, 0);
        p.Set(RigBone.ShinL, Math.Max(0, Sin(ph - 1.3f)) * amp * 1.5f + 3f * walkW, 0, 0);
        p.Set(RigBone.ShinR, Math.Max(0, Sin(ph + (float)Math.PI - 1.3f)) * amp * 1.5f + 3f * walkW, 0, 0);

        // Braços em oposição às pernas, levemente abertos; antebraço dobra mais correndo
        float breathe = Sin(s.Time * 1.6f);
        p.Set(RigBone.UpperArmL, sinL * amp * .75f, 0, -6f);
        p.Set(RigBone.UpperArmR, sinR * amp * .75f, 0, 6f);
        p.Set(RigBone.ForearmL, -12f - 45f * runW, 0, 0);
        p.Set(RigBone.ForearmR, -12f - 45f * runW, 0, 0);

        // Tronco: inclina para frente correndo, gira com a passada, respira parado
        p.Set(RigBone.Spine, 3f + 12f * runW + breathe * 1.2f * (1 - walkW), sinL * 6f * walkW, 0);
        p.Set(RigBone.Head, -3f - 6f * runW, -sinL * 3f * walkW, 0);
        p.RootOffset = new RigVec(0, Math.Abs(Cos(ph)) * (.025f * walkW + .03f * runW) - .02f * walkW, 0);

        // Mira do aspirador: braço direito estendido, esquerdo apoiando
        float a = Clamp01(s.AimWeight);
        if (a > 0)
        {
            Blend(p, RigBone.UpperArmR, -82f, 0, 4f, a);
            Blend(p, RigBone.ForearmR, -8f, 0, 0, a);
            Blend(p, RigBone.UpperArmL, -62f, 0, 28f, a);
            Blend(p, RigBone.ForearmL, -48f, 0, 0, a);
        }

        // Golpe recebido: tranco para trás
        if (s.TimeSinceHit < HitDuration)
        {
            float w = Sin((float)Math.PI * s.TimeSinceHit / HitDuration);
            p.Add(RigBone.Spine, -16f * w, 0, 4f * w);
            p.Add(RigBone.Head, -14f * w, 0, 0);
            p.Add(RigBone.UpperArmL, -25f * w, 0, -20f * w);
            p.Add(RigBone.UpperArmR, -25f * w, 0, 20f * w);
        }

        // Morte: cai de costas, braços abertos, joelhos dobram no meio da queda
        if (s.TimeSinceDeath >= 0)
        {
            float w = Smooth(0, DeathDuration, s.TimeSinceDeath);
            float knee = Sin((float)Math.PI * Clamp01(s.TimeSinceDeath / DeathDuration));
            p.RootEuler = new RigVec(-88f * w, 0, 6f * w);
            p.RootOffset = new RigVec(0, .12f * w, 0);
            Blend(p, RigBone.Spine, -6f, 0, 0, w);
            Blend(p, RigBone.Head, -20f, 25f, 0, w);
            Blend(p, RigBone.UpperArmL, -40f, 0, -75f, w);
            Blend(p, RigBone.UpperArmR, -30f, 0, 80f, w);
            Blend(p, RigBone.ForearmL, -20f, 0, 0, w);
            Blend(p, RigBone.ForearmR, -35f, 0, 0, w);
            Blend(p, RigBone.ThighL, -25f * knee - 5f, 0, -6f, w);
            Blend(p, RigBone.ThighR, -10f * knee, 0, 8f, w);
            Blend(p, RigBone.ShinL, 40f * knee + 8f, 0, 0, w);
            Blend(p, RigBone.ShinR, 20f * knee + 4f, 0, 0, w);
        }
        return p;
    }

    static CharacterPose SolveGhost(AnimState s)
    {
        var p = new CharacterPose();
        float t = s.Time;
        float move = Clamp01(s.Speed / 5f);
        float fury = Clamp01(s.FuryWeight);

        // Flutuação e ondulação da cauda (atrasada a cada gomo); ao se mover a cauda arrasta para trás
        p.RootOffset = new RigVec(0, Sin(t * 2.1f) * .07f, 0);
        p.Set(RigBone.Skirt1, Sin(t * 2.6f) * 6f + 14f * move, 0, Sin(t * 1.7f) * 4f);
        p.Set(RigBone.Skirt2, Sin(t * 2.6f - .8f) * 9f + 12f * move, 0, Sin(t * 1.7f - .8f) * 6f);
        p.Set(RigBone.Skirt3, Sin(t * 2.6f - 1.6f) * 13f + 10f * move, 0, Sin(t * 1.7f - 1.6f) * 9f);
        p.Set(RigBone.Spine, 4f + 16f * move + Sin(t * 1.3f) * 2f, 0, 0);
        p.Set(RigBone.Head, -6f * move + Sin(t * .9f) * 4f, Sin(t * .7f) * 10f, 0);

        // Braços: pendem à frente e flutuam; arrastam para trás em movimento
        p.Set(RigBone.UpperArmL, -22f + Sin(t * 1.7f) * 8f + 35f * move, 0, -14f);
        p.Set(RigBone.UpperArmR, -22f + Sin(t * 1.7f + 1.3f) * 8f + 35f * move, 0, 14f);
        p.Set(RigBone.ForearmL, -28f + Sin(t * 2.2f) * 6f, 0, 0);
        p.Set(RigBone.ForearmR, -28f + Sin(t * 2.2f + 1f) * 6f, 0, 0);

        // Fúria (Caçada Invertida): garras erguidas, cabeça treme
        if (fury > 0)
        {
            Blend(p, RigBone.UpperArmL, -70f + Sin(t * 3f) * 6f, 0, -28f, fury);
            Blend(p, RigBone.UpperArmR, -70f + Sin(t * 3f + 1f) * 6f, 0, 28f, fury);
            Blend(p, RigBone.ForearmL, -38f, 0, 10f, fury);
            Blend(p, RigBone.ForearmR, -38f, 0, -10f, fury);
            p.Add(RigBone.Head, Sin(t * 31f) * 3f * fury, Sin(t * 37f) * 5f * fury, Sin(t * 29f) * 3f * fury);
            p.Add(RigBone.Spine, 10f * fury, 0, 0);
        }

        // Ataque (Toque Gélido): prepara erguendo os braços, golpeia para frente, avança o corpo
        if (s.TimeSinceAttack < AttackDuration)
        {
            float u = s.TimeSinceAttack;
            float wind = Smooth(0, .12f, u) * (1 - Smooth(.12f, AttackStrikeTime, u));
            float strike = Smooth(.12f, AttackStrikeTime, u) * (1 - Smooth(.28f, AttackDuration, u));
            float armX = -150f * wind + -55f * strike;
            float w = Math.Max(wind, strike);
            Blend(p, RigBone.UpperArmL, armX, 0, -18f, w);
            Blend(p, RigBone.UpperArmR, armX, 0, 18f, w);
            Blend(p, RigBone.ForearmL, -20f * wind - 5f * strike, 0, 0, w);
            Blend(p, RigBone.ForearmR, -20f * wind - 5f * strike, 0, 0, w);
            p.Add(RigBone.Spine, -12f * wind + 28f * strike, 0, 0);
            p.RootOffset = new RigVec(0, p.RootOffset.y + .05f * wind, .35f * strike);
        }

        // Surgir do móvel: cresce com leve ultrapassagem
        if (s.TimeSinceEmerge < EmergeDuration)
        {
            float u = Clamp01(s.TimeSinceEmerge / EmergeDuration);
            float back = 1 + 2.2f * (float)Math.Pow(u - 1, 3) + 1.2f * (float)Math.Pow(u - 1, 2); // ease-out-back
            p.RootScale = Lerp(.15f, 1f, back);
        }

        // Exorcismo: gira, sobe e some
        if (s.TimeSinceDeath >= 0)
        {
            float w = Smooth(0, DeathDuration, s.TimeSinceDeath);
            p.RootScale = Math.Max(0f, 1f - w);
            p.RootEuler = new RigVec(0, 540f * w, 0);
            p.RootOffset = new RigVec(0, p.RootOffset.y + .6f * w, 0);
            Blend(p, RigBone.UpperArmL, -170f, 0, -40f, w);
            Blend(p, RigBone.UpperArmR, -170f, 0, 40f, w);
            Blend(p, RigBone.Head, -35f, 0, 0, w);
        }
        return p;
    }

    static void Blend(CharacterPose p, RigBone b, float x, float y, float z, float w)
    {
        var r = p.Get(b);
        p.Set(b, Lerp(r.x, x, w), Lerp(r.y, y, w), Lerp(r.z, z, w));
    }
}
