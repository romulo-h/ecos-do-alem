using System;
using System.Collections.Generic;

/// <summary>
/// Cálculo puro (sem UnityEngine) das paredes internas/externas, vãos de portas, vergas e guarda-corpos
/// a partir dos retângulos dos cômodos. O MansionLayoutLoader converte o resultado em objetos do Unity.
///
/// Regra: em cada linha onde existe borda de cômodo, o trecho vira parede quando o cômodo de um lado
/// é diferente do cômodo do outro lado. Se um lado está fora da planta, é parede externa (altura cheia).
/// </summary>
public static class MansionWalls
{
    public const string Exterior = "EXTERIOR";

    public class Room { public string Name; public float MinX, MinZ, MaxX, MaxZ; public bool Outdoor; }

    public class DoorSpec
    {
        public string Id; public string RoomA, RoomB; public float CenterX, CenterZ; public float Width;
        /// <summary>"door" | "double_door" | "arch" (vão com verga) | "open" (sem parede nem verga)</summary>
        public string Type = "door";
        public string SwingInto; public bool Locked; public string Hinge; // "min" | "max"
        public bool IsLeafDoor => Type == "door" || Type == "double_door";
    }

    public class Hole { public float MinX, MinZ, MaxX, MaxZ; public string AscendDirection; public int TopFloor; }

    public class FloorInput { public int Index; public List<Room> Rooms = new List<Room>(); public List<DoorSpec> Doors = new List<DoorSpec>(); }

    public class Settings
    {
        public float FloorHeight = 3.2f, SlabThickness = 0.2f, DoorHeight = 2.1f, ArchHeight = 2.4f, RailingHeight = 1.0f;
    }

    public enum WallKind { Interior, Exterior, Lintel, Railing }

    /// <summary>Segmento de parede alinhado a um eixo. AlongZ = a parede corre ao longo de Z (linha x = Line).</summary>
    public class WallPiece
    {
        public int Floor; public bool AlongZ; public float Line; public float From, To; public float Bottom, Top;
        public WallKind Kind; public string RoomA, RoomB;
        public float Length => To - From;
    }

    public class DoorPlacement
    {
        public DoorSpec Spec; public int Floor; public bool AlongZ; public float Line; public float From, To;
        public float Bottom; public float Height;
        /// <summary>+1: abre para o lado de coordenada maior (x>Line ou z>Line); -1: lado menor.</summary>
        public int SwingSide; public bool HingeAtMin; public bool IsDouble;
    }

    public class Result
    {
        public List<WallPiece> Walls = new List<WallPiece>();
        public List<DoorPlacement> Doors = new List<DoorPlacement>();
        public List<string> Errors = new List<string>();
    }

    const float Eps = 0.001f;

    public static Result Build(List<FloorInput> floors, List<Hole> holes, Settings s)
    {
        var res = new Result();
        foreach (var f in floors) BuildFloor(f, s, res);
        foreach (var h in holes)
        {
            FloorInput top = floors.Find(x => x.Index == h.TopFloor);
            BuildRailings(h, s, top != null ? top.Rooms : new List<Room>(), res);
        }
        return res;
    }

    static Room Find(List<Room> rooms, string name) => name == null ? null : rooms.Find(r => r.Name == name);

    static string RoomAt(List<Room> rooms, float x, float z)
    {
        foreach (var r in rooms)
            if (x > r.MinX && x < r.MaxX && z > r.MinZ && z < r.MaxZ) return r.Name;
        return null;
    }

    static float Key(float v) => (float)Math.Round(v, 3);

