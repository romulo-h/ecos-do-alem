import { BALANCE } from "../data/balance";
import { parseMansion, type MansionData, type PropDef, type Rect2, type StairDef } from "../data/mansion";
import { buildWalls, roomAt, type DoorPlacement, type WallKind } from "./walls";

/**
 * Geometria jogável da mansão, usada igual pela simulação (colisão, chão, raycast) e pelo cliente (visual).
 * Substitui a física do Unity por um modelo 2,5D: personagens são cilindros que colidem com caixas
 * no plano XZ, e a altura vem de pisos, blocos e rampas (as escadas são rampas na física e degraus no visual).
 */

export interface Box3 {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface WallBox extends Box3 {
  kind: WallKind;
}

export interface DoorGeom {
  id: string;
  placement: DoorPlacement;
  /** caixa da porta fechada */
  box: Box3;
  centerX: number;
  centerY: number;
  centerZ: number;
  floor: number;
}

/** Móvel como caixa girada (OBB). Pivô no centro da base, como nos modelos. */
export interface PropGeom {
  id: string;
  def: PropDef;
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  height: number;
  yawRad: number;
  cos: number;
  sin: number;
  floor: number;
}

export interface World {
  data: MansionData;
  walls: WallBox[];
  slabs: Box3[];
  solids: Box3[];
  ramps: StairDef[];
  doors: DoorGeom[];
  props: PropGeom[];
  propById: Map<string, PropGeom>;
  doorById: Map<string, DoorGeom>;
  errors: string[];
}

/** Estado que muda durante a partida e afeta a colisão. */
export interface DynamicWorld {
  isDoorOpen(id: string): boolean;
  salt: readonly SaltBox[];
}

export interface SaltBox {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  until: number;
}

export interface MoveOptions {
  /** fantasma atravessa portas fechadas */
  passDoors: boolean;
  /** sal bloqueia fantasmas */
  blockedBySalt: boolean;
}

const DOOR_THICKNESS = 0.08;
const RAIL_THICKNESS = 0.06;

// ------------------------------------------------------------------ Construção

export function buildWorld(data: MansionData = parseMansion()): World {
  const fh = data.floorHeight;
  const slab = BALANCE.world.slab;
  const res = buildWalls(data.rooms, data.doors, data.stairs, {
    floorHeight: fh,
    slab,
    doorHeight: data.doorHeight,
    archHeight: data.archHeight,
    railingHeight: data.railingHeight,
  });

  const t = data.wallThickness;
  const walls: WallBox[] = res.walls.map((w) => {
    const rail = w.kind === "railing";
    const thick = rail ? RAIL_THICKNESS : t;
    const ext = rail ? 0 : t / 2; // fecha os cantos
    const a0 = w.from - ext;
    const a1 = w.to + ext;
    return w.alongZ
      ? { kind: w.kind, minX: w.line - thick / 2, maxX: w.line + thick / 2, minZ: a0, maxZ: a1, minY: w.bottom, maxY: w.top }
      : { kind: w.kind, minX: a0, maxX: a1, minZ: w.line - thick / 2, maxZ: w.line + thick / 2, minY: w.bottom, maxY: w.top };
  });

  // Térreo: um piso só, cobrindo todos os cômodos (inclui a varanda).
  const slabs: Box3[] = [];
  const ground = data.rooms.filter((r) => r.floor === 0);
  slabs.push({
    minX: Math.min(...ground.map((r) => r.minX)),
    maxX: Math.max(...ground.map((r) => r.maxX)),
    minZ: Math.min(...ground.map((r) => r.minZ)),
    maxZ: Math.max(...ground.map((r) => r.maxZ)),
    minY: -slab,
    maxY: 0,
  });
  // Andares de cima: por cômodo, com buraco nas escadas.
  for (const room of data.rooms) {
    if (room.floor === 0 || room.outdoor) continue;
    const top = room.floor * fh;
    let pieces: Rect2[] = [room];
    for (const hole of data.stairs) pieces = pieces.flatMap((p) => subtractRect(p, hole));
    for (const p of pieces) slabs.push({ minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, minY: top - slab, maxY: top });
  }

  const solids: Box3[] = data.solids.map((b) => ({ minX: b.min[0], minY: b.min[1], minZ: b.min[2], maxX: b.max[0], maxY: b.max[1], maxZ: b.max[2] }));

  const doors: DoorGeom[] = res.doors.map((p) => {
    const mid = (p.from + p.to) / 2;
    const box: Box3 = p.alongZ
      ? { minX: p.line - DOOR_THICKNESS / 2, maxX: p.line + DOOR_THICKNESS / 2, minZ: p.from, maxZ: p.to, minY: p.bottom, maxY: p.bottom + p.height }
      : { minX: p.from, maxX: p.to, minZ: p.line - DOOR_THICKNESS / 2, maxZ: p.line + DOOR_THICKNESS / 2, minY: p.bottom, maxY: p.bottom + p.height };
    return {
      id: p.door.id,
      placement: p,
      box,
      centerX: p.alongZ ? p.line : mid,
      centerZ: p.alongZ ? mid : p.line,
      centerY: p.bottom + p.height / 2,
      floor: p.floor,
    };
  });

  const props: PropGeom[] = data.props.map((d) => {
    const yawRad = (d.rotationY * Math.PI) / 180;
    return {
      id: d.id,
      def: d,
      x: d.x,
      y: d.y,
      z: d.z,
      hx: d.type.dimensions[0] / 2,
      hz: d.type.dimensions[2] / 2,
      height: d.type.dimensions[1],
      yawRad,
      cos: Math.cos(yawRad),
      sin: Math.sin(yawRad),
      floor: d.floor,
    };
  });

  return {
    data,
    walls,
    slabs,
    solids,
    ramps: data.stairs,
    doors,
    props,
    propById: new Map(props.map((p) => [p.id, p])),
    doorById: new Map(doors.map((d) => [d.id, d])),
    errors: res.errors,
  };
}

/** r − hole, em até 4 retângulos. */
export function subtractRect(r: Rect2, hole: Rect2): Rect2[] {
  if (hole.maxX <= r.minX || hole.minX >= r.maxX || hole.maxZ <= r.minZ || hole.minZ >= r.maxZ) return [r];
  const ixMin = Math.max(r.minX, hole.minX);
  const ixMax = Math.min(r.maxX, hole.maxX);
  const izMin = Math.max(r.minZ, hole.minZ);
  const izMax = Math.min(r.maxZ, hole.maxZ);
  const out: Rect2[] = [];
  if (izMin > r.minZ) out.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: izMin });
  if (izMax < r.maxZ) out.push({ minX: r.minX, maxX: r.maxX, minZ: izMax, maxZ: r.maxZ });
  if (ixMin > r.minX) out.push({ minX: r.minX, maxX: ixMin, minZ: izMin, maxZ: izMax });
  if (ixMax < r.maxX) out.push({ minX: ixMax, maxX: r.maxX, minZ: izMin, maxZ: izMax });
  return out.filter((p) => p.maxX - p.minX > 0.01 && p.maxZ - p.minZ > 0.01);
}

