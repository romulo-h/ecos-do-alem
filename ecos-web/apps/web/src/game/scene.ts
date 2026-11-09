import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import {
  BALANCE,
  buildCandelabras,
  buildWindows,
  subtractRect,
  type Box3,
  type CandelabraDef,
  type MatchState,
  type Rect2,
  type WindowDef,
  type World,
} from "@ecos/shared";
import { GhostFigure, HunterFigure } from "./actors";
import type { GameAudio } from "./audio";

/**
 * Cena Three.js da mansão. A geometria vem do mesmo World que a simulação usa para colidir,
 * então o que se vê é exatamente o que bloqueia.
 */

export interface RenderInfo {
  dt: number; // tempo real do quadro
  pos: (id: string) => { x: number; y: number; z: number };
  localId: string;
  thermal: boolean;
  /** caçador local em 1ª pessoa: esconde o próprio corpo e tira o feixe da câmera */
  firstPerson: boolean;
  localBeamOrigin: THREE.Vector3 | null;
  /** posição da câmera: escolhe quais janelas recebem as luzes de lua */
  eye: THREE.Vector3;
}

const COLORS = {
  floor: 0x4a3426,
  ceiling: 0x241c17,
  wallInterior: 0x5d4a3e,
  wallExterior: 0x2e2a31,
  rail: 0x5a3d27,
  stairs: 0x553b28,
  solid: 0x3b2c22,
  roof: 0x1d1a1f,
  frame: 0x3a281b,
};

/** Luar que entra pelas janelas. */
const MOON = {
  color: 0xa9bfff,
  intensity: 16,
  distance: 10,
  /** elevação mínima do feixe; sobe quando o cômodo é raso, para o feixe não atravessar a parede oposta */
  minElevation: (36 * Math.PI) / 180,
};

/** Velas dos candelabros. */
const CANDLE = {
  color: 0xffb067,
  intensity: 10,
  distance: 8,
};

/** Quantas luzes reais cada efeito usa (o resto dos pontos fica só com o brilho desenhado). */
export interface LightBudget {
  moon: number;
  candles: number;
}

interface PoolPoint {
  /** de onde a luz sai */
  pos: THREE.Vector3;
  /** para onde aponta (spot) e onde se mede a distância à câmera */
  target: THREE.Vector3;
}

/**
 * Número fixo de luzes que segue os pontos mais perto da câmera. Luz por pixel é cara em GPU integrada (33
 * luzes derrubavam o jogo para 15 FPS), e mudar a quantidade de luzes obriga o Three.js a recompilar os
 * shaders, então o grupo nunca cresce: só muda de lugar. Cada luz apaga aos poucos conforme o ponto dela se
 * aproxima da distância do primeiro ponto que ficou de fora; a troca acontece com a luz já apagada.
 */
class LightPool<L extends THREE.PointLight | THREE.SpotLight> {
  constructor(
    readonly lights: L[],
    readonly points: PoolPoint[],
    private readonly base: number,
  ) {}

  update(eye: THREE.Vector3, gain: (i: number) => number = () => 1) {
    const n = this.lights.length;
    if (!n) return;
    const ranked = this.points.map((p) => ({ p, d: p.target.distanceTo(eye) })).sort((a, b) => a.d - b.d);
    const cutoff = ranked[n]?.d ?? Infinity;
    for (let i = 0; i < n; i++) {
      const light = this.lights[i];
      const r = ranked[i];
      if (!r) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(r.p.pos);
      if (light instanceof THREE.SpotLight) {
        light.target.position.copy(r.p.target);
        light.target.updateMatrixWorld();
      }
      light.intensity = this.base * gain(i) * THREE.MathUtils.clamp((cutoff - r.d) / 1.5, 0, 1);
    }
  }
}

type Part = keyof typeof COLORS;

