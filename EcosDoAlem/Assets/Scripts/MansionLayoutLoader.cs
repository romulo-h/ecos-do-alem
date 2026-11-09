using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Monta a mansão a partir de map_data.json e props_layout.json:
///   • greybox jogável: pisos, escadas, paredes internas/externas (MansionWalls), vergas,
///     guarda-corpos, varanda e portas que abrem (MansionDoor);
///   • os 36 móveis possuíveis — usa o prefab do móvel se houver, senão um bloco no tamanho do catálogo;
///   • posiciona fantasmas e caçadores nos pontos de spawn.
/// Coloque num GameObject vazio, arraste os dois JSON (TextAsset) e os sons, e dê Play.
/// </summary>
public class MansionLayoutLoader : MonoBehaviour
{
    [Serializable]
    public class PropPrefabBinding
    {
        public string catalogId;   // ex.: "prop_clock"
        public GameObject prefab;  // modelo importado (ex.: relogio_pendulo.obj)
    }

    [Header("Dados")]
    public TextAsset mapJson;    // map_data.json
    public TextAsset propsJson;  // props_layout.json

    [Header("Geração")]
    public bool buildOnAwake = true;
    public bool buildGreybox = true;
    public bool spawnProps = true;
    public bool placePlayersAtSpawnPoints = true;
    public float wallThickness = 0.2f;
    public float slabThickness = 0.2f;
    public float stepHeight = 0.2f;
    public Material greyboxMaterial;

    [Header("Prefabs dos Móveis (opcional)")]
    [Tooltip("Tem prioridade sobre os modelos de Resources.")]
    public List<PropPrefabBinding> propPrefabs = new List<PropPrefabBinding>();
    [Tooltip("Se não houver prefab ligado, carrega Resources/<pasta>/<model do catálogo sem extensão> (ex.: Resources/Moveis/cama_vitoriana.obj).")]
    public bool loadModelsFromResources = true;
    public string resourcesFolder = "Moveis";

    [Header("Sons padrão dos Móveis")]
    public AudioClip defaultPossessSound;
    public AudioClip defaultHauntSound;  // interacao_movel_assombrado.wav
    public AudioClip clockTickSound;     // relogio_pendulo_tic_tac.wav
    public AudioClip glassHauntSound;    // copo_tilintando.wav (Louça)
    public AudioClip plantHauntSound;    // planta_farfalhar.wav (Planta)

    [Header("Sons das Portas")]
    public AudioClip doorCreakSound;     // porta_rangendo.wav
    public AudioClip doorSlamSound;      // porta_batendo.wav
    public float propAudioMaxDistance = 18f;

    private Transform root;

    void Awake()
    {
        if (buildOnAwake) Build();
    }

    [ContextMenu("Gerar Mansão")]
    public void Build()
    {
        if (mapJson == null || propsJson == null)
        {
            Debug.LogError("[MansionLayoutLoader] Atribua map_data.json e props_layout.json.");
            return;
        }

        MapData map = JsonUtility.FromJson<MapData>(mapJson.text);
        PropsFile props = JsonUtility.FromJson<PropsFile>(propsJson.text);

        Transform old = transform.Find("Mansao_Gerada");
        if (old != null) DestroyImmediateSafe(old.gameObject);
        root = new GameObject("Mansao_Gerada").transform;
        root.SetParent(transform, false);

        if (buildGreybox) BuildGreybox(map);
        if (spawnProps) SpawnProps(props);
        if (placePlayersAtSpawnPoints && Application.isPlaying) PlacePlayers(map);
    }

    // ------------------------------------------------------------------ Greybox