// ------------------------------------------------------------------ Consultas

export function floorOfY(y: number): number {
  return y >= BALANCE.world.upperFloorY ? 1 : 0;
}

export function roomNameAt(world: World, x: number, y: number, z: number): string | undefined {
  const f = floorOfY(y);
  return roomAt(world.data.rooms.filter((r) => r.floor === f), x, z)?.name;
}

/** Altura da rampa da escada no ponto, ou null se fora dela. */
export function rampHeight(r: StairDef, x: number, z: number): number | null {
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return null;
  let t: number;
  switch (r.ascend) {
    case "-z":
      t = (r.maxZ - z) / (r.maxZ - r.minZ);
      break;
    case "+z":
      t = (z - r.minZ) / (r.maxZ - r.minZ);
      break;
    case "-x":
      t = (r.maxX - x) / (r.maxX - r.minX);
      break;
    default:
      t = (x - r.minX) / (r.maxX - r.minX);
  }
  return r.h0 + Math.min(1, Math.max(0, t)) * (r.h1 - r.h0);
}

/** Chão mais alto alcançável a partir da altura y (sobe até stepUp). */
export function groundAt(world: World, x: number, z: number, y: number): number {
  const reach = y + BALANCE.world.stepUp;
  let best = -50;
  const consider = (top: number) => {
    if (top <= reach && top > best) best = top;
  };
  for (const s of world.slabs) if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) consider(s.maxY);
  for (const s of world.solids) if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) consider(s.maxY);
  for (const r of world.ramps) {
    const h = rampHeight(r, x, z);
    if (h !== null) consider(h);
  }
  return best;
}

