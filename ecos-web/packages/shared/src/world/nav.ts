import type { RoomDef } from "../data/mansion";
import { floorOfY, type World } from "./world";

/**
 * Navegação dos bots: grafo de cômodos ligados pelas aberturas (portas, arcos, vãos) e pelas escadas.
 * Cada passagem vira dois pontos (um de cada lado), para o bot atravessar de frente e não raspar no batente.
 */

export interface NavPoint {
  x: number;
  y: number;
  z: number;
  /** porta que precisa estar aberta para passar (caçador) */
  doorId?: string;
}

interface Portal {
  to: number;
  /** pontos na ordem de quem sai do cômodo de origem */
  points: NavPoint[];
}

export interface NavGraph {
  rooms: RoomDef[];
  edges: Portal[][];
}

const SIDE = 0.55;

export function buildNav(world: World): NavGraph {
  const rooms = world.data.rooms;
  const idx = (floor: number, name: string) => rooms.findIndex((r) => r.floor === floor && r.name === name);
  const edges: Portal[][] = rooms.map(() => []);
  const fh = world.data.floorHeight;

  for (const d of world.data.doors) {
    const a = idx(d.floor, d.roomA);
    const b = idx(d.floor, d.roomB);
    if (a < 0 || b < 0) continue;
    const ra = rooms[a];
    // A passagem fica na linha x (normal em x) se o centro encosta numa borda x do cômodo A.
    const onX = Math.abs(d.centerX - ra.minX) < 0.03 || Math.abs(d.centerX - ra.maxX) < 0.03;
    const nx = onX ? 1 : 0;
    const nz = onX ? 0 : 1;
    const y = d.floor * fh;
    const p1 = { x: d.centerX - nx * SIDE, y, z: d.centerZ - nz * SIDE };
    const p2 = { x: d.centerX + nx * SIDE, y, z: d.centerZ + nz * SIDE };
    const inA = (p: { x: number; z: number }) => p.x > ra.minX && p.x < ra.maxX && p.z > ra.minZ && p.z < ra.maxZ;
    const [first, second] = inA(p1) ? [p1, p2] : [p2, p1];
    const doorId = world.doorById.has(d.id) ? d.id : undefined;
    edges[a].push({ to: b, points: [first, { x: d.centerX, y, z: d.centerZ, doorId }, second] });
    edges[b].push({ to: a, points: [second, { x: d.centerX, y, z: d.centerZ, doorId }, first] });
  }

  for (const st of world.ramps) {
    // pé da escada (antes da borda baixa) e chegada (depois da borda alta)
    const cx = (st.minX + st.maxX) / 2;
    const cz = (st.minZ + st.maxZ) / 2;
    let bottom: { x: number; z: number };
    let top: { x: number; z: number };
    switch (st.ascend) {
      case "-z":
        bottom = { x: cx, z: st.maxZ + 0.5 };
        top = { x: cx, z: st.minZ - 0.6 };
        break;
      case "+z":
        bottom = { x: cx, z: st.minZ - 0.5 };
        top = { x: cx, z: st.maxZ + 0.6 };
        break;
      case "-x":
        bottom = { x: st.maxX + 0.5, z: cz };
        top = { x: st.minX - 0.6, z: cz };
        break;
      default:
        bottom = { x: st.minX - 0.5, z: cz };
        top = { x: st.maxX + 0.6, z: cz };
    }
    const lowFloor = Math.round(st.h0 / fh);
    const highFloor = Math.round(st.h1 / fh);
    const a = roomIndexAt(rooms, lowFloor, bottom.x, bottom.z);
    const b = roomIndexAt(rooms, highFloor, top.x, top.z);
    if (a < 0 || b < 0) continue;
    const pb = { x: bottom.x, y: st.h0, z: bottom.z };
    const pt = { x: top.x, y: st.h1, z: top.z };
    edges[a].push({ to: b, points: [pb, pt] });
    edges[b].push({ to: a, points: [pt, pb] });
  }

  return { rooms, edges };
}

function roomIndexAt(rooms: RoomDef[], floor: number, x: number, z: number): number {
  return rooms.findIndex((r) => r.floor === floor && x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
}

/** Cômodo do ponto; fora de todos (ex.: em cima da escada), o mais próximo do mesmo andar. */
export function navRoomAt(nav: NavGraph, x: number, y: number, z: number): number {
  const f = floorOfY(y);
  const i = roomIndexAt(nav.rooms, f, x, z);
  if (i >= 0) return i;
  let best = -1;
  let bestD = Infinity;
  nav.rooms.forEach((r, k) => {
    if (r.floor !== f) return;
    const dx = Math.max(r.minX - x, 0, x - r.maxX);
    const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** Caminho de pontos de `from` até `to` (Dijkstra sobre os cômodos). Vazio se não houver ligação. */
export function findPath(nav: NavGraph, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): NavPoint[] {
  const start = navRoomAt(nav, from.x, from.y, from.z);
  const goal = navRoomAt(nav, to.x, to.y, to.z);
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [{ x: to.x, y: to.y, z: to.z }];

  const n = nav.rooms.length;
  const dist = new Array<number>(n).fill(Infinity);
  const pos: { x: number; y: number; z: number }[] = new Array(n);
  const prev: { room: number; portal: Portal }[] = new Array(n);
  const done = new Array<boolean>(n).fill(false);
  dist[start] = 0;
  pos[start] = from;

  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === goal) break;
    done[u] = true;
    for (const e of nav.edges[u]) {
      const exit = e.points[e.points.length - 1];
      const entry = e.points[0];
      const cost = dist[u] + d3(pos[u], entry) + pathLen(e.points);
      if (cost < dist[e.to]) {
        dist[e.to] = cost;
        pos[e.to] = exit;
        prev[e.to] = { room: u, portal: e };
      }
    }
  }
  if (dist[goal] === Infinity) return [];

  const chain: NavPoint[][] = [];
  for (let r = goal; r !== start; r = prev[r].room) chain.push(prev[r].portal.points);
  chain.reverse();
  return [...chain.flat(), { x: to.x, y: to.y, z: to.z }];
}

function d3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, (a.y - b.y) * 2, a.z - b.z);
}

function pathLen(p: { x: number; y: number; z: number }[]) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += d3(p[i - 1], p[i]);
  return s;
}