/** Textura de brilho radial (centro claro, borda transparente) para os halos das velas. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class MansionView {
  readonly scene = new THREE.Scene();
  private propNodes = new Map<string, { node: THREE.Object3D; base: THREE.Vector3; baseRot: number; still: boolean }>();
  private lampLights = new Map<string, { light: THREE.PointLight; base: number }>();
  private flickerUntil = new Map<string, number>();
  private doors: { id: string; hinges: { obj: THREE.Object3D; sign: number }[]; angle: number }[] = [];
  private saltMeshes = new Map<number, THREE.Object3D>();
  private footprints: THREE.InstancedMesh;
  private hunterFigs = new Map<string, HunterFigure>();
  private ghostFigs = new Map<string, GhostFigure>();
  private beams = new Map<string, THREE.Mesh>();
  private saltGeo = new THREE.BoxGeometry(BALANCE.hunter.saltWidth, 0.04, 0.32);
  private saltWallGeo = new THREE.PlaneGeometry(BALANCE.hunter.saltWidth, BALANCE.hunter.saltHeight);
  private saltMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 1 });
  private saltWallMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  private beamMat = new THREE.MeshBasicMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  private beamGeo = new THREE.CylinderGeometry(0.025, 0.04, 1, 8, 1, true);
  private tmp = new THREE.Object3D();

  /** onde cada janela joga o luar e onde fica cada candelabro (preenchidos ao montar a cena) */
  private moonPoints: PoolPoint[] = [];
  private candlePoints: PoolPoint[] = [];
  private moon: LightPool<THREE.SpotLight>;
  private candles: LightPool<THREE.PointLight>;
  /** brilho em volta das chamas: um por candelabro, tremula sem custar luz */
  private halos: THREE.Sprite[] = [];
  /** clarão na parede atrás de cada candelabro (material único: tremula tudo junto) */
  private washGeo = new THREE.PlaneGeometry(2.0, 2.0);
  private washMat = new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  /** @param budget quantas luzes reais o luar e as velas usam (ver LightPool) */
  constructor(private readonly world: World, shadows: boolean, budget: LightBudget = { moon: 3, candles: 2 }) {
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.03);
    this.scene.add(new THREE.HemisphereLight(0x6f7d99, 0x20160f, 0.55));
    this.buildStatic(shadows);

    const spots = Array.from({ length: budget.moon }, () => {
      const s = new THREE.SpotLight(MOON.color, 0, MOON.distance, 0.62, 0.75, 1.4);
      this.scene.add(s, s.target);
      return s;
    });
    this.moon = new LightPool(spots, this.moonPoints, MOON.intensity);
    const points = Array.from({ length: budget.candles }, () => {
      const p = new THREE.PointLight(CANDLE.color, 0, CANDLE.distance, 1.6);
      this.scene.add(p);
      return p;
    });
    this.candles = new LightPool(points, this.candlePoints, CANDLE.intensity);
    this.buildDoors();

    const fpGeo = new THREE.PlaneGeometry(0.11, 0.24);
    fpGeo.rotateX(-Math.PI / 2);
    const fpMat = new THREE.MeshBasicMaterial({ color: 0x6ff8ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.footprints = new THREE.InstancedMesh(fpGeo, fpMat, 600);
    this.footprints.count = 0;
    this.footprints.frustumCulled = false;
    this.scene.add(this.footprints);
  }

  // ------------------------------------------------------------------ Estático

  private buildStatic(shadows: boolean) {
    const w = this.world;
    const groups = {} as Record<Part, THREE.BufferGeometry[]>;
    for (const k of Object.keys(COLORS) as Part[]) groups[k] = [];
    const box = (b: Box3, key: Part) => {
      const g = new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      groups[key].push(g);
    };

    for (const s of w.slabs) box(s, s.maxY > 0.1 ? "ceiling" : "floor");
    // tampo do piso de cima com cor de madeira (embaixo fica a cor de forro)
    for (const s of w.slabs) if (s.maxY > 0.1) box({ ...s, minY: s.maxY - 0.01, maxY: s.maxY + 0.002 }, "floor");
    // paredes; nas externas com janela, o vão é recortado (a física continua com a parede inteira: é vidro)
    const windows = buildWindows(w);
    const byWall = new Map<number, WindowDef[]>();
    for (const win of windows) byWall.set(win.wall, [...(byWall.get(win.wall) ?? []), win]);
    w.walls.forEach((wall, i) => {
      const key: Part = wall.kind === "exterior" ? "wallExterior" : wall.kind === "railing" ? "rail" : "wallInterior";
      const wins = byWall.get(i);
      if (!wins) return box(wall, key);
      const alongZ = wins[0].alongZ;
      const seg = (a: number, b: number, y0: number, y1: number) => {
        if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
        box(alongZ ? { ...wall, minZ: a, maxZ: b, minY: y0, maxY: y1 } : { ...wall, minX: a, maxX: b, minY: y0, maxY: y1 }, key);
      };
      let cur = alongZ ? wall.minZ : wall.minX;
      for (const win of [...wins].sort((a, b) => a.center - b.center)) {
        const a = win.center - win.width / 2;
        const b = win.center + win.width / 2;
        seg(cur, a, wall.minY, wall.maxY);
        seg(a, b, wall.minY, win.sill);
        seg(a, b, win.top, wall.maxY);
        cur = b;
      }
      seg(cur, alongZ ? wall.maxZ : wall.maxX, wall.minY, wall.maxY);
    });
    this.buildWindowDressing(windows, (b) => box(b, "frame"));
    this.buildCandelabraModels(buildCandelabras(w, windows), shadows);
    for (const s of w.solids) box(s, "solid");

    // escadas: degraus maciços (a física usa a rampa)
    for (const r of w.ramps) {
      const alongZ = r.ascend.endsWith("z");
      const positive = r.ascend.startsWith("+");
      const lo = alongZ ? r.minZ : r.minX;
      const hi = alongZ ? r.maxZ : r.maxX;
      const rise = r.h1 - r.h0;
      const steps = Math.max(1, Math.ceil(rise / 0.2));
      const tread = (hi - lo) / steps;
      for (let i = 0; i < steps; i++) {
        const top = r.h0 + ((i + 1) * rise) / steps;
        const a0 = positive ? lo + i * tread : lo;
        const a1 = positive ? hi : hi - i * tread;
        box(alongZ ? { minX: r.minX, maxX: r.maxX, minZ: a0, maxZ: a1, minY: r.h0, maxY: top } : { minX: a0, maxX: a1, minZ: r.minZ, maxZ: r.maxZ, minY: r.h0, maxY: top }, "stairs");
      }
    }

    // telhado sobre o último andar e forro do térreo onde não há cômodo em cima (só visual)
    const fh = w.data.floorHeight;
    const topFloor = Math.max(...w.data.rooms.map((r) => r.floor));
    for (const room of w.data.rooms) {
      if (room.floor !== topFloor || room.outdoor) continue;
      const y = (topFloor + 1) * fh;
      box({ minX: room.minX - 0.08, maxX: room.maxX + 0.08, minZ: room.minZ - 0.08, maxZ: room.maxZ + 0.08, minY: y, maxY: y + 0.25 }, "roof");
    }
    const upstairs = w.data.rooms.filter((r) => r.floor === 1);
    for (const room of w.data.rooms) {
      if (room.floor !== 0 || room.outdoor) continue;
      let pieces: Rect2[] = [room];
      for (const c of upstairs) pieces = pieces.flatMap((p) => subtractRect(p, c));
      for (const p of pieces) box({ ...p, minY: fh - 0.2, maxY: fh }, "roof");
    }

    // terreno em volta
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: 0x131a12, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.21;
    ground.receiveShadow = shadows;
    this.scene.add(ground);

    for (const key of Object.keys(groups) as Part[]) {
      const list = groups[key];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: COLORS[key], roughness: 0.9 }));
      m.castShadow = shadows && key !== "floor" && key !== "roof";
      m.receiveShadow = shadows;
      this.scene.add(m);
    }
  }

  /**
   * Moldura com cruzeta, vidro azulado, feixe de luar até o chão, o desenho da janela projetado no piso e
   * uma luz de lua (spot sem sombra) entrando por ela.
   */
  private buildWindowDressing(windows: WindowDef[], frameBox: (b: Box3) => void) {
    const t = this.world.data.wallThickness;
    const fh = this.world.data.floorHeight;
    const glass: THREE.BufferGeometry[] = [];
    const shaftPos: number[] = [];
    const shaftCol: number[] = [];
    const patchPos: number[] = [];

    for (const win of windows) {
      const { alongZ, line, outward } = win;
      const a0 = win.center - win.width / 2;
      const a1 = win.center + win.width / 2;
      const bottom = win.floor * fh;
      // ponto em coordenadas da janela: a = ao longo da parede, off = deslocamento perpendicular
      const P = (a: number, y: number, off: number) => (alongZ ? new THREE.Vector3(line + off, y, a) : new THREE.Vector3(a, y, line + off));
      const slab = (a: number, b: number, y0: number, y1: number, d: number) => {
        const p = P(a, y0, -d / 2);
        const q = P(b, y1, d / 2);
        frameBox({ minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minY: y0, maxY: y1, minZ: Math.min(p.z, q.z), maxZ: Math.max(p.z, q.z) });
      };

      // moldura, cruzeta e peitoril
      const f = 0.06;
      const deep = t + 0.04;
      slab(a0, a0 + f, win.sill, win.top, deep);
      slab(a1 - f, a1, win.sill, win.top, deep);
      slab(a0, a1, win.top - f, win.top, deep);
      slab(a0, a1, win.sill, win.sill + f, deep);
      const midY = win.sill + (win.top - win.sill) * 0.55;
      slab(win.center - 0.02, win.center + 0.02, win.sill, win.top, 0.05);
      slab(a0, a1, midY - 0.02, midY + 0.02, 0.05);
      const ledge = P(0, 0, -outward * (t / 2 + 0.06)); // peitoril saliente para dentro
      frameBox(
        alongZ
          ? { minX: Math.min(line, ledge.x), maxX: Math.max(line, ledge.x), minY: win.sill - 0.05, maxY: win.sill, minZ: a0 - 0.08, maxZ: a1 + 0.08 }
          : { minX: a0 - 0.08, maxX: a1 + 0.08, minY: win.sill - 0.05, maxY: win.sill, minZ: Math.min(line, ledge.z), maxZ: Math.max(line, ledge.z) },
      );

      // vidro
      const g = alongZ ? new THREE.BoxGeometry(0.02, win.top - win.sill, win.width) : new THREE.BoxGeometry(win.width, win.top - win.sill, 0.02);
      const c = P(win.center, (win.sill + win.top) / 2, 0);
      g.translate(c.x, c.y, c.z);
      glass.push(g);

      // direção do luar: para dentro e para baixo; cômodo raso pede feixe mais íngreme
      const reach = Math.max(0.6, win.depth - t / 2 - 0.3);
      const el = Math.max(MOON.minElevation, Math.atan((win.top - bottom) / reach));
      const dir = alongZ ? new THREE.Vector3(-outward * Math.cos(el), -Math.sin(el), 0) : new THREE.Vector3(0, -Math.sin(el), -outward * Math.cos(el));
      const inner = -outward * (t / 2);
      const toFloor = (p: THREE.Vector3) => p.clone().addScaledVector(dir, (p.y - bottom - 0.02) / Math.sin(el));

      // feixe: quatro faces laterais do prisma que vai da janela ao chão; a cor apaga perto do piso
      const corners = [P(a0, win.sill, inner), P(a1, win.sill, inner), P(a1, win.top, inner), P(a0, win.top, inner)];
      const ends = corners.map(toFloor);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const quad = [corners[i], corners[j], ends[j], corners[i], ends[j], ends[i]];
        const fade = [1, 1, 0.12, 1, 0.12, 0.12];
        quad.forEach((v, k) => {
          shaftPos.push(v.x, v.y, v.z);
          shaftCol.push(fade[k], fade[k], fade[k]);
        });
      }

      // desenho da janela no piso: quatro vidraças separadas pela sombra da cruzeta
      const gap = 0.03;
      const panes: [number, number, number, number][] = [
        [a0 + f, win.center - gap, win.sill + f, midY - gap],
        [win.center + gap, a1 - f, win.sill + f, midY - gap],
        [a0 + f, win.center - gap, midY + gap, win.top - f],
        [win.center + gap, a1 - f, midY + gap, win.top - f],
      ];
      for (const [pa, pb, py0, py1] of panes) {
        const q = [P(pa, py0, inner), P(pb, py0, inner), P(pb, py1, inner), P(pa, py1, inner)].map(toFloor);
        for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) patchPos.push(v.x, v.y, v.z);
      }

      // luz da lua: de fora da janela, apontando para onde o feixe cai
      this.moonPoints.push({
        pos: P(win.center, win.top + 0.15, outward * 0.5),
        target: toFloor(P(win.center, (win.sill + win.top) / 2, inner)),
      });
    }

    if (glass.length) {
      const merged = mergeGeometries(glass, false);
      for (const g of glass) g.dispose();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9fb4d6, emissive: 0x4a6aa0, emissiveIntensity: 0.8, roughness: 0.15, transparent: true, opacity: 0.32, depthWrite: false });
      if (merged) this.scene.add(new THREE.Mesh(merged, mat));
    }
    if (shaftPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(shaftPos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(shaftCol, 3));
      const mat = new THREE.MeshBasicMaterial({ color: 0x7f97c9, vertexColors: true, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const shafts = new THREE.Mesh(g, mat);
      shafts.renderOrder = 2;
      this.scene.add(shafts);
    }
    if (patchPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(patchPos, 3));
      const mat = new THREE.MeshBasicMaterial({ color: 0x5d73a3, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
      this.scene.add(new THREE.Mesh(g, mat));
    }
  }

  /**
   * Candelabro de parede de latão com três velas: espelho na parede, braço, três copos (o do meio mais alto),
   * velas, chamas que brilham sozinhas e um halo por candelabro. Tudo mesclado por material: 27 candelabros
   * custam 4 chamadas de desenho mais os halos.
   */
  private buildCandelabraModels(list: CandelabraDef[], shadows: boolean) {
    const brass: THREE.BufferGeometry[] = [];
    const wax: THREE.BufferGeometry[] = [];
    const fire: THREE.BufferGeometry[] = [];
    const add = (into: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number, m: THREE.Matrix4) => {
      g.translate(x, y, z);
      g.applyMatrix4(m);
      into.push(g);
    };
    const haloTex = glowTexture();
    this.washMat.map = haloTex;
    // espaço local: X ao longo da parede, Y para cima (0 = base das velas), Z para dentro do cômodo
    const cups = [
      { x: -0.2, y: 0 },
      { x: 0, y: 0.07 },
      { x: 0.2, y: 0 },
    ];
    for (const c of list) {
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(c.nx, c.nz)).setPosition(c.x, c.y, c.z);
      add(brass, new THREE.BoxGeometry(0.11, 0.26, 0.02), 0, -0.13, 0.01, m); // espelho
      add(brass, new THREE.BoxGeometry(0.03, 0.03, 0.15), 0, -0.1, 0.085, m); // haste até o braço
      add(brass, new THREE.BoxGeometry(0.43, 0.022, 0.022), 0, -0.1, 0.16, m); // braço
      for (const cup of cups) {
        add(brass, new THREE.CylinderGeometry(0.012, 0.012, 0.1 + cup.y, 6), cup.x, -0.05 + cup.y / 2, 0.16, m); // poste
        add(brass, new THREE.CylinderGeometry(0.045, 0.03, 0.03, 10), cup.x, cup.y - 0.005, 0.16, m); // copo
        add(wax, new THREE.CylinderGeometry(0.02, 0.022, 0.15, 8), cup.x, cup.y + 0.085, 0.16, m); // vela
        const flame = new THREE.SphereGeometry(0.016, 8, 6);
        flame.scale(1, 2.4, 1);
        add(fire, flame, cup.x, cup.y + 0.19, 0.16, m);
      }

      const flamePos = new THREE.Vector3(0, 0.22, 0.16).applyMatrix4(m);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffb46b, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.copy(flamePos);
      halo.scale.setScalar(1.1);
      this.scene.add(halo);
      this.halos.push(halo);

      // clarão quente pintado na parede em volta: dá a impressão de parede iluminada sem gastar luz real
      const wash = new THREE.Mesh(this.washGeo, this.washMat);
      wash.position.set(0, 0.05, 0.012).applyMatrix4(m);
      wash.rotation.y = Math.atan2(c.nx, c.nz);
      wash.renderOrder = 1;
      this.scene.add(wash);

      // a luz sai um pouco à frente das chamas, para iluminar a parede em volta e o cômodo
      const n = new THREE.Vector3(c.nx, 0, c.nz);
      this.candlePoints.push({ pos: flamePos.clone().addScaledVector(n, 0.25), target: flamePos.clone() });
    }

    const mesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, castShadow: boolean) => {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) return;
      const msh = new THREE.Mesh(merged, mat);
      msh.castShadow = castShadow;
      this.scene.add(msh);
    };
    mesh(brass, new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.75, roughness: 0.35 }), shadows);
    mesh(wax, new THREE.MeshStandardMaterial({ color: 0xf1e7d0, roughness: 0.8, emissive: 0x3a2412, emissiveIntensity: 0.6 }), false);
    mesh(fire, new THREE.MeshBasicMaterial({ color: 0xffd38a }), false);
  }

  private buildDoors() {
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.75 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.3 });
    for (const d of this.world.doors) {
      const p = d.placement;
      const along = p.alongZ ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const swingNormal = (p.alongZ ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)).multiplyScalar(p.swingSide);
      const width = p.to - p.from;
      const center = new THREE.Vector3(d.centerX, p.bottom, d.centerZ);
      const pMin = center.clone().addScaledVector(along, -width / 2);
      const pMax = center.clone().addScaledVector(along, width / 2);
      const leaves: { hinge: THREE.Vector3; dir: THREE.Vector3; w: number }[] = p.isDouble
        ? [
            { hinge: pMin, dir: along.clone(), w: width / 2 },
            { hinge: pMax, dir: along.clone().negate(), w: width / 2 },
          ]
        : p.hingeAtMin
          ? [{ hinge: pMin, dir: along.clone(), w: width }]
          : [{ hinge: pMax, dir: along.clone().negate(), w: width }];

      const entry = { id: d.id, hinges: [] as { obj: THREE.Object3D; sign: number }[], angle: 0 };
      for (const leaf of leaves) {
        const hinge = new THREE.Object3D();
        hinge.position.copy(leaf.hinge);
        const lw = leaf.w - 0.03;
        const lh = p.height - 0.03;
        const panel = new THREE.Mesh(p.alongZ ? new THREE.BoxGeometry(0.05, lh, lw) : new THREE.BoxGeometry(lw, lh, 0.05), doorMat);
        panel.position.copy(leaf.dir.clone().multiplyScalar(leaf.w / 2)).add(new THREE.Vector3(0, lh / 2, 0));
        panel.castShadow = true;
        hinge.add(panel);
        for (const side of [1, -1]) {
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), knobMat);
          knob.position.copy(leaf.dir.clone().multiplyScalar(leaf.w - 0.1)).add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(swingNormal, 0.05 * side);
          hinge.add(knob);
        }
        this.scene.add(hinge);
        // rotação positiva em Y leva (x,z) -> (z,-x); escolhe o sinal que abre para o lado certo
        const rotated = new THREE.Vector3(leaf.dir.z, 0, -leaf.dir.x);
        entry.hinges.push({ obj: hinge, sign: rotated.dot(swingNormal) >= 0 ? 1 : -1 });
      }
      this.doors.push(entry);
    }
  }

  /** Carrega os modelos dos móveis (.obj + .mtl) e posiciona os 58. */
  async loadProps(audio: GameAudio | null, shadows: boolean): Promise<void> {
    const mtl = await new MTLLoader()
      .setPath("/assets/moveis/")
      .loadAsync("moveis_vitorianos.mtl")
      .catch(() => null);
    mtl?.preload();
    const cache = new Map<string, THREE.Group | null>();
    const files = [...new Set(this.world.props.map((p) => p.def.type.model))];
    await Promise.all(
      files.map(async (file) => {
        const loader = new OBJLoader();
        if (mtl) loader.setMaterials(mtl);
        cache.set(file, await loader.loadAsync(`/assets/moveis/${file}`).catch(() => null));
      }),
    );

    for (const p of this.world.props) {
      const model = cache.get(p.def.type.model);
      let node: THREE.Object3D;
      if (model) {
        node = model.clone();
      } else {
        const [w, h, d] = p.def.type.dimensions;
        node = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), new THREE.MeshStandardMaterial({ color: 0x6a4b33 }));
      }
      node.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = shadows;
          o.receiveShadow = shadows;
        }
      });
      node.position.set(p.x, p.y, p.z);
      node.rotation.y = p.yawRad;
      this.scene.add(node);
      this.propNodes.set(p.id, { node, base: node.position.clone(), baseRot: p.yawRad, still: true });

      if (p.def.type.category === "iluminacao") {
        const light = new THREE.PointLight(0xffc27a, 9, 8, 2);
        light.position.set(p.x, p.y + p.height * 0.45, p.z);
        this.scene.add(light);
        this.lampLights.set(p.id, { light, base: 9 });
      }
      if (audio && p.def.type.model === "relogio_pendulo.obj") audio.loopOn(node, "clock", 0.35, 8);
    }
  }

  // ------------------------------------------------------------------ Personagens

  syncActors(s: MatchState) {
    for (const h of s.hunters) {
      if (this.hunterFigs.has(h.id)) continue;
      const f = new HunterFigure();
      this.hunterFigs.set(h.id, f);
      this.scene.add(f.root);
    }
    for (const g of s.ghosts) {
      if (this.ghostFigs.has(g.id)) continue;
      const f = new GhostFigure();
      this.ghostFigs.set(g.id, f);
      this.scene.add(f.root);
    }
  }

  /** Assombração de lustre: pisca a luz. */
  flicker(propId: string, until: number) {
    if (this.lampLights.has(propId)) this.flickerUntil.set(propId, until);
  }

  // ------------------------------------------------------------------ Quadro

  update(s: MatchState, r: RenderInfo) {
    const t = s.time;
    this.moon.update(r.eye);
    // velas tremulam: luz e brilho com ruído barato (somas de senos com fase própria)
    const now = performance.now() / 1000;
    const flick = (k: number) => 0.85 + 0.09 * Math.sin(now * 9.1 + k * 1.7) + 0.06 * Math.sin(now * 23.3 + k * 4.1);
    this.candles.update(r.eye, flick);
    for (let i = 0; i < this.halos.length; i++) {
      const k = flick(i + 7);
      this.halos[i].scale.setScalar(1.1 * k);
      this.halos[i].material.opacity = 0.5 * k;
    }
    this.washMat.opacity = 0.22 * flick(3);

    for (const h of s.hunters) {
      const f = this.hunterFigs.get(h.id);
      if (!f) continue;
      const p = r.pos(h.id);
      const mine = r.firstPerson && h.id === r.localId;
      f.root.visible = !mine;
      f.update(h, p.x, p.y, p.z, t, r.dt);
      this.updateBeam(h.id, h.beam, mine ? r.localBeamOrigin : null, p, h.bodyYaw);
    }
    for (const g of s.ghosts) {
      const p = r.pos(g.id);
      this.ghostFigs.get(g.id)?.update(g, p.x, p.y, p.z, t, r.dt);
    }

    // móveis: tremor do aviso (15 s) e da assombração
    for (const [id, n] of this.propNodes) {
      const ps = s.props[id];
      const amp = (ps.shakeUntil > t ? 0.035 : 0) + (ps.warning ? 0.02 : 0);
      if (amp > 0) {
        n.still = false;
        n.node.position.set(n.base.x + (Math.random() - 0.5) * amp * 2, n.base.y + Math.random() * amp * 0.5, n.base.z + (Math.random() - 0.5) * amp * 2);
        n.node.rotation.set((Math.random() - 0.5) * amp, n.baseRot + (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
      } else if (!n.still) {
        n.still = true;
        n.node.position.copy(n.base);
        n.node.rotation.set(0, n.baseRot, 0);
      }
    }
    for (const [id, l] of this.lampLights) {
      const until = this.flickerUntil.get(id) ?? 0;
      l.light.intensity = until > t ? l.base * (Math.random() < 0.35 ? 0.05 : 0.6 + Math.random()) : l.base;
    }

    // portas
    for (const d of this.doors) {
      const target = s.doorsOpen[d.id] ? (95 * Math.PI) / 180 : 0;
      d.angle += (target - d.angle) * Math.min(1, r.dt * 7);
      for (const h of d.hinges) h.obj.rotation.y = h.sign * d.angle;
    }

    // sal
    const live = new Set<number>();
    for (const sb of s.salt) {
      live.add(sb.id);
      let m = this.saltMeshes.get(sb.id);
      if (!m) {
        m = new THREE.Group();
        const strip = new THREE.Mesh(this.saltGeo, this.saltMat);
        strip.position.y = 0.02;
        const wall = new THREE.Mesh(this.saltWallGeo, this.saltWallMat);
        wall.position.y = BALANCE.hunter.saltHeight / 2;
        m.add(strip, wall);
        m.position.set(sb.x, sb.y, sb.z);
        m.rotation.y = sb.yaw;
        this.scene.add(m);
        this.saltMeshes.set(sb.id, m);
      }
      // pisca no último segundo
      m.children[1].visible = sb.until - t > 1 || Math.sin(t * 20) > 0;
    }
    for (const [id, m] of this.saltMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(m);
      this.saltMeshes.delete(id);
    }

    // pegadas espectrais: só com a câmera térmica ligada
    if (r.thermal) {
      let i = 0;
      for (const f of s.footprints) {
        const age = (t - f.at) / BALANCE.ghost.footprintLife;
        if (age > 1 || i >= 600) continue;
        const side = f.left ? -0.1 : 0.1;
        this.tmp.position.set(f.x + Math.cos(f.yaw) * side, f.y + 0.012, f.z - Math.sin(f.yaw) * side);
        this.tmp.rotation.set(0, f.yaw, 0);
        const k = 1 - age * 0.7;
        this.tmp.scale.set(k, 1, k);
        this.tmp.updateMatrix();
        this.footprints.setMatrixAt(i++, this.tmp.matrix);
      }
      this.footprints.count = i;
      this.footprints.instanceMatrix.needsUpdate = true;
      this.footprints.visible = true;
    } else {
      this.footprints.visible = false;
    }
  }

  private updateBeam(id: string, end: { x: number; y: number; z: number } | null, originOverride: THREE.Vector3 | null, p: { x: number; y: number; z: number }, yaw: number) {
    let m = this.beams.get(id);
    if (!end) {
      if (m) m.visible = false;
      return;
    }
    if (!m) {
      m = new THREE.Mesh(this.beamGeo, this.beamMat);
      m.frustumCulled = false;
      this.scene.add(m);
      this.beams.set(id, m);
    }
    // sem origem dada: sai da mão direita do caçador
    const from =
      originOverride ?? new THREE.Vector3(p.x - Math.cos(yaw) * 0.32 + Math.sin(yaw) * 0.45, p.y + 1.0, p.z + Math.sin(yaw) * 0.32 + Math.cos(yaw) * 0.45);
    const dir = new THREE.Vector3(end.x, end.y, end.z).sub(from);
    const len = dir.length();
    m.visible = len > 0.05;
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.scale.set(1 + Math.random() * 0.4, len, 1 + Math.random() * 0.4);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  dispose() {
    for (const h of this.halos) {
      h.material.map?.dispose();
      h.material.dispose();
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mm of mats) mm?.dispose();
      }
    });
  }
}
