import { BALANCE } from "../data/balance";
import {
  aimDir,
  bodyOverlaps,
  clamp,
  distanceToProp,
  floorOfY,
  forwardOf,
  groundAt,
  lineOfSight,
  moveBody,
  propCenter,
  raycast,
  rightOf,
  type DynamicWorld,
  type PropGeom,
  type RayActor,
  type World,
} from "../world/world";
import type { Vec3 } from "../data/mansion";
import type { Ghost, Hunter, Intent, MatchConfig, MatchState, PlayerSlot, Team } from "./types";

/**
 * A partida inteira como função pura de passo: stepMatch(world, estado, intenções, dt).
 * Esconderijo (15 s) → busca (6 min) → Caçada Invertida (2 min) → fim. Regras do GhostGameManager,
 * GhostController, HunterController e PossessableProp do projeto Unity.
 */

const G = BALANCE.ghost;
const H = BALANCE.hunter;

export const DEFAULT_CONFIG: MatchConfig = {
  roundSeconds: BALANCE.match.round,
  hideSeconds: BALANCE.match.hidePhase,
  reversal: true,
  reversalSeconds: BALANCE.match.reversal,
};

// ------------------------------------------------------------------ Criação

export function createMatch(world: World, players: PlayerSlot[], config: Partial<MatchConfig> = {}): MatchState {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const spawns = world.data.spawns;
  const ghosts: Ghost[] = [];
  const hunters: Hunter[] = [];

  for (const p of players) {
    if (p.team === "ghost") {
      const s = spawns.ghosts[ghosts.length % spawns.ghosts.length];
      const yaw = faceCenter(s);
      ghosts.push({
        id: p.id,
        name: p.name,
        bot: p.bot,
        team: "ghost",
        x: s.x,
        y: s.y,
        z: s.z,
        vy: 0,
        grounded: true,
        yaw,
        pitch: 0,
        bodyYaw: yaw,
        speed: 0,
        health: G.maxHealth,
        exorcised: false,
        exorcisedAt: -1,
        lastDamageAt: -999,
        propId: null,
        possessTime: 0,
        zone: null,
        zoneLeftAt: -999,
        burned: null,
        burnedUntil: -999,
        warned: false,
        exposedUntil: -999,
        jumpReadyAt: 0,
        hauntReadyAt: 0,
        attackReadyAt: 0,
        attackAt: -1,
        lastAttackAt: -999,
        expulsion: 0,
        lastBeamAt: -999,
        footX: s.x,
        footZ: s.z,
        footLeft: false,
        huntMode: false,
        emergedAt: -999,
      });
    } else {
      const s = spawns.hunters[hunters.length % spawns.hunters.length];
      const yaw = faceCenter(s);
      hunters.push({
        id: p.id,
        name: p.name,
        bot: p.bot,
        team: "hunter",
        x: s.x,
        y: s.y,
        z: s.z,
        vy: 0,
        grounded: true,
        yaw,
        pitch: 0,
        bodyYaw: yaw,
        speed: 0,
        health: H.maxHealth,
        dead: false,
        diedAt: -1,
        stamina: H.maxStamina,
        exhausted: false,
        lastSprintAt: -999,
        sprinting: false,
        flashlight: true,
        thermal: false,
        salt: H.saltCharges,
        emf: 0,
        beam: null,
        aiming: false,
        lastHurtAt: -999,
        canMove: false,
      });
    }
  }

  const props: MatchState["props"] = {};
  for (const p of world.props) props[p.id] = { possessedBy: null, warning: false, decoyUntil: -999, shakeUntil: -999 };
  const doorsOpen: Record<string, boolean> = {};
  for (const d of world.doors) doorsOpen[d.id] = false;

  return {
    time: 0,
    phase: "hiding",
    hideRemaining: cfg.hideSeconds,
    timeRemaining: cfg.roundSeconds,
    reversalRemaining: cfg.reversalSeconds,
    config: cfg,
    ghosts,
    hunters,
    props,
    doorsOpen,
    salt: [],
    footprints: [],
    winner: null,
    winReason: "",
    events: [{ type: "phase", phase: "hiding" }],
    nextId: 1,
    startedAt: 0,
    endedAt: -1,
  };
}

