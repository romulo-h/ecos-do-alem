import { BALANCE } from "../data/balance";
import type { Vec3 } from "../data/mansion";
import { findPath, type NavGraph, type NavPoint } from "../world/nav";
import { distanceToProp, floorOfY, lineOfSight, propCenter, type World } from "../world/world";
import { bestJumpTarget, canPossess, dynamicOf } from "./match";
import { emptyIntent, type Ghost, type Hunter, type Intent, type MatchState } from "./types";

/**
 * Bots que completam os times (como no expediente-caotico). Só produzem intenções, igual a um jogador;
 * a simulação decide o resto. Usam o grafo de cômodos para andar pela casa.
 */

const G = BALANCE.ghost;
const H = BALANCE.hunter;

export interface BotBrain {
  id: string;
  rng: () => number;
  path: NavPoint[];
  goal: Vec3 | null;
  repathAt: number;
  checkAt: number;
  lastX: number;
  lastZ: number;
  sidestepUntil: number;
  sidestep: number;
  // fantasma
  targetPropId: string | null;
  targetSince: number;
  leaveAt: number;
  // caçador
  suspectId: string | null;
  suspectSince: number;
  cleared: Map<string, number>;
  nextSaltAt: number;
}

export function createBotBrain(id: string, seed: number): BotBrain {
  return {
    id,
    rng: mulberry32(seed),
    path: [],
    goal: null,
    repathAt: 0,
    checkAt: 0,
    lastX: 0,
    lastZ: 0,
    sidestepUntil: 0,
    sidestep: 1,
    targetPropId: null,
    targetSince: 0,
    leaveAt: 14,
    suspectId: null,
    suspectSince: 0,
    cleared: new Map(),
    nextSaltAt: 0,
  };
}

export function botIntent(world: World, nav: NavGraph, s: MatchState, b: BotBrain): Intent {
  const g = s.ghosts.find((x) => x.id === b.id);
  if (g) return g.exorcised ? emptyIntent(g.yaw) : ghostBot(world, nav, s, b, g);
  const h = s.hunters.find((x) => x.id === b.id);
  if (h) return h.dead ? emptyIntent(h.yaw) : hunterBot(world, nav, s, b, h);
  return emptyIntent();
}

// ------------------------------------------------------------------ Fantasma

function ghostBot(world: World, nav: NavGraph, s: MatchState, b: BotBrain, g: Ghost): Intent {
  const it = emptyIntent(g.yaw, 0);
  if (s.phase === "ended") return it;

  if (g.huntMode) {
    // Caçada Invertida: persegue o caçador vivo mais perto e golpeia
    const target = nearest(s.hunters.filter((h) => !h.dead), g);
    if (!target) return it;
    const d = Math.hypot(target.x - g.x, target.z - g.z);
    const sameFloor = floorOfY(target.y) === floorOfY(g.y);
    if (sameFloor && d < 2.2) {
      it.yaw = Math.atan2(target.x - g.x, target.z - g.z);
      it.forward = d > 1.1 ? 1 : 0;
      it.fire = d <= G.attackRange + 0.2;
      return it;
    }
    followTo(nav, s, b, g, target, it, 0.7, true);
    return it;
  }

  if (g.propId) {
    // dentro do móvel: sai antes dos 20 s, de preferência saltando para longe da zona
    const underBeam = g.expulsion > 0.25;
    if (g.possessTime >= b.leaveAt || underBeam) {
      if (s.time >= g.jumpReadyAt) {
        const target = jumpOutOfZone(world, s, g);
        if (target) {
          it.jump = true;
          it.targetPropId = target;
          b.leaveAt = 10 + b.rng() * 6;
          return it;
        }
      }
      it.eject = true;
      b.targetPropId = null;
      b.leaveAt = 10 + b.rng() * 6;
      return it;
    }
    // isca: de vez em quando assombra o próprio móvel quando nenhum caçador está perto
    const near = nearest(s.hunters.filter((h) => !h.dead), g);
    if (s.time >= g.hauntReadyAt && near && Math.hypot(near.x - g.x, near.z - g.z) > 9 && b.rng() < 0.004) it.haunt = true;
    return it;
  }

  // forma etérea: escolhe um móvel e vai até ele
  if (!b.targetPropId || s.props[b.targetPropId].possessedBy || s.time - b.targetSince > 25) {
    b.targetPropId = pickHidingProp(world, s, b, g);
    b.targetSince = s.time;
    b.path = [];
    b.leaveAt = 10 + b.rng() * 6;
  }
  if (!b.targetPropId) return it;
  const p = world.propById.get(b.targetPropId)!;
  if (canPossess(world, s, g, p.id)) {
    it.interact = true;
    it.targetPropId = p.id;
    return it;
  }
  const c = propCenter(p);
  followTo(nav, s, b, g, { x: c.x, y: p.floor * world.data.floorHeight, z: c.z }, it, 3, true);
  return it;
}