    void BuildGreybox(MapData map)
    {
        float fh = map.dimensions.floor_height;
        DoorSettings ds = map.door_settings ?? new DoorSettings();
        Transform geo = new GameObject("Greybox").transform;
        geo.SetParent(root, false);

        // Piso térreo: cobre todos os cômodos do térreo (inclui a varanda)
        float minX = float.MaxValue, minZ = float.MaxValue, maxX = float.MinValue, maxZ = float.MinValue;
        foreach (var f in map.floors)
        {
            if (f.floor_index != 0) continue;
            foreach (var r in f.rooms)
            {
                minX = Mathf.Min(minX, r.bounds.min[0]); minZ = Mathf.Min(minZ, r.bounds.min[1]);
                maxX = Mathf.Max(maxX, r.bounds.max[0]); maxZ = Mathf.Max(maxZ, r.bounds.max[1]);
            }
        }
        Box(geo, "Piso_Terreo", new Vector3((minX + maxX) / 2, -slabThickness / 2, (minZ + maxZ) / 2),
            new Vector3(maxX - minX, slabThickness, maxZ - minZ), new Color(0.35f, 0.27f, 0.2f));

        // Pisos superiores por cômodo, com buraco nas escadas
        var holeRects = new List<Rect>();
        foreach (var c in map.vertical_connectors)
            holeRects.Add(Rect.MinMaxRect(c.position.x[0], c.position.z[0], c.position.x[1], c.position.z[1]));

        foreach (var f in map.floors)
        {
            if (f.floor_index == 0) continue;
            float top = f.floor_index * fh;
            foreach (var room in f.rooms)
            {
                if (room.outdoor) continue;
                var pieces = new List<Rect> { Rect.MinMaxRect(room.bounds.min[0], room.bounds.min[1], room.bounds.max[0], room.bounds.max[1]) };
                foreach (var hole in holeRects) pieces = SubtractAll(pieces, hole);
                int i = 0;
                foreach (var pc in pieces)
                {
                    Box(geo, $"Piso_{f.floor_index}_{room.name}_{i++}",
                        new Vector3(pc.center.x, top - slabThickness / 2, pc.center.y),
                        new Vector3(pc.width, slabThickness, pc.height), new Color(0.4f, 0.3f, 0.22f));
                }
            }
        }

        // Escadas (degraus maciços + rampa invisível para o CharacterController)
        foreach (var c in map.vertical_connectors) BuildStairs(geo, c);

        // Blocos sólidos (núcleo da escada dupla etc.)
        if (map.solid_blocks != null)
            foreach (var b in map.solid_blocks)
            {
                Vector3 mn = new Vector3(b.min[0], b.min[1], b.min[2]), mx = new Vector3(b.max[0], b.max[1], b.max[2]);
                Box(geo, b.name, (mn + mx) / 2f, mx - mn, new Color(0.3f, 0.24f, 0.2f));
            }

        // Paredes, vergas, guarda-corpos e portas
        var floors = new List<MansionWalls.FloorInput>();
        foreach (var f in map.floors)
        {
            var fi = new MansionWalls.FloorInput { Index = f.floor_index };
            foreach (var r in f.rooms)
                fi.Rooms.Add(new MansionWalls.Room { Name = r.name, MinX = r.bounds.min[0], MinZ = r.bounds.min[1], MaxX = r.bounds.max[0], MaxZ = r.bounds.max[1], Outdoor = r.outdoor });
            if (f.doors != null)
                foreach (var d in f.doors)
                    fi.Doors.Add(new MansionWalls.DoorSpec
                    {
                        Id = d.id, RoomA = d.rooms[0], RoomB = d.rooms[1], CenterX = d.center[0], CenterZ = d.center[1],
                        Width = d.width, Type = string.IsNullOrEmpty(d.type) ? "door" : d.type, SwingInto = d.swing_into,
                        Locked = d.locked, Hinge = d.hinge
                    });
            floors.Add(fi);
        }
        var holes = new List<MansionWalls.Hole>();
        foreach (var c in map.vertical_connectors)
            holes.Add(new MansionWalls.Hole
            {
                MinX = c.position.x[0], MaxX = c.position.x[1], MinZ = c.position.z[0], MaxZ = c.position.z[1],
                AscendDirection = c.ascend_direction, TopFloor = Mathf.RoundToInt(c.height_range[1] / fh)
            });
        var settings = new MansionWalls.Settings
        {
            FloorHeight = fh, SlabThickness = slabThickness, DoorHeight = ds.door_height,
            ArchHeight = ds.arch_height, RailingHeight = ds.railing_height
        };
        MansionWalls.Result result = MansionWalls.Build(floors, holes, settings);
        foreach (var e in result.Errors) Debug.LogWarning("[MansionLayoutLoader] " + e);

        Transform wallsRoot = new GameObject("Paredes").transform;
        wallsRoot.SetParent(geo, false);
        float t = ds.wall_thickness > 0f ? ds.wall_thickness : wallThickness;
        int n = 0;
        foreach (var w in result.Walls)
        {
            bool rail = w.Kind == MansionWalls.WallKind.Railing;
            float thick = rail ? 0.06f : t;
            float ext = rail ? 0f : t / 2f; // fecha os cantos
            float len = w.Length + 2f * ext, h = w.Top - w.Bottom, mid = (w.From + w.To) / 2f, y = (w.Bottom + w.Top) / 2f;
            Vector3 c = w.AlongZ ? new Vector3(w.Line, y, mid) : new Vector3(mid, y, w.Line);
            Vector3 size = w.AlongZ ? new Vector3(thick, h, len) : new Vector3(len, h, thick);
            Color col = w.Kind == MansionWalls.WallKind.Exterior ? new Color(0.28f, 0.24f, 0.27f)
                      : rail ? new Color(0.5f, 0.38f, 0.25f) : new Color(0.62f, 0.55f, 0.48f);
            Box(wallsRoot, $"{w.Kind}_{n++:000}_{w.RoomA}|{w.RoomB}", c, size, col);
        }

        Transform doorsRoot = new GameObject("Portas").transform;
        doorsRoot.SetParent(geo, false);
        foreach (var d in result.Doors) BuildDoor(doorsRoot, d);
    }