function faceCenter(p: Vec3): number {
  return Math.atan2(-p.x, -p.z); // para onde fica o centro da casa (origem)
}

/** Visão da colisão que muda com o estado (portas e sal). */
export function dynamicOf(s: MatchState): DynamicWorld {
  return { isDoorOpen: (id) => !!s.doorsOpen[id], salt: s.salt };
}

// ------------------------------------------------------------------ Passo

export function stepMatch(world: World, s: MatchState, intents: Record<string, Intent | undefined>, dt: number): void {
  s.events = [];
  if (s.phase === "ended") return;
  s.time += dt;
  const dyn = dynamicOf(s);

  // relógio da partida
  if (s.phase === "hiding") {
    s.hideRemaining = Math.max(0, s.hideRemaining - dt);
    if (s.hideRemaining <= 0) setPhase(s, "hunting");
  } else if (s.phase === "hunting") {
    s.timeRemaining = Math.max(0, s.timeRemaining - dt);
  } else if (s.phase === "reversal") {
    s.reversalRemaining = Math.max(0, s.reversalRemaining - dt);
  }
  for (const h of s.hunters) h.canMove = !h.dead && s.phase !== "hiding";

  for (const g of s.ghosts) if (!g.exorcised) stepGhost(world, dyn, s, g, intents[g.id], dt);
  for (const h of s.hunters) if (!h.dead) stepHunter(world, dyn, s, h, intents[h.id], dt);

  // sal e pegadas expiram (a lista do sal é trocada no lugar: o DynamicWorld guarda a referência)
  const live = s.salt.filter((b) => b.until > s.time);
  if (live.length !== s.salt.length) s.salt.splice(0, s.salt.length, ...live);
  const life = G.footprintLife;
  if (s.footprints.length && s.time - s.footprints[0].at > life) s.footprints = s.footprints.filter((f) => s.time - f.at <= life);

  // aviso visível do móvel (tremor dos 15 s)
  for (const id in s.props) {
    const ps = s.props[id];
    const g = ps.possessedBy ? s.ghosts.find((x) => x.id === ps.possessedBy) : undefined;
    ps.warning = !!g && g.possessTime >= G.warning;
  }

  checkEnd(s);
  if (s.phase === "hunting" && s.timeRemaining <= 0) {
    if (s.config.reversal) startReversal(world, dyn, s);
    else endMatch(s, "ghost", "O tempo acabou");
  } else if (s.phase === "reversal" && s.reversalRemaining <= 0) {
    endMatch(s, "hunter", "Os caçadores sobreviveram à Caçada Invertida");
  }
}

function setPhase(s: MatchState, phase: MatchState["phase"]) {
  s.phase = phase;
  s.events.push({ type: "phase", phase });
}

function checkEnd(s: MatchState) {
  if (s.phase === "ended") return;
  const aliveG = s.ghosts.filter((g) => !g.exorcised).length;
  const aliveH = s.hunters.filter((h) => !h.dead).length;
  if (s.ghosts.length > 0 && aliveG === 0) endMatch(s, "hunter", "Todos os espíritos foram exorcizados");
  else if (s.hunters.length > 0 && aliveH === 0) endMatch(s, "ghost", "Todos os caçadores foram pegos");
}

function endMatch(s: MatchState, winner: Team, reason: string) {
  if (s.phase === "ended") return;
  s.winner = winner;
  s.winReason = reason;
  s.endedAt = s.time;
  for (const h of s.hunters) {
    h.canMove = false;
    h.beam = null;
  }
  setPhase(s, "ended");
  s.events.push({ type: "end", winner, reason });
}

function startReversal(world: World, dyn: DynamicWorld, s: MatchState) {
  setPhase(s, "reversal");
  for (const g of s.ghosts) {
    if (g.exorcised) continue;
    if (g.propId) ejectGhost(world, dyn, s, g, "emerge");
    g.huntMode = true;
    g.emergedAt = s.time;
  }
  for (const h of s.hunters) h.beam = null;
}

export function aliveCounts(s: MatchState): { ghosts: number; hunters: number } {
  return { ghosts: s.ghosts.filter((g) => !g.exorcised).length, hunters: s.hunters.filter((h) => !h.dead).length };
}