/** Ponto do móvel mais próximo de p (OBB). */
export function closestPointOnProp(p: PropGeom, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const dx = x - p.x;
  const dz = z - p.z;
  // mundo -> local: inversa da rotação em Y
  const lx = dx * p.cos - dz * p.sin;
  const lz = dx * p.sin + dz * p.cos;
  const cx = clamp(lx, -p.hx, p.hx);
  const cz = clamp(lz, -p.hz, p.hz);
  const cy = clamp(y, p.y, p.y + p.height);
  return { x: p.x + cx * p.cos + cz * p.sin, y: cy, z: p.z - cx * p.sin + cz * p.cos };
}

export function propCenter(p: PropGeom): { x: number; y: number; z: number } {
  return { x: p.x, y: p.y + p.height / 2, z: p.z };
}

export function distanceToProp(p: PropGeom, x: number, y: number, z: number, verticalWeight = 1): number {
  const c = closestPointOnProp(p, x, y, z);
  const dx = x - c.x;
  const dy = (y - c.y) * verticalWeight;
  const dz = z - c.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------------------------------------------------ Colisão do personagem

export interface Body {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
}

/**
 * Move o corpo (cilindro de raio r e altura h) em dx/dz, empurrando para fora das paredes, e aplica
 * gravidade/escadas. Subpassos curtos evitam atravessar paredes finas.
 */
export function moveBody(world: World, dyn: DynamicWorld, b: Body, r: number, h: number, dx: number, dz: number, dt: number, opt: MoveOptions) {
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.1));
  for (let i = 0; i < steps; i++) {
    b.x += dx / steps;
    b.z += dz / steps;
    pushOut(world, dyn, b, r, h, opt);
    // degrau/rampa: sobe na hora
    const g = groundAt(world, b.x, b.z, b.y);
    if (g > b.y) {
      b.y = g;
      b.vy = 0;
    }
  }
  if (len === 0) pushOut(world, dyn, b, r, h, opt);

  const g = groundAt(world, b.x, b.z, b.y);
  if (b.y - g <= BALANCE.world.stepDown && b.vy <= 0 && b.grounded) {
    b.y = g; // desce a escada grudado no chão
    b.vy = 0;
  } else {
    b.vy -= BALANCE.world.gravity * dt;
    b.y += b.vy * dt;
    if (b.y <= g) {
      b.y = g;
      b.vy = 0;
    }
  }
  b.grounded = b.y <= g + 0.001;
}

/** O cilindro está encostando em algo (usado para achar lugar livre ao sair de um móvel). */
export function bodyOverlaps(world: World, dyn: DynamicWorld, x: number, y: number, z: number, r: number, h: number, opt: MoveOptions): boolean {
  let hit = false;
  forEachObstacle(world, dyn, x, y, z, r, h, opt, () => {
    hit = true;
  });
  return hit;
}