    void BuildDoor(Transform parent, MansionWalls.DoorPlacement d)
    {
        GameObject rootGo = new GameObject("Porta_" + d.Spec.Id);
        rootGo.transform.SetParent(parent, false);
        float mid = (d.From + d.To) / 2f;
        rootGo.transform.position = d.AlongZ ? new Vector3(d.Line, d.Bottom, mid) : new Vector3(mid, d.Bottom, d.Line);

        MansionDoor door = rootGo.AddComponent<MansionDoor>();
        door.doorId = d.Spec.Id;
        door.locked = d.Spec.Locked;
        door.creakClip = doorCreakSound;
        door.slamClip = doorSlamSound;
        AudioSource audio = rootGo.AddComponent<AudioSource>();
        audio.playOnAwake = false; audio.spatialBlend = 1f; audio.rolloffMode = AudioRolloffMode.Linear;
        audio.minDistance = 1f; audio.maxDistance = propAudioMaxDistance;
        door.audioSource = audio;

        Vector3 along = d.AlongZ ? Vector3.forward : Vector3.right;
        Vector3 swingNormal = (d.AlongZ ? Vector3.right : Vector3.forward) * d.SwingSide;
        float width = d.To - d.From;

        var leaves = new List<(Vector3 hingePos, Vector3 dir, float w)>();
        Vector3 pMin = rootGo.transform.position - along * width / 2f, pMax = rootGo.transform.position + along * width / 2f;
        if (d.IsDouble)
        {
            leaves.Add((pMin, along, width / 2f));
            leaves.Add((pMax, -along, width / 2f));
        }
        else if (d.HingeAtMin) leaves.Add((pMin, along, width));
        else leaves.Add((pMax, -along, width));

        int i = 0;
        foreach (var leaf in leaves)
        {
            GameObject hinge = new GameObject("Dobradica_" + i++);
            hinge.transform.SetParent(rootGo.transform, false);
            hinge.transform.position = leaf.hingePos;

            float lw = leaf.w - 0.03f, lh = d.Height - 0.03f, thick = 0.05f;
            GameObject panel = GameObject.CreatePrimitive(PrimitiveType.Cube);
            panel.name = "Folha";
            panel.transform.SetParent(hinge.transform, false);
            panel.transform.localPosition = leaf.dir * (leaf.w / 2f) + Vector3.up * (lh / 2f);
            panel.transform.localScale = d.AlongZ ? new Vector3(thick, lh, lw) : new Vector3(lw, lh, thick);
            Renderer r = panel.GetComponent<Renderer>();
            if (greyboxMaterial != null) r.sharedMaterial = greyboxMaterial;
            else if (Application.isPlaying) r.material.color = d.Spec.Locked ? new Color(0.25f, 0.12f, 0.08f) : new Color(0.42f, 0.24f, 0.12f);

            // Rotação positiva em Y leva (x,z) -> (z,-x). Escolhe o sinal que gira a folha para o lado da abertura.
            Vector3 rotated = new Vector3(leaf.dir.z, 0f, -leaf.dir.x);
            door.hinges.Add(hinge.transform);
            door.hingeSigns.Add(Vector3.Dot(rotated, swingNormal) >= 0f ? 1f : -1f);
        }
    }