// ------------------------------------------------------------------ Fantasma

const GHOST_MOVE = { passDoors: true, blockedBySalt: true };

/**
 * Move a forma etérea contornando quinas. Quando o fantasma bate quase de frente num batente de porta ou na
 * quina de um móvel, o empurrão da colisão anula o passo e ele fica preso. Nesse caso testa direções
 * vizinhas (±25°, ±50°, ±75°): segue cada uma por mais 0,3 m e mede quanto um trecho reto de 0,6 m andaria
 * dali. Fica com o primeiro passo da direção que leva mais longe; no tick seguinte reavalia. Assim, encostado
 * no batente, o fantasma escorrega para dentro do vão; contra uma parede lisa nenhuma direção ajuda e ele fica
 * parado, como antes. Só roda quando o passo normal quase não andou.
 */
function moveGhostAssisted(world: World, dyn: DynamicWorld, g: Ghost, dx: number, dz: number, dt: number) {
  const want = Math.hypot(dx, dz);
  const start = { x: g.x, y: g.y, z: g.z, vy: g.vy, grounded: g.grounded };
  moveBody(world, dyn, g, G.radius, G.height, dx, dz, dt, GHOST_MOVE);
  if (want < 1e-6) return;
  const ux = dx / want;
  const uz = dz / want;
  /** quanto g andou, a partir de `from`, na direção desejada */
  const forward = (from: { x: number; z: number }) => (g.x - from.x) * ux + (g.z - from.z) * uz;
  if (forward(start) >= want * 0.4) return;

  const save = () => ({ x: g.x, y: g.y, z: g.z, vy: g.vy, grounded: g.grounded });
  /** avanço de um trecho reto de 0,6 m a partir da posição atual (moveBody subdivide e contorna quinas) */
  const reach = () => {
    const here = save();
    moveBody(world, dyn, g, G.radius, G.height, ux * 0.6, uz * 0.6, dt, GHOST_MOVE);
    const r = forward(here);
    Object.assign(g, here);
    return r;
  };

  let best = { pos: save(), value: forward(start) + reach() };
  for (const deg of [25, -25, 50, -50, 75, -75]) {
    const a = (deg * Math.PI) / 180;
    const ax = ux * Math.cos(a) - uz * Math.sin(a);
    const az = ux * Math.sin(a) + uz * Math.cos(a);
    Object.assign(g, start);
    moveBody(world, dyn, g, G.radius, G.height, ax * want, az * want, dt, GHOST_MOVE);
    const step = save();
    moveBody(world, dyn, g, G.radius, G.height, ax * 0.3, az * 0.3, dt, GHOST_MOVE);
    const value = forward(start) + reach();
    if (value > best.value + 0.05) best = { pos: step, value };
    if (best.value >= 0.45) break;
  }
  Object.assign(g, best.pos);
}

