using UnityEngine;

/// <summary>Visibilidade local das pegadas espectrais (ligada pela Câmera Térmica do caçador local).</summary>
public static class SpectralVisibility
{
    public static bool Visible = false;
}

/// <summary>
/// Pegada espectral deixada pelo fantasma em forma etérea. Só aparece com a Câmera Térmica/UV ligada
/// e encolhe até sumir no fim da vida útil ("pegadas frescas").
/// </summary>
public class SpectralFootprint : MonoBehaviour
{
    public float lifetime = 12f;

    private float bornAt;
    private Vector3 baseScale;
    private Renderer[] renderers;

    public static SpectralFootprint Spawn(GameObject prefab, Vector3 feetPosition, Quaternion facing, float lifetime)
    {
        Vector3 pos = feetPosition + Vector3.up * 0.02f;
        GameObject go;
        if (prefab != null)
        {
            go = Instantiate(prefab, pos, facing);
        }
        else
        {
            go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = "PegadaEspectral";
            go.transform.SetPositionAndRotation(pos, facing * Quaternion.Euler(90f, 0f, 0f));
            go.transform.localScale = new Vector3(0.12f, 0.28f, 1f);
            Collider c = go.GetComponent<Collider>();
            if (c != null) Destroy(c);
            Renderer r = go.GetComponent<Renderer>();
            if (r != null)
            {
                r.material.color = new Color(0.3f, 1f, 0.85f);
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
        }

        SpectralFootprint fp = go.GetComponent<SpectralFootprint>();
        if (fp == null) fp = go.AddComponent<SpectralFootprint>();
        fp.lifetime = lifetime;
        return fp;
    }

    void Start()
    {
        bornAt = Time.time;
        baseScale = transform.localScale;
        renderers = GetComponentsInChildren<Renderer>();
        ApplyVisibility();
    }

    void Update()
    {
        float age = Time.time - bornAt;
        if (age >= lifetime) { Destroy(gameObject); return; }

        float fadeStart = lifetime * 0.6f;
        if (age > fadeStart)
        {
            float k = 1f - (age - fadeStart) / (lifetime - fadeStart);
            transform.localScale = baseScale * Mathf.Max(0.05f, k);
        }
        ApplyVisibility();
    }

    void ApplyVisibility()
    {
        if (renderers == null) return;
        bool vis = SpectralVisibility.Visible;
        foreach (var r in renderers)
            if (r != null && r.enabled != vis) r.enabled = vis;
    }
}