    void BuildStairs(Transform parent, ConnectorData c)
    {
        float x0 = c.position.x[0], x1 = c.position.x[1], z0 = c.position.z[0], z1 = c.position.z[1];
        float h0 = c.height_range[0], h1 = c.height_range[1];
        string dir = string.IsNullOrEmpty(c.ascend_direction) ? "+z" : c.ascend_direction;
        bool alongZ = dir.EndsWith("z");
        bool positive = dir.StartsWith("+");

        float run = alongZ ? z1 - z0 : x1 - x0;
        float rise = h1 - h0;
        int steps = Mathf.Max(1, Mathf.CeilToInt(rise / stepHeight));
        float tread = run / steps;
        float riser = rise / steps;
        Transform stairs = new GameObject(c.type).transform;
        stairs.SetParent(parent, false);

        for (int i = 0; i < steps; i++)
        {
            // Cada degrau é um bloco do começo do degrau até o topo da escada (perfil maciço).
            float startAlong = i * tread;
            float len = run - startAlong;
            float top = h0 + (i + 1) * riser;
            float centerAlong = startAlong + len / 2;
            float a = positive ? (alongZ ? z0 : x0) + centerAlong : (alongZ ? z1 : x1) - centerAlong;

            Vector3 pos = alongZ ? new Vector3((x0 + x1) / 2, (h0 + top) / 2, a) : new Vector3(a, (h0 + top) / 2, (z0 + z1) / 2);
            Vector3 size = alongZ ? new Vector3(x1 - x0, top - h0, len) : new Vector3(len, top - h0, z1 - z0);
            Box(stairs, $"Degrau_{i:00}", pos, size, new Color(0.45f, 0.33f, 0.22f));
        }

        // Rampa invisível apoiada nas quinas dos degraus: o CharacterController sobe sem trepidar.
        Vector3 up = Vector3.up;
        Vector3 ascend = alongZ ? (positive ? Vector3.forward : Vector3.back) : (positive ? Vector3.right : Vector3.left);
        float width = alongZ ? x1 - x0 : z1 - z0;
        float baseAlong = positive ? (alongZ ? z0 : x0) : (alongZ ? z1 : x1);
        Vector3 bottomEdge = alongZ ? new Vector3((x0 + x1) / 2, h0, baseAlong) : new Vector3(baseAlong, h0, (z0 + z1) / 2);
        Vector3 start = bottomEdge - ascend * tread;
        Vector3 end = start + ascend * run + up * rise;
        Vector3 slope = end - start;
        const float rampThickness = 0.1f;
        Quaternion rot = Quaternion.LookRotation(slope.normalized, up);
        Vector3 normal = rot * Vector3.up;
        GameObject ramp = Box(stairs, "Rampa_Colisao", (start + end) / 2f - normal * (rampThickness / 2f),
            new Vector3(width, rampThickness, slope.magnitude), Color.white);
        ramp.transform.rotation = rot;
        ramp.GetComponent<Renderer>().enabled = false;
    }

    static List<Rect> SubtractAll(List<Rect> pieces, Rect hole)
    {
        var result = new List<Rect>();
        foreach (var r in pieces) result.AddRange(Subtract(r, hole));
        return result;
    }