function stepGhost(world: World, dyn: DynamicWorld, s: MatchState, g: Ghost, intent: Intent | undefined, dt: number) {
  // vida: regenera depois de um tempo sem dano; o medidor de expulsão esvazia sem feixe
  if (s.time - g.lastDamageAt >= G.regenDelay) g.health = Math.min(G.maxHealth, g.health + G.regen * dt);
  if (s.time - g.lastBeamAt > 0.2) g.expulsion = Math.max(0, g.expulsion - G.expulsionDecay * dt);

  if (intent) {
    g.yaw = intent.yaw;
    g.pitch = clamp(intent.pitch, -1.2, 1.2);
  }

  if (g.propId) {
    g.speed = 0;
    g.possessTime += dt;
    if (!g.warned && g.possessTime >= G.warning) {
      g.warned = true;
      s.events.push({ type: "warning", ghostId: g.id, propId: g.propId });
    }
    if (g.possessTime >= G.maxStay) {
      ejectGhost(world, dyn, s, g, "forced");
      return;
    }
    if (!intent) return;
    if (intent.eject || intent.interact) {
      ejectGhost(world, dyn, s, g, "voluntary");
      return;
    }
    if (intent.jump) trySpectralJump(world, s, g, intent.targetPropId ?? null);
    if (intent.haunt) tryHaunt(world, s, g, intent);
    return;
  }

  // forma etérea
  const speed = g.huntMode ? G.huntSpeed : G.speed;
  let mx = 0;
  let mz = 0;
  if (intent) {
    const [fx, fz] = forwardOf(intent.yaw);
    const [rx, rz] = rightOf(intent.yaw);
    mx = fx * intent.forward + rx * intent.right;
    mz = fz * intent.forward + rz * intent.right;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
  }
  const x0 = g.x;
  const z0 = g.z;
  moveGhostAssisted(world, dyn, g, mx * speed * dt, mz * speed * dt, dt);
  g.speed = Math.hypot(g.x - x0, g.z - z0) / dt;
  if (Math.hypot(mx, mz) > 0.1) g.bodyYaw = turnToward(g.bodyYaw, Math.atan2(mx, mz), 12 * dt);
  else if (g.huntMode) g.bodyYaw = turnToward(g.bodyYaw, g.yaw, 12 * dt);

  // pegadas espectrais (câmera térmica)
  if (g.grounded && Math.hypot(g.x - g.footX, g.z - g.footZ) >= G.footprintSpacing) {
    g.footLeft = !g.footLeft;
    s.footprints.push({ x: g.x, y: g.y, z: g.z, yaw: g.bodyYaw, left: g.footLeft, at: s.time });
    g.footX = g.x;
    g.footZ = g.z;
    if (s.footprints.length > 600) s.footprints.shift();
  }

  // golpe em preparo
  if (g.attackAt >= 0 && s.time >= g.attackAt) {
    g.attackAt = -1;
    resolveAttack(world, dyn, s, g);
  }

  if (!intent) return;
  if (g.huntMode) {
    if (intent.fire && s.time >= g.attackReadyAt) {
      g.attackReadyAt = s.time + G.attackCooldown;
      g.attackAt = s.time + G.attackWindup;
      g.lastAttackAt = s.time;
      s.events.push({ type: "attack", ghostId: g.id });
    }
    if (intent.haunt) tryHaunt(world, s, g, intent); // ainda pode bater portas
    return;
  }
  if (intent.interact && intent.targetPropId) tryPossess(world, s, g, intent.targetPropId);
  else if (intent.haunt) tryHaunt(world, s, g, intent);
}

function ghostChest(g: Ghost): Vec3 {
  return { x: g.x, y: g.y + 0.9, z: g.z };
}