    static void BuildFloor(FloorInput f, Settings s, Result res)
    {
        float bottom = f.Index * s.FloorHeight;
        float interiorTop = bottom + s.FloorHeight - s.SlabThickness;
        float exteriorTop = bottom + s.FloorHeight;

        // Agrupa as bordas por linha: (AlongZ, coordenada) -> pontos de quebra.
        var lines = new Dictionary<(bool, float), List<float>>();
        void AddEdge(bool alongZ, float line, float a, float b)
        {
            var k = (alongZ, Key(line));
            if (!lines.TryGetValue(k, out var pts)) lines[k] = pts = new List<float>();
            pts.Add(a); pts.Add(b);
        }
        foreach (var r in f.Rooms)
        {
            AddEdge(true, r.MinX, r.MinZ, r.MaxZ); AddEdge(true, r.MaxX, r.MinZ, r.MaxZ);
            AddEdge(false, r.MinZ, r.MinX, r.MaxX); AddEdge(false, r.MaxZ, r.MinX, r.MaxX);
        }

        var merged = new List<WallPiece>();
        foreach (var kv in lines)
        {
            bool alongZ = kv.Key.Item1; float line = kv.Key.Item2;
            var pts = new SortedSet<float>();
            foreach (var p in kv.Value) pts.Add(Key(p));
            var arr = new List<float>(pts);

            WallPiece current = null;
            for (int i = 0; i + 1 < arr.Count; i++)
            {
                float a = arr[i], b = arr[i + 1], mid = (a + b) / 2f;
                string lo = alongZ ? RoomAt(f.Rooms, line - 0.01f, mid) : RoomAt(f.Rooms, mid, line - 0.01f);
                string hi = alongZ ? RoomAt(f.Rooms, line + 0.01f, mid) : RoomAt(f.Rooms, mid, line + 0.01f);
                if (lo == hi) { current = null; continue; }

                Room rlo = Find(f.Rooms, lo), rhi = Find(f.Rooms, hi);
                WallKind kind; float top;
                if (rlo == null || rhi == null)
                {
                    Room only = rlo ?? rhi;
                    if (only.Outdoor) { kind = WallKind.Railing; top = bottom + s.RailingHeight; } // guarda-corpo da varanda
                    else { kind = WallKind.Exterior; top = exteriorTop; }
                }
                else if (rlo.Outdoor != rhi.Outdoor) { kind = WallKind.Exterior; top = exteriorTop; } // fachada
                else if (rlo.Outdoor && rhi.Outdoor) { current = null; continue; } // varanda com varanda: livre
                else { kind = WallKind.Interior; top = interiorTop; }

                string ra = lo ?? Exterior, rb = hi ?? Exterior;
                if (current != null && Math.Abs(current.To - a) < Eps && current.RoomA == ra && current.RoomB == rb && current.Kind == kind)
                {
                    current.To = b; // mesmo par de cômodos: emenda
                    continue;
                }
                current = new WallPiece
                {
                    Floor = f.Index, AlongZ = alongZ, Line = line, From = a, To = b, Bottom = bottom,
                    Top = top, Kind = kind, RoomA = ra, RoomB = rb
                };
                merged.Add(current);
            }
        }

        // Recorta os vãos das portas/arcos.
        foreach (var d in f.Doors)
        {
            WallPiece host = null;
            float along = 0f;
            foreach (var w in merged)
            {
                bool pairOk = (w.RoomA == d.RoomA && w.RoomB == d.RoomB) || (w.RoomA == d.RoomB && w.RoomB == d.RoomA);
                if (!pairOk) continue;
                float lineCoord = w.AlongZ ? d.CenterX : d.CenterZ;
                float a = w.AlongZ ? d.CenterZ : d.CenterX;
                if (Math.Abs(lineCoord - w.Line) > 0.01f) continue;
                if (a - d.Width / 2f < w.From - Eps || a + d.Width / 2f > w.To + Eps) continue;
                host = w; along = a; break;
            }
            if (host == null)
            {
                res.Errors.Add($"Andar {f.Index}: '{d.Id}' não está sobre uma parede entre '{d.RoomA}' e '{d.RoomB}' (ou não cabe nela).");
                continue;
            }

            float o0 = along - d.Width / 2f, o1 = along + d.Width / 2f;
            merged.Remove(host);
            if (o0 - host.From > Eps) merged.Add(Clone(host, host.From, o0));
            if (host.To - o1 > Eps) merged.Add(Clone(host, o1, host.To));

            if (d.Type != "open")
            {
                float openH = d.Type == "arch" ? s.ArchHeight : s.DoorHeight;
                var lintel = Clone(host, o0, o1);
                lintel.Bottom = bottom + openH;
                lintel.Kind = WallKind.Lintel;
                if (lintel.Top - lintel.Bottom > Eps) res.Walls.Add(lintel);
            }

            if (d.IsLeafDoor)
            {
                int swing = +1;
                if (!string.IsNullOrEmpty(d.SwingInto))
                {
                    // lado "hi" é o de coordenada maior
                    float probeLine = host.Line + 0.01f;
                    string hiRoom = host.AlongZ ? RoomAt(f.Rooms, probeLine, along) : RoomAt(f.Rooms, along, probeLine);
                    swing = (hiRoom ?? Exterior) == d.SwingInto ? +1 : -1;
                }
                res.Doors.Add(new DoorPlacement
                {
                    Spec = d, Floor = f.Index, AlongZ = host.AlongZ, Line = host.Line, From = o0, To = o1,
                    Bottom = bottom, Height = s.DoorHeight, SwingSide = swing, HingeAtMin = d.Hinge != "max", IsDouble = d.Type == "double_door"
                });
            }
        }

        res.Walls.AddRange(merged);
    }

    static WallPiece Clone(WallPiece w, float from, float to) => new WallPiece
    {
        Floor = w.Floor, AlongZ = w.AlongZ, Line = w.Line, From = from, To = to, Bottom = w.Bottom, Top = w.Top,
        Kind = w.Kind, RoomA = w.RoomA, RoomB = w.RoomB
    };

    static void BuildRailings(Hole h, Settings s, List<Room> topRooms, Result res)
    {
        float bottom = h.TopFloor * s.FloorHeight;
        string dir = string.IsNullOrEmpty(h.AscendDirection) ? "+z" : h.AscendDirection;
        // (alongZ, line, from, to, éChegada)
        var edges = new List<(bool, float, float, float, bool)>
        {
            (true,  h.MinX, h.MinZ, h.MaxZ, dir == "-x"),
            (true,  h.MaxX, h.MinZ, h.MaxZ, dir == "+x"),
            (false, h.MinZ, h.MinX, h.MaxX, dir == "-z"),
            (false, h.MaxZ, h.MinX, h.MaxX, dir == "+z"),
        };
        foreach (var e in edges)
        {
            if (e.Item5) continue; // borda de chegada fica livre
            float mid = (e.Item3 + e.Item4) / 2f;
            string lo = e.Item1 ? RoomAt(topRooms, e.Item2 - 0.01f, mid) : RoomAt(topRooms, mid, e.Item2 - 0.01f);
            string hi = e.Item1 ? RoomAt(topRooms, e.Item2 + 0.01f, mid) : RoomAt(topRooms, mid, e.Item2 + 0.01f);
            if (lo != hi) continue; // a borda já coincide com uma parede
            res.Walls.Add(new WallPiece
            {
                Floor = h.TopFloor, AlongZ = e.Item1, Line = e.Item2, From = e.Item3, To = e.Item4,
                Bottom = bottom, Top = bottom + s.RailingHeight, Kind = WallKind.Railing, RoomA = "Escada", RoomB = "Escada"
            });
        }
    }
}