    /// <summary>r − hole, em até 4 retângulos.</summary>
    static List<Rect> Subtract(Rect r, Rect hole)
    {
        var list = new List<Rect>();
        if (!r.Overlaps(hole)) { list.Add(r); return list; }
        float ixMin = Mathf.Max(r.xMin, hole.xMin), ixMax = Mathf.Min(r.xMax, hole.xMax);
        float iyMin = Mathf.Max(r.yMin, hole.yMin), iyMax = Mathf.Min(r.yMax, hole.yMax);
        if (iyMin > r.yMin) list.Add(Rect.MinMaxRect(r.xMin, r.yMin, r.xMax, iyMin));
        if (iyMax < r.yMax) list.Add(Rect.MinMaxRect(r.xMin, iyMax, r.xMax, r.yMax));
        if (ixMin > r.xMin) list.Add(Rect.MinMaxRect(r.xMin, iyMin, ixMin, iyMax));
        if (ixMax < r.xMax) list.Add(Rect.MinMaxRect(ixMax, iyMin, r.xMax, iyMax));
        list.RemoveAll(x => x.width < 0.01f || x.height < 0.01f);
        return list;
    }

    GameObject Box(Transform parent, string name, Vector3 center, Vector3 size, Color color)
    {
        GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = name;
        go.transform.SetParent(parent, false);
        go.transform.position = center;
        go.transform.localScale = size;
        Renderer r = go.GetComponent<Renderer>();
        if (greyboxMaterial != null) r.sharedMaterial = greyboxMaterial;
        else if (Application.isPlaying) r.material.color = color;
        return go;
    }

    // ------------------------------------------------------------------ Móveis

    void SpawnProps(PropsFile props)
    {
        var catalog = new Dictionary<string, CatalogEntry>();
        foreach (var c in props.props_catalog) catalog[c.id] = c;

        var prefabs = new Dictionary<string, GameObject>();
        foreach (var b in propPrefabs) if (b != null && b.prefab != null && !string.IsNullOrEmpty(b.catalogId)) prefabs[b.catalogId] = b.prefab;

        Transform parent = new GameObject("Moveis").transform;
        parent.SetParent(root, false);
        var spawned = new Dictionary<string, PossessableProp>();

        foreach (var s in props.spawned_props)
        {
            if (!catalog.TryGetValue(s.type, out CatalogEntry entry))
            {
                Debug.LogWarning($"[MansionLayoutLoader] {s.id}: tipo '{s.type}' não está no catálogo.");
                continue;
            }

            Vector3 pos = new Vector3(s.position.x, s.position.y, s.position.z);
            Quaternion rot = Quaternion.Euler(0f, s.rotation_y, 0f);
            Vector3 dims = entry.dimensions != null && entry.dimensions.Length == 3
                ? new Vector3(entry.dimensions[0], entry.dimensions[1], entry.dimensions[2])
                : new Vector3(0.6f, 1f, 0.6f);

            GameObject go;
            if (!prefabs.TryGetValue(s.type, out GameObject prefab) && loadModelsFromResources && !string.IsNullOrEmpty(entry.model))
            {
                string res = resourcesFolder.TrimEnd('/') + "/" + System.IO.Path.GetFileNameWithoutExtension(entry.model);
                prefab = Resources.Load<GameObject>(res);
                if (prefab != null) prefabs[s.type] = prefab;
            }
            if (prefab != null)
            {
                go = Instantiate(prefab, pos, rot, parent);
            }
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.transform.SetParent(parent, false);
                go.transform.SetPositionAndRotation(pos + Vector3.up * dims.y / 2f, rot);
                go.transform.localScale = dims;
                if (Application.isPlaying) go.GetComponent<Renderer>().material.color = ColorFor(entry.category);
            }
            go.name = $"{s.id}_{entry.name}";

            if (go.GetComponentInChildren<Collider>() == null) FitBoxCollider(go);

            AudioSource audio = go.GetComponent<AudioSource>();
            if (audio == null) audio = go.AddComponent<AudioSource>();
            audio.playOnAwake = false;
            audio.spatialBlend = 1f;
            audio.rolloffMode = AudioRolloffMode.Linear;
            audio.minDistance = 1f;
            audio.maxDistance = propAudioMaxDistance;

            PossessableProp prop = go.GetComponent<PossessableProp>();
            if (prop == null)
            {
                if (go.GetComponent<Collider>() == null) FitBoxCollider(go); // RequireComponent(Collider) no próprio objeto
                prop = go.AddComponent<PossessableProp>();
            }
            prop.propId = s.id;
            spawned[s.id] = prop;
            prop.propName = entry.name;
            prop.roomName = s.room;
            prop.floorIndex = s.floor;
            prop.category = PossessableProp.ParseCategory(entry.category);
            prop.propAudioSource = audio;
            if (prop.possessSound == null) prop.possessSound = defaultPossessSound;
            if (prop.hauntActionSound == null)
            {
                if (prop.category == PropCategory.Louca && glassHauntSound != null) prop.hauntActionSound = glassHauntSound;
                else if (prop.category == PropCategory.Planta && plantHauntSound != null) prop.hauntActionSound = plantHauntSound;
                else prop.hauntActionSound = defaultHauntSound;
            }
            if (s.type == "prop_clock" && prop.idleLoopSound == null) prop.idleLoopSound = clockTickSound;

            if (prop.category == PropCategory.Iluminacao && prop.linkedLight == null)
            {
                GameObject lightGo = new GameObject("Luz");
                lightGo.transform.SetParent(go.transform, false);
                BoxCollider bc = go.GetComponent<BoxCollider>();
                if (bc != null) lightGo.transform.localPosition = bc.center; // centro do lustre (modelo tem pivô na base)
                Light l = lightGo.AddComponent<Light>();
                l.type = LightType.Point;
                l.range = 6f;
                l.intensity = 1.2f;
                l.color = new Color(1f, 0.82f, 0.55f);
                prop.linkedLight = l;
            }
        }

