import type { DoorDef, RoomDef, StairDef } from "../data/mansion";

/**
 * Porte do MansionWalls.cs: paredes internas/externas, vãos de portas, vergas e guarda-corpos a partir
 * dos retângulos dos cômodos.
 *
 * Regra: em cada linha onde existe borda de cômodo, o trecho vira parede quando o cômodo de um lado é
 * diferente do cômodo do outro. Se um lado está fora da planta, é parede externa (altura cheia);
 * varanda com o lado de fora vira guarda-corpo.
 */

export const EXTERIOR = "EXTERIOR";

export type WallKind = "interior" | "exterior" | "lintel" | "railing";

/** Segmento alinhado a um eixo. alongZ = corre ao longo de Z (linha x = line). */
export interface WallPiece {
  floor: number;
  alongZ: boolean;
  line: number;
  from: number;
  to: number;
  bottom: number;
  top: number;
  kind: WallKind;
  roomA: string;
  roomB: string;
}

export interface DoorPlacement {
  door: DoorDef;
  floor: number;
  alongZ: boolean;
  line: number;
  from: number;
  to: number;
  bottom: number;
  height: number;
  /** +1: abre para o lado de coordenada maior; -1: lado menor. */
  swingSide: 1 | -1;
  hingeAtMin: boolean;
  isDouble: boolean;
}

export interface WallSettings {
  floorHeight: number;
  slab: number;
  doorHeight: number;
  archHeight: number;
  railingHeight: number;
}

export interface WallsResult {
  walls: WallPiece[];
  doors: DoorPlacement[];
  errors: string[];
}

const EPS = 0.001;
const key = (v: number) => Math.round(v * 1000) / 1000;

