using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Linha de Sal Purificador. Bloqueia fantasmas (movimento e Salto Espectral) por um tempo limitado.
/// Caçadores passam normalmente. Não depende de Layers: o bloqueio é checado pelo GhostController.
/// </summary>
public class SaltBarrier : MonoBehaviour
{
    public static readonly List<SaltBarrier> Active = new List<SaltBarrier>();

    [Tooltip("Largura (X), altura (Y) e espessura (Z) do volume bloqueado.")]
    public Vector3 size = new Vector3(1.6f, 2.4f, 0.4f);
    public float duration = 20f;

    private float expiresAt;

    public float TimeRemaining => Mathf.Max(0f, expiresAt - Time.time);

    public static SaltBarrier Create(GameObject prefab, Vector3 position, Quaternion rotation, Vector3 size, float duration)
    {
        GameObject go;
        if (prefab != null)
        {
            go = Instantiate(prefab, position, rotation);
        }
        else
        {
            // Visual simples: faixa branca de sal no chão.
            go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "SalPurificador";
            go.transform.SetPositionAndRotation(position + Vector3.up * 0.01f, rotation);
            go.transform.localScale = new Vector3(size.x, 0.02f, size.z);
            Collider c = go.GetComponent<Collider>();
            if (c != null) Destroy(c);
            Renderer r = go.GetComponent<Renderer>();
            if (r != null) r.material.color = new Color(0.95f, 0.95f, 0.9f);
        }

        SaltBarrier barrier = go.GetComponent<SaltBarrier>();
        if (barrier == null) barrier = go.AddComponent<SaltBarrier>();
        barrier.size = size;
        barrier.duration = duration;
        barrier.expiresAt = Time.time + duration;
        return barrier;
    }

    void OnEnable()
    {
        if (!Active.Contains(this)) Active.Add(this);
        expiresAt = Time.time + duration;
    }

    void OnDisable() { Active.Remove(this); }

    void Update()
    {
        if (Time.time >= expiresAt) Destroy(gameObject);
    }

    public bool ContainsPoint(Vector3 world, float margin)
    {
        Vector3 local = Quaternion.Inverse(transform.rotation) * (world - transform.position);
        return Mathf.Abs(local.x) <= size.x * 0.5f + margin
            && Mathf.Abs(local.z) <= size.z * 0.5f + margin
            && local.y >= -0.5f && local.y <= size.y;
    }

    /// <summary>Verdadeiro se mover de 'from' para 'to' entra numa barreira (sair de dentro é permitido).</summary>
    public static bool BlocksMove(Vector3 from, Vector3 to, float margin)
    {
        foreach (var b in Active)
        {
            if (b == null) continue;
            if (b.ContainsPoint(to, margin) && !b.ContainsPoint(from, margin)) return true;
        }
        return false;
    }

    /// <summary>Verdadeiro se o segmento a→b atravessa alguma barreira (usado no Salto Espectral).</summary>
    public static bool SegmentBlocked(Vector3 a, Vector3 b)
    {
        const int samples = 24;
        foreach (var barrier in Active)
        {
            if (barrier == null) continue;
            for (int i = 0; i <= samples; i++)
            {
                if (barrier.ContainsPoint(Vector3.Lerp(a, b, i / (float)samples), 0f)) return true;
            }
        }
        return false;
    }

    void OnDrawGizmos()
    {
        Gizmos.color = new Color(1f, 1f, 1f, 0.35f);
        Gizmos.matrix = Matrix4x4.TRS(transform.position, transform.rotation, Vector3.one);
        Gizmos.DrawWireCube(new Vector3(0f, size.y * 0.5f, 0f), size);
    }
}
