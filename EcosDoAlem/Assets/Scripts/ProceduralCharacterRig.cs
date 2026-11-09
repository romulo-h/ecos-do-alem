using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Monta uma figura low-poly com primitivas (caçador vitoriano ou fantasma de mortalha) a partir do
/// CharacterBodyLayout. Usada enquanto o modelo real (cacador_e_fantasma.glb) não está no projeto.
/// </summary>
public class ProceduralCharacterRig : MonoBehaviour
{
    public CharacterStyle style = CharacterStyle.Hunter;

    [Header("Cores")]
    public Color coat = new Color(0.18f, 0.16f, 0.14f);
    public Color pants = new Color(0.12f, 0.11f, 0.11f);
    public Color skin = new Color(0.86f, 0.70f, 0.58f);
    public Color hat = new Color(0.08f, 0.07f, 0.07f);
    public Color shoe = new Color(0.10f, 0.06f, 0.04f);
    public Color device = new Color(0.55f, 0.42f, 0.20f);
    public Color deviceGlow = new Color(0.35f, 1.0f, 0.75f);
    public Color shroud = new Color(0.78f, 0.86f, 0.92f);
    public Color shroudDark = new Color(0.12f, 0.14f, 0.18f);
    public Color eyes = new Color(0.55f, 0.95f, 1.0f);
    public Color furyEyes = new Color(1.0f, 0.15f, 0.1f);

    public Transform RigRoot { get; private set; }
    public readonly Dictionary<RigBone, Transform> bones = new Dictionary<RigBone, Transform>();
    private readonly List<(Renderer r, PartColor c)> parts = new List<(Renderer, PartColor)>();

    /// <summary>Cria a figura como filho de 'owner' e devolve o componente.</summary>
    public static ProceduralCharacterRig Create(Transform owner, CharacterStyle style)
    {
        GameObject go = new GameObject(style == CharacterStyle.Hunter ? "Cacador_Procedural" : "Fantasma_Procedural");
        go.transform.SetParent(owner, false);
        var rig = go.AddComponent<ProceduralCharacterRig>();
        rig.style = style;
        rig.Build();
        return rig;
    }

    public void Build()
    {
        if (RigRoot != null) return;
        RigRoot = new GameObject("Rig").transform;
        RigRoot.SetParent(transform, false);

        foreach (var b in CharacterBodyLayout.Bones(style))
        {
            Transform t = new GameObject(b.Bone.ToString()).transform;
            Transform parent = b.Parent.HasValue ? bones[b.Parent.Value] : RigRoot;
            t.SetParent(parent, false);
            t.localPosition = new Vector3(b.Pivot.x, b.Pivot.y, b.Pivot.z);
            bones[b.Bone] = t;
        }

        foreach (var p in CharacterBodyLayout.Parts(style))
        {
            PrimitiveType type = p.Shape == PartShape.Box ? PrimitiveType.Cube
                               : p.Shape == PartShape.Sphere ? PrimitiveType.Sphere
                               : p.Shape == PartShape.Capsule ? PrimitiveType.Capsule : PrimitiveType.Cylinder;
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = p.Color + "_" + p.Shape;
            Collider c = go.GetComponent<Collider>();
            if (c != null) Destroy(c); // a colisão é do CharacterController
            go.transform.SetParent(bones[p.Bone], false);
            go.transform.localPosition = new Vector3(p.Center.x, p.Center.y, p.Center.z);
            // Cápsula e cilindro do Unity têm 2 m de altura: a altura pedida vira escala/2
            float sy = (p.Shape == PartShape.Capsule || p.Shape == PartShape.Cylinder) ? p.Size.y / 2f : p.Size.y;
            go.transform.localScale = new Vector3(p.Size.x, sy, p.Size.z);
            Renderer r = go.GetComponent<Renderer>();
            parts.Add((r, p.Color));
        }
        ApplyColors(false, 0f);
    }

    Color Base(PartColor c)
    {
        switch (c)
        {
            case PartColor.Coat: return coat;
            case PartColor.Pants: return pants;
            case PartColor.Skin: return skin;
            case PartColor.Hat: return hat;
            case PartColor.Shoe: return shoe;
            case PartColor.Device: return device;
            case PartColor.DeviceGlow: return deviceGlow;
            case PartColor.Shroud: return shroud;
            case PartColor.ShroudDark: return shroudDark;
            default: return eyes;
        }
    }

    /// <summary>Atualiza as cores: 'flash' clareia tudo (fantasma exposto); 'fury' deixa olhos vermelhos e mortalha mais escura.</summary>
    public void ApplyColors(bool flash, float fury)
    {
        foreach (var (r, c) in parts)
        {
            if (r == null) continue;
            Color col = Base(c);
            if (c == PartColor.Eyes) col = Color.Lerp(eyes, furyEyes, fury);
            else if (c == PartColor.Shroud) col = Color.Lerp(col, new Color(0.45f, 0.5f, 0.58f), fury * 0.6f);
            if (flash) col = Color.Lerp(col, Color.white, 0.75f);
            r.material.color = col;
        }
    }

    public void SetShadowsOnly(bool on)
    {
        foreach (var (r, _) in parts)
            if (r != null) r.shadowCastingMode = on ? UnityEngine.Rendering.ShadowCastingMode.ShadowsOnly : UnityEngine.Rendering.ShadowCastingMode.On;
    }
}