function pushOut(world: World, dyn: DynamicWorld, b: Body, r: number, h: number, opt: MoveOptions) {
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    forEachObstacle(world, dyn, b.x, b.y, b.z, r, h, opt, (px, pz) => {
      b.x += px;
      b.z += pz;
      moved = true;
    });
    if (!moved) return;
  }
}

/**
 * Chama push(px, pz) com o empurrão necessário para cada obstáculo que o cilindro encosta.
 * Só contam obstáculos na faixa de altura do corpo (acima do degrau que dá para subir).
 */
function forEachObstacle(world: World, dyn: DynamicWorld, x: number, y: number, z: number, r: number, h: number, opt: MoveOptions, push: (px: number, pz: number) => void) {
  const lo = y + BALANCE.world.stepUp;
  const hi = y + h;
  const box = (bx: Box3) => {
    if (bx.minY >= hi || bx.maxY <= lo) return;
    const p = circleVsRect(x, z, r, bx.minX, bx.minZ, bx.maxX, bx.maxZ);
    if (p) {
      push(p[0], p[1]);
      x += p[0];
      z += p[1];
    }
  };
  for (const w of world.walls) box(w);
  for (const s of world.solids) box(s);
  for (const s of world.slabs) box(s);
  if (!opt.passDoors) for (const d of world.doors) if (!dyn.isDoorOpen(d.id)) box(d.box);
  for (const rp of world.ramps) {
    // a lateral/parte alta da escada é parede para quem está embaixo
    const cx = clamp(x, rp.minX, rp.maxX);
    const cz = clamp(z, rp.minZ, rp.maxZ);
    const hgt = rampHeight(rp, cx, cz) ?? 0;
    if (hgt > lo && rp.h0 < hi) box({ minX: rp.minX, maxX: rp.maxX, minZ: rp.minZ, maxZ: rp.maxZ, minY: rp.h0, maxY: hgt });
  }
  for (const p of world.props) {
    if (p.y >= hi || p.y + p.height <= lo) continue;
    const q = circleVsObb(x, z, r, p.x, p.z, p.hx, p.hz, p.cos, p.sin);
    if (q) {
      push(q[0], q[1]);
      x += q[0];
      z += q[1];
    }
  }
  if (opt.blockedBySalt) {
    const S = BALANCE.hunter;
    for (const s of dyn.salt) {
      if (s.y >= hi || s.y + S.saltHeight <= lo) continue;
      const q = circleVsObb(x, z, r, s.x, s.z, S.saltWidth / 2, S.saltDepth / 2, Math.cos(s.yaw), Math.sin(s.yaw));
      if (q) {
        push(q[0], q[1]);
        x += q[0];
        z += q[1];
      }
    }
  }
}

function circleVsRect(x: number, z: number, r: number, minX: number, minZ: number, maxX: number, maxZ: number): [number, number] | null {
  const cx = clamp(x, minX, maxX);
  const cz = clamp(z, minZ, maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    return [(dx / d) * (r - d), (dz / d) * (r - d)];
  }
  // centro dentro da caixa: sai pela face mais próxima
  const left = x - minX;
  const right = maxX - x;
  const back = z - minZ;
  const front = maxZ - z;
  const m = Math.min(left, right, back, front);
  if (m === left) return [-(left + r), 0];
  if (m === right) return [right + r, 0];
  if (m === back) return [0, -(back + r)];
  return [0, front + r];
}

function circleVsObb(x: number, z: number, r: number, ox: number, oz: number, hx: number, hz: number, cos: number, sin: number): [number, number] | null {
  const dx = x - ox;
  const dz = z - oz;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const p = circleVsRect(lx, lz, r, -hx, -hz, hx, hz);
  if (!p) return null;
  // local -> mundo
  return [p[0] * cos + p[1] * sin, -p[0] * sin + p[1] * cos];
}

// ------------------------------------------------------------------ Raycast

export type HitKind = "wall" | "door" | "prop" | "solid" | "slab" | "salt" | "actor";