function sameFloorDist(a: Vec3, b: Vec3): number {
  if (floorOfY(a.y) !== floorOfY(b.y)) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function isBurned(s: MatchState, g: Ghost, p: PropGeom): boolean {
  return !!g.burned && s.time < g.burnedUntil && sameFloorDist(propCenter(p), g.burned) <= G.zoneRadius;
}

/** Possível possuir este móvel agora (o cliente usa para o destaque da mira). */
export function canPossess(world: World, s: MatchState, g: Ghost, propId: string): boolean {
  const p = world.propById.get(propId);
  if (!p || g.huntMode || g.propId || g.exorcised) return false;
  if (s.props[propId].possessedBy) return false;
  const c = ghostChest(g);
  if (distanceToProp(p, c.x, c.y, c.z) > G.possessRange) return false;
  return !isBurned(s, g, p);
}

export function tryPossess(world: World, s: MatchState, g: Ghost, propId: string): boolean {
  if (!canPossess(world, s, g, propId)) return false;
  enterProp(s, g, world.propById.get(propId)!, false);
  return true;
}

/**
 * Entra no móvel. O contador dos 20 s continua se o novo móvel estiver a até 2 m da zona (mesmo andar)
 * e o fantasma não ficou mais de 10 s fora dela; senão zera e a zona passa a ser este móvel.
 */
function enterProp(s: MatchState, g: Ghost, p: PropGeom, viaJump: boolean) {
  const c = propCenter(p);
  const recent = viaJump || s.time - g.zoneLeftAt <= G.zoneMemory;
  const inZone = !!g.zone && recent && sameFloorDist(c, g.zone) <= G.zoneRadius;
  if (!inZone) {
    g.possessTime = 0;
    g.warned = false;
    g.zone = c;
  }
  if (g.propId) s.props[g.propId].possessedBy = null;
  g.propId = p.id;
  s.props[p.id].possessedBy = g.id;
  g.x = p.x;
  g.y = p.y;
  g.z = p.z;
  g.vy = 0;
  g.speed = 0;
  s.events.push({ type: "possess", ghostId: g.id, propId: p.id });
}

type EjectMode = "voluntary" | "forced" | "emerge";

export function ejectGhost(world: World, dyn: DynamicWorld, s: MatchState, g: Ghost, mode: EjectMode) {
  const propId = g.propId;
  if (!propId) return;
  const p = world.propById.get(propId)!;
  s.props[propId].possessedBy = null;
  g.propId = null;

  const spot = freeSpotNear(world, dyn, p, g.yaw);
  g.x = spot.x;
  g.y = spot.y;
  g.z = spot.z;
  g.vy = 0;
  g.grounded = true;
  g.footX = g.x;
  g.footZ = g.z;

  if (mode === "forced") {
    g.exposedUntil = s.time + G.exposed;
    g.burned = g.zone ?? propCenter(p);
    g.burnedUntil = s.time + G.zoneMemory;
    g.zone = null;
    g.possessTime = 0;
    g.warned = false;
    g.expulsion = 0;
  } else if (mode === "emerge") {
    g.zone = null;
    g.possessTime = 0;
    g.warned = false;
  } else {
    g.zoneLeftAt = s.time;
  }
  s.events.push({ type: "eject", ghostId: g.id, propId, forced: mode === "forced" });
}

/** Lugar livre em volta do móvel, começando pela direção da câmera. */
function freeSpotNear(world: World, dyn: DynamicWorld, p: PropGeom, yaw: number): Vec3 {
  const floorY = p.floor * world.data.floorHeight;
  const base = Math.max(p.hx, p.hz) + G.radius + 0.15;
  const c = propCenter(p);
  for (const ring of [0, 0.45, 0.9]) {
    for (let k = 0; k < 12; k++) {
      const a = yaw + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      const d = base + ring;
      const x = p.x + Math.sin(a) * d;
      const z = p.z + Math.cos(a) * d;
      const y = groundAt(world, x, z, floorY + 0.3);
      if (Math.abs(y - floorY) > 0.5) continue;
      if (bodyOverlaps(world, dyn, x, y, z, G.radius, G.height, GHOST_MOVE)) continue;
      if (!lineOfSight(world, dyn, c.x, floorY + 1, c.z, x, floorY + 1, z)) continue;
      return { x, y, z };
    }
  }
  return { x: p.x, y: Math.max(floorY, p.y + p.height), z: p.z };
}

/** Melhor alvo do Salto Espectral: o móvel livre mais à frente da câmera, dentro do alcance. */
export function bestJumpTarget(world: World, s: MatchState, g: Ghost): string | null {
  if (!g.propId) return null;
  const from = propCenter(world.propById.get(g.propId)!);
  const [fx, fz] = forwardOf(g.yaw);
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const p of world.props) {
    if (p.id === g.propId || s.props[p.id].possessedBy) continue;
    const c = propCenter(p);
    const d = Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z);
    if (d > G.jumpRange || d < 0.3) continue;
    const dot = ((c.x - from.x) * fx + (c.z - from.z) * fz) / Math.max(0.01, Math.hypot(c.x - from.x, c.z - from.z));
    const score = dot * 3 - d * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

export function trySpectralJump(world: World, s: MatchState, g: Ghost, targetId: string | null): boolean {
  if (!g.propId || g.huntMode || s.time < g.jumpReadyAt) return false;
  const id = targetId ?? bestJumpTarget(world, s, g);
  if (!id || id === g.propId) return false;
  const target = world.propById.get(id);
  if (!target || s.props[id].possessedBy) return false;
  const from = propCenter(world.propById.get(g.propId)!);
  const to = propCenter(target);
  if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > G.jumpRange) return false;
  if (isBurned(s, g, target)) return false;
  if (segmentCrossesSalt(s, from, to)) return false; // o sal barra o salto

  const fromId = g.propId;
  g.jumpReadyAt = s.time + G.jumpCooldown;
  enterProp(s, g, target, true);
  s.events.push({ type: "jump", ghostId: g.id, from: fromId, to: id });
  return true;
}

