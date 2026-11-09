import * as THREE from "three";
import {
  BALANCE,
  aimDir,
  botIntent,
  buildNav,
  buildWorld,
  canPossess,
  createBotBrain,
  createMatch,
  doorInReach,
  dynamicOf,
  emptyIntent,
  propCenter,
  raycast,
  roomNameAt,
  stepMatch,
  type BotBrain,
  type Ghost,
  type Hunter,
  type Intent,
  type MatchState,
  type NavGraph,
  type Phase,
  type PlayerSlot,
  type Team,
  type World,
} from "@ecos/shared";
import { KEYS, getSettings, subscribeSettings, type Settings } from "../settings";
import { GameAudio } from "./audio";
import { Input } from "./input";
import { MansionView } from "./scene";

/**
 * Uma partida no navegador: simulação do @ecos/shared em passo fixo (30/s), bots, câmera, som e HUD.
 * Na etapa 2 a simulação passa para o servidor e esta classe só manda intenções e desenha snapshots.
 */

const DT = 1 / BALANCE.tickRate;
const LOCAL_ID = "voce";
const HUNTER_BOTS = ["Van Helsing", "Lorraine", "Abraão"];
const GHOST_BOTS = ["Dama de Branco", "Barão Sombrio", "Menina do Poço", "Mordomo"];
const EMF_INTERVALS = [1.0, 0.7, 0.45, 0.28, 0.15];

export interface HudGhost {
  health: number;
  possessing: boolean;
  propName: string;
  roomName: string;
  possessTime: number;
  maxStay: number;
  warning: boolean;
  exposed: boolean;
  expulsion: number;
  jumpCd: number;
  hauntCd: number;
  attackCd: number;
  huntMode: boolean;
  exorcised: boolean;
}

export interface HudHunter {
  health: number;
  stamina: number;
  exhausted: boolean;
  emf: number;
  thermal: boolean;
  flashlight: boolean;
  salt: number;
  dead: boolean;
  hurt: number;
  flee: boolean;
}

export interface HudState {
  phase: Phase;
  hideRemaining: number;
  timeRemaining: number;
  reversalRemaining: number;
  /** 0..1 enquanto a faixa "A CAÇADA SE INVERTEU!" aparece */
  reversalBanner: number;
  aliveGhosts: number;
  totalGhosts: number;
  aliveHunters: number;
  totalHunters: number;
  started: boolean;
  locked: boolean;
  team: Team;
  ghost?: HudGhost;
  hunter?: HudHunter;
  prompt: string | null;
  room: string;
}

export interface MatchResult {
  winner: Team;
  reason: string;
  ghostsAlive: number;
  ghostsTotal: number;
  huntersAlive: number;
  huntersTotal: number;
  duration: number;
  team: Team;
  won: boolean;
  fate: string;
}

export interface SessionCallbacks {
  onHud(h: HudState): void;
  onPause(paused: boolean): void;
  onEnd(r: MatchResult): void;
  onLoaded(): void;
}

let worldCache: { world: World; nav: NavGraph } | null = null;
function getWorld() {
  if (!worldCache) {
    const world = buildWorld();
    worldCache = { world, nav: buildNav(world) };
  }
  return worldCache;
}