        // Liga objetos apoiados (on_top_of) ao móvel de baixo
        foreach (var s in props.spawned_props)
        {
            if (string.IsNullOrEmpty(s.on_top_of)) continue;
            if (spawned.TryGetValue(s.id, out PossessableProp top) && spawned.TryGetValue(s.on_top_of, out PossessableProp support))
                top.supportedBy = support;
            else
                Debug.LogWarning($"[MansionLayoutLoader] {s.id}: apoio '{s.on_top_of}' não encontrado.");
        }
    }

    /// <summary>BoxCollider no espaço local do objeto (correto mesmo com o móvel girado).</summary>
    static void FitBoxCollider(GameObject go)
    {
        BoxCollider box = go.AddComponent<BoxCollider>();
        MeshFilter[] filters = go.GetComponentsInChildren<MeshFilter>();
        bool any = false;
        Bounds local = new Bounds(Vector3.zero, Vector3.zero);
        foreach (var mf in filters)
        {
            if (mf.sharedMesh == null) continue;
            Bounds mb = mf.sharedMesh.bounds;
            for (int i = 0; i < 8; i++)
            {
                Vector3 corner = mb.center + Vector3.Scale(mb.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                Vector3 p = go.transform.InverseTransformPoint(mf.transform.TransformPoint(corner));
                if (!any) { local = new Bounds(p, Vector3.zero); any = true; }
                else local.Encapsulate(p);
            }
        }
        if (!any) return;
        box.center = local.center;
        box.size = local.size;
    }

    static Color ColorFor(string category)
    {
        switch (PossessableProp.ParseCategory(category))
        {
            case PropCategory.Iluminacao:    return new Color(1f, 0.85f, 0.4f);
            case PropCategory.Sanitario:     return new Color(0.9f, 0.9f, 0.95f);
            case PropCategory.Hidraulica:    return new Color(0.6f, 0.8f, 0.9f);
            case PropCategory.Dormitorio:    return new Color(0.6f, 0.2f, 0.25f);
            case PropCategory.Armazenamento: return new Color(0.4f, 0.25f, 0.15f);
            case PropCategory.Assento:       return new Color(0.45f, 0.15f, 0.2f);
            default:                         return new Color(0.55f, 0.45f, 0.3f);
        }
    }

    // ------------------------------------------------------------------ Spawn

    /// <summary>Reposiciona fantasmas e caçadores nos spawns. Usado pelo menu depois de criar os jogadores.</summary>
    public void PlacePlayersAtSpawnPoints()
    {
        if (mapJson == null) return;
        MapData map = JsonUtility.FromJson<MapData>(mapJson.text);
        if (map != null) PlacePlayers(map);
    }

    void PlacePlayers(MapData map)
    {
        if (map.spawn_points == null) return;
        int i = 0;
        foreach (var h in FindObjectsOfType<HunterController>())
            if (map.spawn_points.hunters != null && i < map.spawn_points.hunters.Length) Teleport(h.gameObject, map.spawn_points.hunters[i++]);
        i = 0;
        foreach (var g in FindObjectsOfType<GhostController>())
            if (map.spawn_points.ghosts != null && i < map.spawn_points.ghosts.Length) Teleport(g.gameObject, map.spawn_points.ghosts[i++]);
    }

    static void Teleport(GameObject go, Vec3 p)
    {
        if (p == null) return;
        CharacterController cc = go.GetComponent<CharacterController>();
        bool was = cc != null && cc.enabled;
        if (cc != null) cc.enabled = false;
        go.transform.position = new Vector3(p.x, p.y + 0.05f, p.z);
        if (cc != null) cc.enabled = was;
    }

    static void DestroyImmediateSafe(GameObject go)
    {
        if (Application.isPlaying) Destroy(go); else DestroyImmediate(go);
    }

    void OnDrawGizmosSelected()
    {
        if (mapJson == null) return;
        MapData map;
        try { map = JsonUtility.FromJson<MapData>(mapJson.text); } catch { return; }
        if (map == null || map.floors == null) return;
        foreach (var f in map.floors)
        {
            Gizmos.color = f.floor_index == 0 ? new Color(0.2f, 1f, 0.4f) : new Color(0.3f, 0.6f, 1f);
            float y = f.floor_index * map.dimensions.floor_height + 0.05f;
            foreach (var r in f.rooms)
            {
                Vector3 c = new Vector3((r.bounds.min[0] + r.bounds.max[0]) / 2, y, (r.bounds.min[1] + r.bounds.max[1]) / 2);
                Vector3 s = new Vector3(r.bounds.max[0] - r.bounds.min[0], 0.01f, r.bounds.max[1] - r.bounds.min[1]);
                Gizmos.DrawWireCube(c, s);
            }
        }
    }

    // ------------------------------------------------------------------ Estruturas JSON (JsonUtility)

    [Serializable] public class MapData { public string map_name; public Dimensions dimensions; public FloorData[] floors; public ConnectorData[] vertical_connectors; public BlockData[] solid_blocks; public DoorSettings door_settings; public SpawnPoints spawn_points; }
    [Serializable] public class BlockData { public string name; public int floor; public float[] min; public float[] max; }
    [Serializable] public class DoorSettings { public float door_height = 2.1f; public float arch_height = 2.4f; public float wall_thickness = 0.15f; public float railing_height = 1.0f; }
    [Serializable] public class DoorData { public string id; public string[] rooms; public float[] center; public float width; public string type; public string swing_into; public bool locked; public string hinge; }
    [Serializable] public class Dimensions { public float width_x; public float depth_z; public float floor_height = 3.2f; public int total_floors = 2; }
    [Serializable] public class FloorData { public int floor_index; public string name; public RoomData[] rooms; public DoorData[] doors; }
    [Serializable] public class RoomData { public string name; public Bounds2D bounds; public bool outdoor; }
    [Serializable] public class Bounds2D { public float[] min; public float[] max; }
    [Serializable] public class ConnectorData { public string type; public RangeXZ position; public float[] height_range; public string ascend_direction; }
    [Serializable] public class RangeXZ { public float[] x; public float[] z; }
    [Serializable] public class SpawnPoints { public Vec3[] hunters; public Vec3[] ghosts; }
    [Serializable] public class PropsFile { public string map; public int total_props; public CatalogEntry[] props_catalog; public SpawnEntry[] spawned_props; }
    [Serializable] public class CatalogEntry { public string id; public string model; public string name; public string category; public string size; public string risk; public string special_ability; public float[] dimensions; }
    [Serializable] public class SpawnEntry { public string id; public string type; public int floor; public string room; public Vec3 position; public float rotation_y; public string on_top_of; }
    [Serializable] public class Vec3 { public float x; public float y; public float z; }
}