function pickHidingProp(world: World, s: MatchState, b: BotBrain, g: Ghost): string | null {
  const hunters = s.hunters.filter((h) => !h.dead);
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const p of world.props) {
    if (s.props[p.id].possessedBy) continue;
    const c = propCenter(p);
    if (g.zone && Math.hypot(c.x - g.zone.x, c.z - g.zone.z) < 3) continue;
    if (g.burned && s.time < g.burnedUntil && Math.hypot(c.x - g.burned.x, c.z - g.burned.z) < 3) continue;
    const dGhost = Math.hypot(c.x - g.x, (c.y - g.y) * 2, c.z - g.z);
    const dHunter = hunters.length ? Math.min(...hunters.map((h) => Math.hypot(c.x - h.x, (c.y - h.y) * 2, c.z - h.z))) : 20;
    const score = Math.min(dHunter, 12) * 0.6 - dGhost * 0.35 + b.rng() * 4;
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

function jumpOutOfZone(world: World, s: MatchState, g: Ghost): string | null {
  if (!g.propId) return null;
  const from = propCenter(world.propById.get(g.propId)!);
  let best: string | null = null;
  let bestD = -1;
  for (const p of world.props) {
    if (p.id === g.propId || s.props[p.id].possessedBy) continue;
    const c = propCenter(p);
    const d = Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z);
    if (d > G.jumpRange - 0.1) continue;
    const fromZone = g.zone ? Math.hypot(c.x - g.zone.x, c.z - g.zone.z) : 99;
    if (fromZone <= G.zoneRadius + 0.2) continue;
    if (d > bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best ?? bestJumpTarget(world, s, g);
}

// ------------------------------------------------------------------ Caçador

function hunterBot(world: World, nav: NavGraph, s: MatchState, b: BotBrain, h: Hunter): Intent {
  const it = emptyIntent(h.yaw, 0);
  if (!h.canMove) {
    it.yaw = h.yaw + 0.01; // olha em volta enquanto espera
    return it;
  }
  const dyn = dynamicOf(s);
  const eye = { x: h.x, y: h.y + H.eye, z: h.z };

  if (s.phase === "reversal") {
    // foge do fantasma mais perto; sal quando ele encosta
    const ghosts = s.ghosts.filter((g) => !g.exorcised);
    const threat = nearest(ghosts, h);
    const dThreat = threat ? Math.hypot(threat.x - h.x, threat.z - h.z) : 99;
    if (threat && dThreat < 3 && h.salt > 0 && s.time >= b.nextSaltAt && floorOfY(threat.y) === floorOfY(h.y)) {
      it.yaw = Math.atan2(threat.x - h.x, threat.z - h.z);
      it.salt = true;
      b.nextSaltAt = s.time + 4;
      return it;
    }
    if (!b.goal || s.time >= b.repathAt || dist2(b.goal, h) < 1) {
      b.goal = fleeGoal(world, s, b, h);
      b.path = [];
      b.repathAt = s.time + 3;
    }
    followTo(nav, s, b, h, b.goal, it, 3, false);
    it.sprint = dThreat < 7;
    return it;
  }

  // 1) fantasma visível na forma etérea: mira e suga
  const visible = s.ghosts.find(
    (g) => !g.exorcised && !g.propId && Math.hypot(g.x - h.x, g.y - h.y, g.z - h.z) < H.beamRange - 0.3 && lineOfSight(world, dyn, eye.x, eye.y, eye.z, g.x, g.y + 0.9, g.z),
  );
  if (visible) {
    aimAt(it, eye, { x: visible.x, y: visible.y + 0.9, z: visible.z }, b, 0.04);
    it.fire = true;
    it.forward = Math.hypot(visible.x - h.x, visible.z - h.z) > 3 ? 0.6 : 0;
    return it;
  }

  // 2) EMF acusando: procura o móvel suspeito e testa com o aspirador
  if (h.emf >= 2) {
    const suspect = b.suspectId ? world.propById.get(b.suspectId) : undefined;
    const stillHot = suspect && (s.props[suspect.id].possessedBy || s.props[suspect.id].decoyUntil > s.time);
    if (!suspect || !stillHot) {
      b.suspectId = null;
      let bestD = Infinity;
      for (const p of world.props) {
        const ps = s.props[p.id];
        if (!ps.possessedBy && ps.decoyUntil <= s.time) continue;
        if ((b.cleared.get(p.id) ?? -1) > s.time) continue;
        const d = distanceToProp(p, h.x, h.y + 1, h.z, H.emfVerticalWeight);
        if (d < bestD && d <= H.emfRange) {
          bestD = d;
          b.suspectId = p.id;
        }
      }
      b.suspectSince = s.time;
    }
    if (b.suspectId) {
      const p = world.propById.get(b.suspectId)!;
      const c = propCenter(p);
      const d = distanceToProp(p, eye.x, eye.y, eye.z);
      const see = lineOfSight(world, dyn, eye.x, eye.y, eye.z, c.x, c.y, c.z);
      if (d < 3.5 && see) {
        aimAt(it, eye, c, b, 0.03);
        it.fire = true;
        // isca: 4 s de feixe sem ninguém sair = móvel vazio
        if (s.time - b.suspectSince > 4 && !s.props[p.id].possessedBy) {
          b.cleared.set(p.id, s.time + 15);
          b.suspectId = null;
        }
        return it;
      }
      followTo(nav, s, b, h, { x: c.x, y: p.floor * world.data.floorHeight, z: c.z }, it, 1.5, false);
      if (s.time - b.suspectSince > 14) {
        b.cleared.set(p.id, s.time + 10);
        b.suspectId = null;
      }
      return it;
    }
  }

  // 3) patrulha cômodo a cômodo
  if (!b.goal || dist2(b.goal, h) < 0.8 || s.time >= b.repathAt) {
    const rooms = nav.rooms.filter((r) => !r.outdoor);
    const r = rooms[Math.floor(b.rng() * rooms.length)];
    b.goal = { x: (r.minX + r.maxX) / 2, y: r.floor * world.data.floorHeight, z: (r.minZ + r.maxZ) / 2 };
    b.path = [];
    b.repathAt = s.time + 25;
  }
  followTo(nav, s, b, h, b.goal, it, 25, false);
  return it;
}

function fleeGoal(world: World, s: MatchState, b: BotBrain, h: Hunter): Vec3 {
  const ghosts = s.ghosts.filter((g) => !g.exorcised);
  let best: Vec3 = { x: h.x, y: h.y, z: h.z };
  let bestScore = -Infinity;
  for (let i = 0; i < 8; i++) {
    const r = world.data.rooms[Math.floor(b.rng() * world.data.rooms.length)];
    const p = { x: (r.minX + r.maxX) / 2, y: r.floor * world.data.floorHeight, z: (r.minZ + r.maxZ) / 2 };
    const score = ghosts.length ? Math.min(...ghosts.map((g) => Math.hypot(g.x - p.x, (g.y - p.y) * 2, g.z - p.z))) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// ------------------------------------------------------------------ Andar

function followTo(nav: NavGraph, s: MatchState, b: BotBrain, a: Ghost | Hunter, goal: Vec3, it: Intent, repathEvery: number, ghost: boolean) {
  const goalMoved = !b.goal || dist2(b.goal, goal) > 0.5;
  if (goalMoved || s.time >= b.repathAt || b.path.length === 0) {
    b.goal = goal;
    b.path = findPath(nav, a, goal);
    b.repathAt = s.time + repathEvery;
  }
  // pula pontos já alcançados
  while (b.path.length > 1 && Math.hypot(b.path[0].x - a.x, b.path[0].z - a.z) < 0.4 && Math.abs(b.path[0].y - a.y) < 1.2) b.path.shift();
  const next = b.path[0];
  if (!next) return;
  const dx = next.x - a.x;
  const dz = next.z - a.z;
  if (Math.hypot(dx, dz) < 0.25 && b.path.length === 1) return;

  it.yaw = Math.atan2(dx, dz);
  it.forward = 1;

  // caçador abre a porta fechada do caminho
  if (!ghost && next.doorId && !s.doorsOpen[next.doorId] && Math.hypot(dx, dz) < 1.6) {
    it.interact = true;
    it.targetDoorId = next.doorId;
  }

  // preso: dá um passo de lado e recalcula
  if (s.time >= b.checkAt) {
    const moved = Math.hypot(a.x - b.lastX, a.z - b.lastZ);
    if (moved < 0.25) {
      b.sidestepUntil = s.time + 0.6;
      b.sidestep = b.rng() < 0.5 ? -1 : 1;
      b.repathAt = s.time + 0.6;
    }
    b.lastX = a.x;
    b.lastZ = a.z;
    b.checkAt = s.time + 1;
  }
  if (s.time < b.sidestepUntil) it.right = b.sidestep;
}

function aimAt(it: Intent, eye: Vec3, target: Vec3, b: BotBrain, noise: number) {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  it.yaw = Math.atan2(dx, dz) + (b.rng() - 0.5) * noise;
  it.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (b.rng() - 0.5) * noise;
}

function nearest<T extends { x: number; y: number; z: number }>(list: T[], from: { x: number; y: number; z: number }): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const o of list) {
    const d = Math.hypot(o.x - from.x, (o.y - from.y) * 2, o.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function dist2(a: Vec3, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Gerador pseudoaleatório com semente (partidas de teste reproduzíveis). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