export interface RayHit {
  t: number;
  kind: HitKind;
  id?: string;
}

export interface RayActor {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
}

export interface RayOptions {
  props?: boolean;
  /** portas fechadas bloqueiam */
  doors?: boolean;
  salt?: boolean;
  actors?: RayActor[];
  ignoreActorId?: string;
  ignorePropId?: string;
}

export function raycast(world: World, dyn: DynamicWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, opt: RayOptions = {}): RayHit | null {
  let best: RayHit | null = null;
  const consider = (t: number | null, kind: HitKind, id?: string) => {
    if (t !== null && t <= maxDist && (best === null || t < best.t)) best = { t, kind, id };
  };
  const obb = (cx: number, cy: number, cz: number, hx: number, h: number, hz: number, cos: number, sin: number) => {
    const rx = ox - cx;
    const rz = oz - cz;
    const lox = rx * cos - rz * sin;
    const loz = rx * sin + rz * cos;
    const ldx = dx * cos - dz * sin;
    const ldz = dx * sin + dz * cos;
    return rayAabb(lox, oy, loz, ldx, dy, ldz, { minX: -hx, maxX: hx, minZ: -hz, maxZ: hz, minY: cy, maxY: cy + h });
  };

  for (const w of world.walls) consider(rayAabb(ox, oy, oz, dx, dy, dz, w), "wall");
  for (const s of world.solids) consider(rayAabb(ox, oy, oz, dx, dy, dz, s), "solid");
  for (const s of world.slabs) consider(rayAabb(ox, oy, oz, dx, dy, dz, s), "slab");
  if (opt.doors !== false) for (const d of world.doors) if (!dyn.isDoorOpen(d.id)) consider(rayAabb(ox, oy, oz, dx, dy, dz, d.box), "door", d.id);
  if (opt.props) for (const p of world.props) if (p.id !== opt.ignorePropId) consider(obb(p.x, p.y, p.z, p.hx, p.height, p.hz, p.cos, p.sin), "prop", p.id);
  if (opt.salt) {
    const S = BALANCE.hunter;
    for (const s of dyn.salt) consider(obb(s.x, s.y, s.z, S.saltWidth / 2, S.saltHeight, S.saltDepth / 2, Math.cos(s.yaw), Math.sin(s.yaw)), "salt", String(s.id));
  }
  for (const a of opt.actors ?? []) {
    if (a.id === opt.ignoreActorId) continue;
    consider(rayAabb(ox, oy, oz, dx, dy, dz, { minX: a.x - a.r, maxX: a.x + a.r, minZ: a.z - a.r, maxZ: a.z + a.r, minY: a.y, maxY: a.y + a.h }), "actor", a.id);
  }
  return best;
}

/** Linha de visão livre entre dois pontos (paredes, portas fechadas e, se pedido, sal). */
export function lineOfSight(world: World, dyn: DynamicWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number, salt = false): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return raycast(world, dyn, ax, ay, az, dx / len, dy / len, dz / len, len, { doors: true, salt }) === null;
}

function rayAabb(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box3): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axis = (o: number, d: number, mn: number, mx: number) => {
    if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!axis(ox, dx, b.minX, b.maxX) || !axis(oy, dy, b.minY, b.maxY) || !axis(oz, dz, b.minZ, b.maxZ)) return null;
  return tmin;
}

// ------------------------------------------------------------------ Direções

/** Para frente em yaw (radianos): mesma convenção do rotation.y do Three.js e do Unity. */
export function forwardOf(yaw: number): [number, number] {
  return [Math.sin(yaw), Math.cos(yaw)];
}

/** Direita no plano para quem olha em yaw. */
export function rightOf(yaw: number): [number, number] {
  return [-Math.cos(yaw), Math.sin(yaw)];
}

/** Direção da mira com inclinação (pitch > 0 = olhando para cima). */
export function aimDir(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