export class GameSession {
  private world: World;
  private nav: NavGraph;
  private state!: MatchState;
  private brains: BotBrain[] = [];
  private team: Team;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(75, 1, 0.05, 120);
  private view: MansionView;
  private input: Input;
  private audio = new GameAudio();
  private flashlight = new THREE.SpotLight(0xfff1d6, 12, 22, 0.46, 0.55, 1.3);
  private remoteLights = new Map<string, THREE.SpotLight>();
  private weapon = new THREE.Group();
  private yaw = 0;
  private pitch = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private started = false;
  private paused = false;
  private disposed = false;
  private hadLock = false;
  private endedAt = -1;
  private resultSent = false;
  private prev = new Map<string, { x: number; y: number; z: number }>();
  private target: { propId: string | null; doorId: string | null } = { propId: null, doorId: null };
  private prompt: string | null = null;
  private camDist = 3.5;
  private nextBeep = 0;
  private reversalShownAt = -1;
  private hudAt = 0;
  private bob = 0;
  private unsubSettings: () => void;
  private resizeObs: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly cb: SessionCallbacks,
  ) {
    const { world, nav } = getWorld();
    this.world = world;
    this.nav = nav;
    const st = getSettings();
    this.team = st.team;

    const shadows = st.quality === "alta";
    this.renderer = new THREE.WebGLRenderer({ antialias: st.quality !== "baixa", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(st.quality === "baixa" ? 0.75 : st.quality === "media" ? Math.min(1.25, devicePixelRatio) : Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    // luzes reais de luar e de velas por qualidade (cada uma custa caro por pixel em GPU integrada)
    const budget = st.quality === "baixa" ? { moon: 2, candles: 1 } : st.quality === "media" ? { moon: 3, candles: 2 } : { moon: 5, candles: 4 };
    this.view = new MansionView(world, shadows, budget);
    this.view.scene.add(this.camera);
    this.camera.add(this.audio.listener);

    // lanterna e bocal do aspirador presos à câmera (1ª pessoa)
    this.flashlight.position.set(0.18, -0.12, 0);
    this.flashlight.target.position.set(0.1, -0.05, -1);
    this.flashlight.castShadow = shadows;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.camera.add(this.flashlight, this.flashlight.target);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.5, roughness: 0.55 });
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, 0.3, 10), metal);
    nozzle.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 14), new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x5fe8ff, emissiveIntensity: 2 }));
    ring.position.z = -0.15;
    this.weapon.add(nozzle, ring);
    this.weapon.position.set(0.24, -0.25, -0.42);
    this.weapon.rotation.set(0.12, 0.18, 0); // aponta para a mira
    this.camera.add(this.weapon);

    this.input = new Input(this.renderer.domElement);
    this.input.onPointerLockChange = (locked) => this.lockChanged(locked);
    this.input.onPauseKey = () => (this.paused ? this.resume() : this.pause());
    window.addEventListener("blur", this.onBlur);

    this.applySettings(st);
    this.unsubSettings = subscribeSettings((s) => this.applySettings(s));
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  async start() {
    const st = getSettings();
    const slots: PlayerSlot[] = [];
    const nH = Math.max(this.team === "hunter" ? 1 : 0, Math.min(2, st.hunters));
    const nG = Math.max(this.team === "ghost" ? 1 : 0, Math.min(4, st.ghosts));
    for (let i = 0; i < nH; i++) {
      const me = this.team === "hunter" && i === 0;
      slots.push({ id: me ? LOCAL_ID : `h${i}`, name: me ? st.name : HUNTER_BOTS[i % HUNTER_BOTS.length], team: "hunter", bot: !me });
    }
    for (let i = 0; i < nG; i++) {
      const me = this.team === "ghost" && i === 0;
      slots.push({ id: me ? LOCAL_ID : `g${i}`, name: me ? st.name : GHOST_BOTS[i % GHOST_BOTS.length], team: "ghost", bot: !me });
    }
    this.state = createMatch(this.world, slots, { roundSeconds: st.roundMinutes * 60, reversal: st.reversal });
    const seed = (Date.now() & 0xffff) + 1;
    this.brains = slots.filter((p) => p.bot).map((p, i) => createBotBrain(p.id, seed * 31 + i));
    const me = this.local();
    this.yaw = me.yaw;
    this.pitch = this.team === "ghost" ? -0.25 : 0;
    for (const a of [...this.state.ghosts, ...this.state.hunters]) this.prev.set(a.id, { x: a.x, y: a.y, z: a.z });

    this.view.syncActors(this.state);
    await Promise.all([this.audio.load(), this.view.loadProps(null, getSettings().quality === "alta")]);
    if (this.disposed) return;
    for (const h of this.state.hunters) {
      if (h.id === LOCAL_ID) continue;
      const l = new THREE.SpotLight(0xfff1d6, 10, 18, 0.45, 0.55, 1.3);
      this.view.scene.add(l, l.target);
      this.remoteLights.set(h.id, l);
    }
    this.cb.onLoaded();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Estado da partida (depuração em modo dev, via window.__ecos). */
  get debugState(): MatchState {
    return this.state;
  }

  /** Primeiro clique: prende o mouse e começa a partida (o tempo não corre antes). */
  requestLock() {
    this.input.requestLock();
  }

  pause() {
    if (this.paused || !this.started || this.endedAt >= 0) return;
    this.paused = true;
    this.input.releaseLock();
    this.audio.suspend();
    this.cb.onPause(true);
  }

  /** Chamado por clique (gesto do usuário), então pode prender o mouse de novo. */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.hadLock = false;
    this.audio.resume();
    this.input.requestLock();
    this.last = performance.now();
    this.cb.onPause(false);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("blur", this.onBlur);
    this.unsubSettings();
    this.resizeObs.disconnect();
    this.input.dispose();
    this.audio.dispose();
    this.view.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ Laço

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    if (this.started && !this.paused) {
      this.applyMouse();
      if (this.endedAt < 0) {
        this.acc += dt;
        while (this.acc >= DT) {
          this.stepOnce();
          this.acc -= DT;
        }
      }
    }
    const alpha = this.endedAt >= 0 ? 1 : this.acc / DT;
    this.updateCamera(alpha, dt);
    this.updateTarget();
    const me = this.local();
    this.view.update(this.state, {
      dt,
      pos: (id) => this.lerpPos(id, alpha),
      localId: LOCAL_ID,
      thermal: me.team === "hunter" && me.thermal,
      firstPerson: this.team === "hunter",
      localBeamOrigin: this.weaponTip(),
      eye: this.camera.position,
    });
    this.updateLights(alpha);
    this.renderer.render(this.view.scene, this.camera);
    this.emfBeeps(now / 1000);

    if (this.endedAt >= 0 && !this.resultSent && now - this.endedAt > 1600) {
      this.resultSent = true;
      this.input.releaseLock();
      this.cb.onEnd(this.result());
    }
    // antes do primeiro clique nada muda: manda a HUD uma vez só (e de novo ao começar)
    const idle = !this.started && this.hudAt > 0;
    if (!idle && now - this.hudAt > 50) {
      this.hudAt = now;
      this.cb.onHud(this.hud(now));
    }
  };

  private stepOnce() {
    const s = this.state;
    for (const a of [...s.ghosts, ...s.hunters]) this.prev.set(a.id, { x: a.x, y: a.y, z: a.z });
    const intents: Record<string, Intent> = { [LOCAL_ID]: this.localIntent() };
    for (const b of this.brains) intents[b.id] = botIntent(this.world, this.nav, s, b);
    stepMatch(this.world, s, intents, DT);
    this.handleEvents();
    if (s.phase === "ended" && this.endedAt < 0) this.endedAt = performance.now();
  }

  private localIntent(): Intent {
    const k = this.input;
    const it = emptyIntent(this.yaw, this.pitch);
    if (!k.pointerLocked) return it;
    it.forward = k.axis(KEYS.back, KEYS.forward);
    it.right = k.axis(KEYS.left, KEYS.right);
    it.sprint = k.down.has(KEYS.sprint) || k.down.has("ShiftRight");
    it.fire = k.fire;
    it.aim = k.aim;
    it.interact = k.take(KEYS.interact);
    it.eject = k.take(KEYS.eject);
    it.jump = k.take(KEYS.jump);
    it.haunt = k.take(KEYS.haunt);
    it.flashlight = k.take(KEYS.flashlight);
    it.thermal = k.take(KEYS.thermal);
    it.salt = k.take(KEYS.salt);
    it.targetPropId = this.target.propId;
    it.targetDoorId = this.target.doorId;
    return it;
  }

  private applyMouse() {
    const st = getSettings();
    const [dx, dy] = this.input.takeMouse();
    const sens = 0.0022 * st.sensitivity;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * (st.invertY ? -1 : 1);
    this.pitch = this.team === "hunter" ? THREE.MathUtils.clamp(this.pitch, -1.45, 1.45) : THREE.MathUtils.clamp(this.pitch, -1.1, 0.55);
  }

  // ------------------------------------------------------------------ Câmera e mira

  private local(): Ghost | Hunter {
    return (this.state.ghosts.find((g) => g.id === LOCAL_ID) ?? this.state.hunters.find((h) => h.id === LOCAL_ID))!;
  }

  private lerpPos(id: string, alpha: number) {
    const a = this.state.ghosts.find((g) => g.id === id) ?? this.state.hunters.find((h) => h.id === id);
    const p = this.prev.get(id);
    if (!a) return { x: 0, y: 0, z: 0 };
    // teleporte (possessão, salto, saída do móvel): sem interpolar
    if (!p || Math.hypot(a.x - p.x, a.z - p.z) > 1.5) return { x: a.x, y: a.y, z: a.z };
    return { x: p.x + (a.x - p.x) * alpha, y: p.y + (a.y - p.y) * alpha, z: p.z + (a.z - p.z) * alpha };
  }

  private updateCamera(alpha: number, dt: number) {
    const me = this.local();
    const p = this.lerpPos(LOCAL_ID, alpha);
    this.camera.rotation.order = "YXZ";

    if (me.team === "hunter") {
      this.weapon.visible = !me.dead;
      if (me.dead) {
        // câmera cai de lado até o chão
        const k = Math.min(1, (this.state.time - me.diedAt) / 0.9);
        this.camera.position.set(p.x, p.y + THREE.MathUtils.lerp(BALANCE.hunter.eye, 0.3, k), p.z);
        this.camera.rotation.set(this.pitch - 0.4 * k, this.yaw + Math.PI, 1.3 * k);
        return;
      }
      this.bob += me.speed * dt * 2.6;
      const bob = me.grounded && me.speed > 0.5 ? Math.sin(this.bob) * 0.035 : 0;
      this.camera.position.set(p.x, p.y + BALANCE.hunter.eye + bob, p.z);
      this.camera.rotation.set(this.pitch, this.yaw + Math.PI, 0);
      const fov = me.aiming ? BALANCE.hunter.fovAim : BALANCE.hunter.fovNormal;
      if (Math.abs(this.camera.fov - fov) > 0.1) {
        this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10);
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    // fantasma: 3ª pessoa orbitando a forma etérea ou o móvel possuído, com recuo na parede
    this.weapon.visible = false;
    const prop = me.propId ? this.world.propById.get(me.propId) : undefined;
    const focus = prop ? propCenter(prop) : { x: p.x, y: p.y + 1.2, z: p.z };
    const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    const wanted = prop ? 4.5 : 3.5;
    const hit = raycast(this.world, dynamicOf(this.state), focus.x, focus.y, focus.z, -dx, -dy, -dz, wanted, { doors: false });
    const allowed = hit ? Math.max(0.3, hit.t - 0.2) : wanted;
    this.camDist = allowed < this.camDist ? allowed : this.camDist + (allowed - this.camDist) * Math.min(1, dt * 4);
    this.camera.position.set(focus.x - dx * this.camDist, focus.y - dy * this.camDist, focus.z - dz * this.camDist);
    this.camera.rotation.set(this.pitch, this.yaw + Math.PI, 0);
    if (Math.abs(this.camera.fov - 70) > 0.1) {
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
    }
  }

  private weaponTip(): THREE.Vector3 | null {
    if (this.team !== "hunter") return null;
    this.camera.updateMatrixWorld();
    return new THREE.Vector3(0.21, -0.23, -0.58).applyMatrix4(this.camera.matrixWorld);
  }

  /** O que está na mira: móvel (possuir/saltar/assombrar) ou porta (abrir/bater). */
  private updateTarget() {
    const s = this.state;
    const me = this.local();
    this.target = { propId: null, doorId: null };
    this.prompt = null;
    if (!this.started || s.phase === "ended") return;

    if (me.team === "hunter") {
      if (me.dead || !me.canMove) return;
      const door = doorInReach(this.world, me, null);
      this.target.doorId = door;
      if (door) this.prompt = s.doorsOpen[door] ? "[E] Fechar porta" : "[E] Abrir porta";
      return;
    }

    if (me.exorcised) return;
    const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    const cam = this.camera.position;
    const hit = raycast(this.world, dynamicOf(s), cam.x, cam.y, cam.z, dx, dy, dz, 10, { props: true, doors: true, ignorePropId: me.propId ?? undefined });
    if (hit?.kind === "prop" && hit.id) this.target.propId = hit.id;
    this.target.doorId = this.doorInView(me, cam, dx, dz);

    const name = (id: string) => this.world.propById.get(id)?.def.type.name ?? "";
    if (me.huntMode) {
      this.prompt = this.target.doorId ? "[Botão esq.] Toque Gélido  ·  [R] Bater porta" : "[Botão esq.] Toque Gélido";
    } else if (me.propId) {
      const t = this.target.propId;
      const from = propCenter(this.world.propById.get(me.propId)!);
      const tp = t ? this.world.propById.get(t) : undefined;
      const okJump = !!tp && !s.props[tp.id].possessedBy && dist3(propCenter(tp), from) <= BALANCE.ghost.jumpRange;
      this.prompt = okJump ? `[Q] Saltar para ${name(t!)}  ·  [E] Sair` : "[E] Sair do móvel  ·  [Q] Salto  ·  [R] Assombrar";
    } else if (this.target.propId && canPossess(this.world, s, me, this.target.propId)) {
      this.prompt = `[E] Possuir ${name(this.target.propId)}`;
    } else if (this.target.doorId) {
      this.prompt = "[R] Bater porta";
    }
  }

  private doorInView(g: Ghost, cam: THREE.Vector3, dx: number, dz: number): string | null {
    let best: string | null = null;
    let bestScore = 0.93;
    const origin = g.propId ? propCenter(this.world.propById.get(g.propId)!) : { x: g.x, y: g.y + 0.9, z: g.z };
    for (const d of this.world.doors) {
      if (dist3({ x: d.centerX, y: d.centerY, z: d.centerZ }, origin) > BALANCE.ghost.hauntRange + 1) continue;
      const vx = d.centerX - cam.x;
      const vz = d.centerZ - cam.z;
      const score = (vx * dx + vz * dz) / (Math.hypot(vx, vz) * Math.hypot(dx, dz) || 1);
      if (score > bestScore) {
        bestScore = score;
        best = d.id;
      }
    }
    return best;
  }

  private updateLights(alpha: number) {
    const me = this.local();
    this.flashlight.visible = me.team === "hunter" && me.flashlight && !me.dead;
    for (const [id, l] of this.remoteLights) {
      const h = this.state.hunters.find((x) => x.id === id)!;
      l.visible = h.flashlight && !h.dead;
      const p = this.lerpPos(id, alpha);
      const [dx, dy, dz] = aimDir(h.yaw, h.pitch);
      l.position.set(p.x, p.y + 1.5, p.z);
      l.target.position.set(p.x + dx, p.y + 1.5 + dy, p.z + dz);
    }
  }

  // ------------------------------------------------------------------ Som e eventos

  private handleEvents() {
    const s = this.state;
    const sc = this.view.scene;
    const actor = (id: string) => s.ghosts.find((g) => g.id === id) ?? s.hunters.find((h) => h.id === id);
    for (const e of s.events) {
      switch (e.type) {
        case "phase":
          if (e.phase === "reversal") {
            this.audio.play2D("reversal", 0.9);
            this.audio.setAmbientPitch(0.85);
            this.reversalShownAt = performance.now();
          }
          break;
        case "warning":
          if (e.ghostId === LOCAL_ID) this.audio.play2D("warning", 0.8);
          break;
        case "eject": {
          if (!e.forced) break;
          const g = actor(e.ghostId)!;
          this.audio.playAt(sc, "eject", g.x, g.y + 1, g.z, 1, 22);
          break;
        }
        case "haunt": {
          const p = this.world.propById.get(e.propId)!;
          const c = propCenter(p);
          const snd = e.category === "louca" ? "glass" : e.category === "planta" ? "plant" : "haunt";
          this.audio.playAt(sc, snd, c.x, c.y, c.z, 1, 20);
          if (e.category === "iluminacao") this.view.flicker(p.id, s.time + 1.2);
          for (const o of this.world.props) if (o.def.onTopOf === p.id) this.audio.playAt(sc, "glass", o.x, o.y, o.z, 0.7, 16);
          break;
        }
        case "door": {
          const d = this.world.doorById.get(e.doorId)!;
          this.audio.playAt(sc, e.slam ? "slam" : "creak", d.centerX, d.centerY, d.centerZ, e.slam ? 1 : 0.7, e.slam ? 26 : 14);
          break;
        }
        case "exorcised": {
          const g = actor(e.ghostId)!;
          this.audio.playAt(sc, "eject", g.x, g.y + 1, g.z, 1, 22);
          break;
        }
        case "attack": {
          const g = actor(e.ghostId)!;
          this.audio.playAt(sc, "attack", g.x, g.y + 1, g.z, 1, 16);
          break;
        }
        case "hit": {
          const h = actor(e.hunterId)!;
          this.audio.playAt(sc, "hurt", h.x, h.y + 1.5, h.z, 1, 18);
          break;
        }
        default:
          break;
      }
    }
  }

  private emfBeeps(now: number) {
    const me = this.local();
    if (me.team !== "hunter" || this.paused || !this.started || me.emf <= 0 || me.dead) return;
    if (now < this.nextBeep) return;
    this.audio.play2D("emf", 0.55, 0.9 + 0.08 * me.emf);
    this.nextBeep = now + EMF_INTERVALS[Math.min(4, me.emf - 1)];
  }

  // ------------------------------------------------------------------ Pausa / foco

  private lockChanged(locked: boolean) {
    if (locked) {
      this.hadLock = true;
      if (!this.started) {
        this.started = true;
        this.audio.resume();
        this.audio.startAmbient();
        this.last = performance.now();
      }
      this.cb.onHud(this.hud(performance.now()));
      return;
    }
    // no navegador o Esc solta o mouse sem chegar ao jogo: mouse solto no meio da partida = pausa
    if (this.hadLock && this.started && !this.paused && this.endedAt < 0) this.pause();
  }

  private onBlur = () => {
    if (this.started && !this.paused && this.endedAt < 0) this.pause();
  };

  private applySettings(s: Settings) {
    this.audio.setVolumes(s.masterVolume, s.ambientVolume);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ HUD / resultado

  private hud(now: number): HudState {
    const s = this.state;
    const me = this.local();
    const since = this.reversalShownAt < 0 ? Infinity : (now - this.reversalShownAt) / 1000;
    const base: HudState = {
      phase: s.phase,
      hideRemaining: s.hideRemaining,
      timeRemaining: s.timeRemaining,
      reversalRemaining: s.reversalRemaining,
      reversalBanner: since < 4 ? Math.min(1, 4 - since) : 0,
      aliveGhosts: s.ghosts.filter((g) => !g.exorcised).length,
      totalGhosts: s.ghosts.length,
      aliveHunters: s.hunters.filter((h) => !h.dead).length,
      totalHunters: s.hunters.length,
      started: this.started,
      locked: this.input.pointerLocked,
      team: this.team,
      prompt: this.prompt,
      room: roomNameAt(this.world, me.x, me.y + 0.1, me.z) ?? "",
    };
    if (me.team === "ghost") {
      const prop = me.propId ? this.world.propById.get(me.propId) : undefined;
      base.ghost = {
        health: me.health / BALANCE.ghost.maxHealth,
        possessing: !!prop,
        propName: prop?.def.type.name ?? "",
        roomName: prop?.def.room ?? "",
        possessTime: me.possessTime,
        maxStay: BALANCE.ghost.maxStay,
        warning: !!prop && me.possessTime >= BALANCE.ghost.warning,
        exposed: s.time < me.exposedUntil,
        expulsion: me.expulsion / BALANCE.ghost.expulsionTime,
        jumpCd: Math.max(0, me.jumpReadyAt - s.time),
        hauntCd: Math.max(0, me.hauntReadyAt - s.time),
        attackCd: Math.max(0, me.attackReadyAt - s.time),
        huntMode: me.huntMode,
        exorcised: me.exorcised,
      };
    } else {
      base.hunter = {
        health: me.health / BALANCE.hunter.maxHealth,
        stamina: me.stamina / BALANCE.hunter.maxStamina,
        exhausted: me.exhausted,
        emf: me.emf,
        thermal: me.thermal,
        flashlight: me.flashlight,
        salt: me.salt,
        dead: me.dead,
        hurt: Math.max(0, 1 - (s.time - me.lastHurtAt) / 0.6),
        flee: s.phase === "reversal",
      };
    }
    return base;
  }

  private result(): MatchResult {
    const s = this.state;
    const me = this.local();
    const winner = s.winner ?? "hunter";
    return {
      winner,
      reason: s.winReason,
      ghostsAlive: s.ghosts.filter((g) => !g.exorcised).length,
      ghostsTotal: s.ghosts.length,
      huntersAlive: s.hunters.filter((h) => !h.dead).length,
      huntersTotal: s.hunters.length,
      duration: s.endedAt,
      team: this.team,
      won: winner === this.team,
      fate: me.team === "ghost" ? (me.exorcised ? "Exorcizado" : "Escapou") : me.dead ? "Pego pelos fantasmas" : "Sobreviveu",
    };
  }
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