function segmentCrossesSalt(s: MatchState, a: Vec3, b: Vec3): boolean {
  if (!s.salt.length) return false;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / 0.1));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const sb of s.salt) {
      if (y < sb.y - 0.5 || y > sb.y + H.saltHeight) continue;
      const dx = x - sb.x;
      const dz = z - sb.z;
      const c = Math.cos(sb.yaw);
      const sn = Math.sin(sb.yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      if (Math.abs(lx) <= H.saltWidth / 2 && Math.abs(lz) <= H.saltDepth / 2 + 0.1) return true;
    }
  }
  return false;
}

/**
 * Assombração Ativa: no móvel atual (ou num mirado a até 3,5 m) faz barulho, treme e "acende" o EMF
 * por 6 s mesmo vazio (isca). Numa porta mirada: bate a porta.
 */
export function tryHaunt(world: World, s: MatchState, g: Ghost, intent: Intent): boolean {
  if (s.time < g.hauntReadyAt) return false;
  const origin = g.propId ? propCenter(world.propById.get(g.propId)!) : ghostChest(g);

  if (intent.targetDoorId) {
    const d = world.doorById.get(intent.targetDoorId);
    if (d && Math.hypot(d.centerX - origin.x, d.centerY - origin.y, d.centerZ - origin.z) <= G.hauntRange + 1) {
      s.doorsOpen[d.id] = false;
      g.hauntReadyAt = s.time + G.hauntCooldown;
      s.events.push({ type: "door", doorId: d.id, open: false, slam: true });
      return true;
    }
  }
  if (g.huntMode) return false;

  let p: PropGeom | undefined;
  if (g.propId) p = world.propById.get(g.propId);
  else if (intent.targetPropId) {
    const t = world.propById.get(intent.targetPropId);
    if (t && distanceToProp(t, origin.x, origin.y, origin.z) <= G.hauntRange) p = t;
  }
  if (!p) return false;

  const ps = s.props[p.id];
  ps.decoyUntil = s.time + BALANCE.prop.decoyEmf;
  ps.shakeUntil = s.time + BALANCE.prop.hauntShake;
  // copos em cima do móvel tilintam junto
  for (const other of world.props) if (other.def.onTopOf === p.id) s.props[other.id].shakeUntil = s.time + BALANCE.prop.hauntShake;
  g.hauntReadyAt = s.time + G.hauntCooldown;
  s.events.push({ type: "haunt", ghostId: g.id, propId: p.id, category: p.def.type.category });
  return true;
}

function resolveAttack(world: World, dyn: DynamicWorld, s: MatchState, g: Ghost) {
  const [fx, fz] = forwardOf(g.yaw);
  const cosMax = Math.cos((G.attackAngle * Math.PI) / 180);
  for (const h of s.hunters) {
    if (h.dead) continue;
    const dx = h.x - g.x;
    const dz = h.z - g.z;
    const d = Math.hypot(dx, dz);
    if (d > G.attackRange + H.radius || Math.abs(h.y - g.y) > 1.5) continue;
    if (d > 0.05 && (dx * fx + dz * fz) / d < cosMax) continue;
    // não atravessa parede, porta fechada nem sal
    if (!lineOfSight(world, dyn, g.x, g.y + 1, g.z, h.x, h.y + 1, h.z, true)) continue;
    damageHunter(s, h, G.attackDamage, g);
  }
}

function damageHunter(s: MatchState, h: Hunter, amount: number, g: Ghost) {
  if (h.dead) return;
  h.health -= amount;
  h.lastHurtAt = s.time;
  s.events.push({ type: "hit", hunterId: h.id, ghostId: g.id });
  if (h.health <= 0) {
    h.health = 0;
    h.dead = true;
    h.diedAt = s.time;
    h.canMove = false;
    h.beam = null;
    h.flashlight = false;
    s.events.push({ type: "hunterDown", hunterId: h.id });
  }
}