export function roomAt(rooms: RoomDef[], x: number, z: number): RoomDef | undefined {
  return rooms.find((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
}

export function buildWalls(rooms: RoomDef[], doors: DoorDef[], stairs: StairDef[], s: WallSettings): WallsResult {
  const res: WallsResult = { walls: [], doors: [], errors: [] };
  const floors = [...new Set(rooms.map((r) => r.floor))].sort();
  for (const f of floors) {
    buildFloor(
      f,
      rooms.filter((r) => r.floor === f),
      doors.filter((d) => d.floor === f),
      s,
      res,
    );
  }
  for (const st of stairs) {
    const topFloor = Math.round(st.h1 / s.floorHeight);
    buildRailings(st, topFloor, rooms.filter((r) => r.floor === topFloor), s, res);
  }
  return res;
}

function buildFloor(floor: number, rooms: RoomDef[], doors: DoorDef[], s: WallSettings, res: WallsResult) {
  const bottom = floor * s.floorHeight;
  const interiorTop = bottom + s.floorHeight - s.slab;
  const exteriorTop = bottom + s.floorHeight;

  // Agrupa as bordas por linha: "alongZ|coordenada" -> pontos de quebra.
  const lines = new Map<string, { alongZ: boolean; line: number; pts: number[] }>();
  const addEdge = (alongZ: boolean, line: number, a: number, b: number) => {
    const k = `${alongZ}|${key(line)}`;
    let e = lines.get(k);
    if (!e) lines.set(k, (e = { alongZ, line: key(line), pts: [] }));
    e.pts.push(a, b);
  };
  for (const r of rooms) {
    addEdge(true, r.minX, r.minZ, r.maxZ);
    addEdge(true, r.maxX, r.minZ, r.maxZ);
    addEdge(false, r.minZ, r.minX, r.maxX);
    addEdge(false, r.maxZ, r.minX, r.maxX);
  }

  let merged: WallPiece[] = [];
  for (const { alongZ, line, pts } of lines.values()) {
    const arr = [...new Set(pts.map(key))].sort((a, b) => a - b);
    let current: WallPiece | null = null;
    for (let i = 0; i + 1 < arr.length; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      const mid = (a + b) / 2;
      const lo = alongZ ? roomAt(rooms, line - 0.01, mid) : roomAt(rooms, mid, line - 0.01);
      const hi = alongZ ? roomAt(rooms, line + 0.01, mid) : roomAt(rooms, mid, line + 0.01);
      if (lo === hi) {
        current = null;
        continue;
      }

      let kind: WallKind;
      let top: number;
      if (!lo || !hi) {
        const only = (lo ?? hi)!;
        if (only.outdoor) {
          kind = "railing"; // guarda-corpo da varanda
          top = bottom + s.railingHeight;
        } else {
          kind = "exterior";
          top = exteriorTop;
        }
      } else if (lo.outdoor !== hi.outdoor) {
        kind = "exterior"; // fachada
        top = exteriorTop;
      } else if (lo.outdoor && hi.outdoor) {
        current = null; // varanda com varanda: livre
        continue;
      } else {
        kind = "interior";
        top = interiorTop;
      }

      const ra = lo?.name ?? EXTERIOR;
      const rb = hi?.name ?? EXTERIOR;
      if (current && Math.abs(current.to - a) < EPS && current.roomA === ra && current.roomB === rb && current.kind === kind) {
        current.to = b; // mesmo par de cômodos: emenda
        continue;
      }
      current = { floor, alongZ, line, from: a, to: b, bottom, top, kind, roomA: ra, roomB: rb };
      merged.push(current);
    }
  }

  // Recorta os vãos das portas/arcos.
  for (const d of doors) {
    let host: WallPiece | undefined;
    let along = 0;
    for (const w of merged) {
      const pairOk = (w.roomA === d.roomA && w.roomB === d.roomB) || (w.roomA === d.roomB && w.roomB === d.roomA);
      if (!pairOk) continue;
      const lineCoord = w.alongZ ? d.centerX : d.centerZ;
      const a = w.alongZ ? d.centerZ : d.centerX;
      if (Math.abs(lineCoord - w.line) > 0.01) continue;
      if (a - d.width / 2 < w.from - EPS || a + d.width / 2 > w.to + EPS) continue;
      host = w;
      along = a;
      break;
    }
    if (!host) {
      res.errors.push(`Andar ${floor}: '${d.id}' não está sobre uma parede entre '${d.roomA}' e '${d.roomB}' (ou não cabe nela).`);
      continue;
    }

    const o0 = along - d.width / 2;
    const o1 = along + d.width / 2;
    const h = host;
    merged = merged.filter((w) => w !== h);
    if (o0 - h.from > EPS) merged.push({ ...h, to: o0 });
    if (h.to - o1 > EPS) merged.push({ ...h, from: o1 });

    if (d.type !== "open") {
      const openH = d.type === "arch" ? s.archHeight : s.doorHeight;
      const lintel: WallPiece = { ...h, from: o0, to: o1, bottom: bottom + openH, kind: "lintel" };
      if (lintel.top - lintel.bottom > EPS) res.walls.push(lintel);
    }

    if (d.type === "door" || d.type === "double_door") {
      let swing: 1 | -1 = 1;
      if (d.swingInto) {
        const probe = h.line + 0.01;
        const hiRoom = h.alongZ ? roomAt(rooms, probe, along) : roomAt(rooms, along, probe);
        swing = (hiRoom?.name ?? EXTERIOR) === d.swingInto ? 1 : -1;
      }
      res.doors.push({
        door: d,
        floor,
        alongZ: h.alongZ,
        line: h.line,
        from: o0,
        to: o1,
        bottom,
        height: s.doorHeight,
        swingSide: swing,
        hingeAtMin: d.hinge !== "max",
        isDouble: d.type === "double_door",
      });
    }
  }

  res.walls.push(...merged);
}

function buildRailings(h: StairDef, topFloor: number, topRooms: RoomDef[], s: WallSettings, res: WallsResult) {
  const bottom = topFloor * s.floorHeight;
  const dir = h.ascend;
  const edges: { alongZ: boolean; line: number; from: number; to: number; arrival: boolean }[] = [
    { alongZ: true, line: h.minX, from: h.minZ, to: h.maxZ, arrival: dir === "-x" },
    { alongZ: true, line: h.maxX, from: h.minZ, to: h.maxZ, arrival: dir === "+x" },
    { alongZ: false, line: h.minZ, from: h.minX, to: h.maxX, arrival: dir === "-z" },
    { alongZ: false, line: h.maxZ, from: h.minX, to: h.maxX, arrival: dir === "+z" },
  ];
  for (const e of edges) {
    if (e.arrival) continue; // borda de chegada fica livre
    const mid = (e.from + e.to) / 2;
    const lo = e.alongZ ? roomAt(topRooms, e.line - 0.01, mid) : roomAt(topRooms, mid, e.line - 0.01);
    const hi = e.alongZ ? roomAt(topRooms, e.line + 0.01, mid) : roomAt(topRooms, mid, e.line + 0.01);
    if (lo !== hi) continue; // a borda já coincide com uma parede
    res.walls.push({
      floor: topFloor,
      alongZ: e.alongZ,
      line: e.line,
      from: e.from,
      to: e.to,
      bottom,
      top: bottom + s.railingHeight,
      kind: "railing",
      roomA: "Escada",
      roomB: "Escada",
    });
  }
}
