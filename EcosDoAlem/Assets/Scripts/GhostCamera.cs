using System;
using UnityEngine;

/// <summary>
/// Câmera em 3ª pessoa do fantasma. Orbita a forma etérea ou o móvel possuído, com recuo
/// automático quando há parede entre a câmera e o alvo.
/// </summary>
[RequireComponent(typeof(Camera))]
public class GhostCamera : MonoBehaviour
{
    public GhostController ghost;
    public float distance = 3.5f;
    public float possessedDistance = 4.5f;
    public float sensitivity = 3.0f;
    public float minPitch = -30f;
    public float maxPitch = 70f;
    public float collisionRadius = 0.25f;
    public float followSharpness = 15f;

    private float yaw;
    private float pitch = 15f;
    private float currentDistance;

    void Start()
    {
        if (ghost != null && ghost.ghostCamera == null) ghost.ghostCamera = transform;
        if (ghost == null || ghost.isLocallyControlled)
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }
        yaw = transform.eulerAngles.y;
        currentDistance = distance;
    }

    void LateUpdate()
    {
        if (ghost == null || !ghost.gameObject.activeInHierarchy) return; // exorcizado: câmera fica parada

        if (ghost.isLocallyControlled && ghost.inputEnabled && !GameMenu.InputBlocked)
        {
            yaw += Input.GetAxis("Mouse X") * sensitivity;
            pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * sensitivity, minPitch, maxPitch);
        }

        Vector3 focus = ghost.CameraFocus;
        Quaternion rot = Quaternion.Euler(pitch, yaw, 0f);
        float wanted = ghost.IsPossessing ? possessedDistance : distance;
        Vector3 back = rot * Vector3.back;

        // Colisão: ignora o próprio fantasma, o móvel possuído e triggers.
        float allowed = wanted;
        RaycastHit[] hits = Physics.SphereCastAll(focus, collisionRadius, back, wanted, ~0, QueryTriggerInteraction.Ignore);
        Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
        foreach (var h in hits)
        {
            Transform t = h.collider.transform;
            if (t == ghost.transform || t.IsChildOf(ghost.transform)) continue;
            if (ghost.CurrentProp != null && (t == ghost.CurrentProp.transform || t.IsChildOf(ghost.CurrentProp.transform))) continue;
            if (h.distance <= 0f) continue; // começou dentro do collider
            allowed = Mathf.Max(0.3f, h.distance - 0.05f);
            break;
        }

        currentDistance = allowed < currentDistance
            ? allowed
            : Mathf.Lerp(currentDistance, allowed, Time.deltaTime * followSharpness * 0.3f);

        transform.SetPositionAndRotation(focus + back * currentDistance, rot);
    }
}