/** Dano do aspirador. Dentro do móvel, também enche o medidor que expulsa o fantasma em 1,5 s. */
function beamGhost(world: World, dyn: DynamicWorld, s: MatchState, g: Ghost, dt: number) {
  g.lastBeamAt = s.time;
  if (g.propId) {
    damageGhost(s, g, G.beamOnProp * dt);
    if (g.exorcised) return;
    g.expulsion += dt;
    if (g.expulsion >= G.expulsionTime) ejectGhost(world, dyn, s, g, "forced");
  } else {
    const mult = s.time < g.exposedUntil ? G.exposedMultiplier : 1;
    damageGhost(s, g, G.beamEthereal * mult * dt);
  }
}

function damageGhost(s: MatchState, g: Ghost, amount: number) {
  g.health -= amount;
  g.lastDamageAt = s.time;
  if (g.health <= 0) {
    g.health = 0;
    g.exorcised = true;
    g.exorcisedAt = s.time;
    if (g.propId) {
      s.props[g.propId].possessedBy = null;
      g.propId = null;
    }
    s.events.push({ type: "exorcised", ghostId: g.id });
  }
}

// ------------------------------------------------------------------ Caçador

const HUNTER_MOVE = { passDoors: false, blockedBySalt: false };

function stepHunter(world: World, dyn: DynamicWorld, s: MatchState, h: Hunter, intent: Intent | undefined, dt: number) {
  const flee = s.phase === "reversal";
  if (intent) {
    h.yaw = intent.yaw;
    h.pitch = clamp(intent.pitch, -1.45, 1.45);
    h.bodyYaw = h.yaw;
  }

  // movimento + estamina
  let mx = 0;
  let mz = 0;
  if (intent && h.canMove) {
    const [fx, fz] = forwardOf(h.yaw);
    const [rx, rz] = rightOf(h.yaw);
    mx = fx * intent.forward + rx * intent.right;
    mz = fz * intent.forward + rz * intent.right;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
  }
  const moving = Math.hypot(mx, mz) > 0.1;
  h.sprinting = !!intent?.sprint && moving && !h.exhausted && h.stamina > 0 && h.canMove;
  if (h.sprinting) {
    h.stamina = Math.max(0, h.stamina - H.staminaDrain * dt);
    h.lastSprintAt = s.time;
    if (h.stamina <= 0) h.exhausted = true;
  } else if (s.time - h.lastSprintAt >= H.staminaRegenDelay) {
    h.stamina = Math.min(H.maxStamina, h.stamina + H.staminaRegen * dt);
  }
  if (h.exhausted && h.stamina >= H.staminaRecover) h.exhausted = false;

  const speed = h.sprinting ? H.sprint : H.walk;
  const x0 = h.x;
  const z0 = h.z;
  moveBody(world, dyn, h, H.radius, H.height, mx * speed * dt, mz * speed * dt, dt, HUNTER_MOVE);
  h.speed = Math.hypot(h.x - x0, h.z - z0) / dt;

  h.emf = h.canMove ? emfLevel(world, s, h) : 0;

  if (!intent || !h.canMove) {
    h.beam = null;
    h.aiming = false;
    return;
  }

  if (intent.flashlight) h.flashlight = !h.flashlight;
  if (intent.thermal) h.thermal = !h.thermal;
  if (intent.interact) tryToggleDoor(world, s, h, intent.targetDoorId ?? null);
  if (intent.salt) tryPlaceSalt(world, dyn, s, h);

  // Aspirador Ectoplásmico (sem bateria na Caçada Invertida)
  h.aiming = intent.aim || (intent.fire && !flee);
  if (intent.fire && !flee) fireBeam(world, dyn, s, h, dt);
  else h.beam = null;
}

function hunterEye(h: Hunter): Vec3 {
  return { x: h.x, y: h.y + H.eye, z: h.z };
}

function fireBeam(world: World, dyn: DynamicWorld, s: MatchState, h: Hunter, dt: number) {
  const eye = hunterEye(h);
  const [dx, dy, dz] = aimDir(h.yaw, h.pitch);
  const actors: RayActor[] = s.ghosts
    .filter((g) => !g.exorcised && !g.propId)
    .map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z, r: G.radius, h: G.height }));
  const hit = raycast(world, dyn, eye.x, eye.y, eye.z, dx, dy, dz, H.beamRange, { props: true, doors: true, actors });
  const t = hit ? hit.t : H.beamRange;
  h.beam = { x: eye.x + dx * t, y: eye.y + dy * t, z: eye.z + dz * t };
  if (!hit || !hit.id) return;
  if (hit.kind === "actor") {
    const g = s.ghosts.find((x) => x.id === hit.id);
    if (g) beamGhost(world, dyn, s, g, dt);
  } else if (hit.kind === "prop") {
    const gid = s.props[hit.id].possessedBy;
    const g = gid ? s.ghosts.find((x) => x.id === gid) : undefined;
    if (g) beamGhost(world, dyn, s, g, dt);
  }
}

/** Sensor EMF 1–5 pela distância até a superfície do móvel assombrado (ou isca); na Caçada Invertida, também fantasmas. */
export function emfLevel(world: World, s: MatchState, h: Hunter): number {
  const px = h.x;
  const py = h.y + 1;
  const pz = h.z;
  let best = 0;
  const level = (d: number) => (d > H.emfRange ? 0 : clamp(Math.ceil((1 - d / H.emfRange) * 5), 1, 5));
  for (const p of world.props) {
    const ps = s.props[p.id];
    if (!ps.possessedBy && ps.decoyUntil <= s.time) continue;
    best = Math.max(best, level(distanceToProp(p, px, py, pz, H.emfVerticalWeight)));
  }
  if (s.phase === "reversal") {
    for (const g of s.ghosts) {
      if (g.exorcised) continue;
      const d = Math.hypot(g.x - px, (g.y + 0.9 - py) * H.emfVerticalWeight, g.z - pz);
      best = Math.max(best, level(d));
    }
  }
  return best;
}

/** Porta mirada (ou a mais próxima à frente) ao alcance do caçador. */
export function doorInReach(world: World, h: Hunter, preferId: string | null): string | null {
  const eye = hunterEye(h);
  const [fx, fz] = forwardOf(h.yaw);
  const ok = (id: string) => {
    const d = world.doorById.get(id);
    if (!d || d.placement.door.locked) return false;
    const dx = d.centerX - eye.x;
    const dz = d.centerZ - eye.z;
    const dist = Math.hypot(dx, d.centerY - eye.y, dz);
    return dist <= H.interactRange + 0.3 && (Math.hypot(dx, dz) < 0.6 || (dx * fx + dz * fz) / Math.hypot(dx, dz) > 0.2);
  };
  if (preferId && ok(preferId)) return preferId;
  let best: string | null = null;
  let bestD = Infinity;
  for (const d of world.doors) {
    if (!ok(d.id)) continue;
    const dist = Math.hypot(d.centerX - eye.x, d.centerZ - eye.z);
    if (dist < bestD) {
      bestD = dist;
      best = d.id;
    }
  }
  return best;
}

function tryToggleDoor(world: World, s: MatchState, h: Hunter, preferId: string | null) {
  const id = doorInReach(world, h, preferId);
  if (!id) return;
  s.doorsOpen[id] = !s.doorsOpen[id];
  s.events.push({ type: "door", doorId: id, open: s.doorsOpen[id], slam: false });
}

/** Sal Purificador: linha de 1,6 m à frente do caçador que bloqueia fantasmas por 20 s. */
function tryPlaceSalt(world: World, dyn: DynamicWorld, s: MatchState, h: Hunter) {
  if (h.salt <= 0) return;
  const [fx, fz] = forwardOf(h.yaw);
  const hit = raycast(world, dyn, h.x, h.y + 1, h.z, fx, 0, fz, H.saltRange, { props: true, doors: true });
  const d = clamp(hit ? hit.t - 0.3 : 1.5, 0.6, 1.5);
  const x = h.x + fx * d;
  const z = h.z + fz * d;
  const y = groundAt(world, x, z, h.y);
  const id = s.nextId++;
  s.salt.push({ id, x, y, z, yaw: h.yaw, until: s.time + H.saltDuration });
  h.salt--;
  s.events.push({ type: "salt", hunterId: h.id, saltId: id });
}

// ------------------------------------------------------------------ Util

function turnToward(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
