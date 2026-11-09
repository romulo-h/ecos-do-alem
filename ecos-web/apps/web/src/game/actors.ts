import * as THREE from "three";
import type { Ghost, Hunter } from "@ecos/shared";

/**
 * Figuras procedurais dos personagens (o equivalente ao ProceduralCharacterRig do Unity, enquanto o
 * modelo .glb real não chega). Pivô nos pés, frente para +Z.
 */

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
}

function part(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export class HunterFigure {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private coat: THREE.MeshStandardMaterial;
  private stride = 0;
  private fall = 0;

  constructor() {
    this.coat = mat(0x3b2a1e);
    const trousers = mat(0x221c1a);
    const skin = mat(0xd5b08a);
    const hat = mat(0x17120f);
    const metal = mat(0x6b6f75, { metalness: 0.6, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x5fe8ff, emissiveIntensity: 1.6 });

    this.root.add(this.body);
    // pernas (pivô no quadril)
    for (const [leg, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      leg.position.set(x, 0.86, 0);
      this.body.add(leg);
      part(new THREE.BoxGeometry(0.15, 0.84, 0.17), trousers, 0, -0.42, 0, leg);
      part(new THREE.BoxGeometry(0.16, 0.08, 0.26), hat, 0, -0.82, 0.04, leg);
    }
    // casaco longo
    part(new THREE.CylinderGeometry(0.25, 0.33, 0.95, 12), this.coat, 0, 1.2, 0, this.body);
    // braços (pivô no ombro)
    for (const [arm, x] of [
      [this.armL, -0.31],
      [this.armR, 0.31],
    ] as const) {
      arm.position.set(x, 1.58, 0);
      this.body.add(arm);
      part(new THREE.BoxGeometry(0.12, 0.62, 0.13), this.coat, 0, -0.3, 0, arm);
      part(new THREE.SphereGeometry(0.06, 8, 6), skin, 0, -0.64, 0, arm);
    }
    // bocal do aspirador na mão direita
    part(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 8), metal, 0, -0.68, 0.18, this.armR).rotation.x = Math.PI / 2;
    // cabeça e chapéu
    part(new THREE.SphereGeometry(0.14, 14, 10), skin, 0, 1.82, 0, this.body);
    part(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 16), hat, 0, 1.94, 0, this.body);
    part(new THREE.CylinderGeometry(0.15, 0.16, 0.22, 14), hat, 0, 2.06, 0, this.body);
    // tanque do aspirador nas costas
    part(new THREE.CylinderGeometry(0.13, 0.13, 0.55, 12), metal, 0, 1.28, -0.3, this.body);
    part(new THREE.TorusGeometry(0.135, 0.02, 6, 16), glow, 0, 1.35, -0.3, this.body).rotation.x = Math.PI / 2;
  }

  update(h: Hunter, x: number, y: number, z: number, time: number, dt: number) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = h.bodyYaw;

    const speed = h.dead ? 0 : h.speed;
    const k = Math.min(1, speed / 4);
    this.stride += speed * dt * (h.sprinting ? 2.2 : 3.4);
    const swing = Math.sin(this.stride) * 0.7 * k;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    // mirando: braço direito para a frente
    this.armR.rotation.x = h.aiming ? -1.45 : swing * 0.8;
    this.body.rotation.x = h.sprinting ? 0.18 : 0; // corre inclinado
    this.body.position.y = Math.abs(Math.sin(this.stride)) * 0.04 * k + (k === 0 ? Math.sin(time * 1.6) * 0.008 : 0);

    // golpeado: casaco pisca vermelho
    const hurt = Math.max(0, 1 - (time - h.lastHurtAt) / 0.35);
    this.coat.emissive.setRGB(hurt * 0.6, 0, 0);

    // morte: cai de costas
    this.fall = h.dead ? Math.min(1, this.fall + dt / 0.8) : 0;
    const e = this.fall * this.fall * (3 - 2 * this.fall);
    this.root.rotation.x = -e * (Math.PI / 2);
    this.root.position.y = y + e * 0.15;
  }
}

/** Mortalha do fantasma: perfil girado (cabeça arredondada, barra que alarga). */
function shroudGeometry(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0, 1.62],
    [0.12, 1.6],
    [0.2, 1.52],
    [0.23, 1.38],
    [0.21, 1.22],
    [0.25, 1.05],
    [0.3, 0.8],
    [0.36, 0.5],
    [0.42, 0.22],
    [0.45, 0.05],
  ];
  // LatheGeometry gira de baixo para cima: o perfil vai da barra até o topo
  const pts = prof.reverse().map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 20);
  // barra rasgada: ondula a borda de baixo
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.3) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, y + (0.3 - y) * 0.35 * (0.5 + 0.5 * Math.sin(a * 6)));
    }
  }
  g.computeVertexNormals();
  return g;
}

export class GhostFigure {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private shroud: THREE.MeshStandardMaterial;
  private eyes: THREE.MeshStandardMaterial;
  private clawL: THREE.Mesh;
  private clawR: THREE.Mesh;
  readonly glow: THREE.PointLight;
  private vanish = 0;

  constructor() {
    this.shroud = new THREE.MeshStandardMaterial({
      color: 0xdfe9f2,
      emissive: 0x7fb6d6,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.62,
      roughness: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.eyes = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ff3ff, emissiveIntensity: 3 });
    this.root.add(this.body);
    this.body.add(new THREE.Mesh(shroudGeometry(), this.shroud));
    for (const x of [-0.075, 0.075]) part(new THREE.SphereGeometry(0.035, 8, 6), this.eyes, x, 1.42, 0.2, this.body).castShadow = false;
    const clawGeo = new THREE.ConeGeometry(0.05, 0.28, 6);
    this.clawL = part(clawGeo, this.shroud, -0.32, 1.0, 0.18, this.body);
    this.clawR = part(clawGeo, this.shroud, 0.32, 1.0, 0.18, this.body);
    this.clawL.rotation.x = this.clawR.rotation.x = Math.PI / 2;
    this.glow = new THREE.PointLight(0x9ff3ff, 1.6, 4.5, 2);
    this.glow.position.set(0, 1.2, 0);
    this.root.add(this.glow);
  }

  update(g: Ghost, x: number, y: number, z: number, time: number, dt: number) {
    const hidden = !!g.propId;
    this.root.visible = !hidden && this.vanish < 1;
    if (hidden) return;

    this.root.position.set(x, y, z);
    this.root.rotation.y = g.bodyYaw;

    // flutua; deslizando, inclina para a frente
    const k = Math.min(1, g.speed / 4);
    this.body.position.y = 0.18 + Math.sin(time * 2.2 + x) * 0.06;
    this.body.rotation.x = k * 0.22;
    this.body.rotation.z = Math.sin(time * 1.3) * 0.04;

    // Caçada Invertida: fúria (olhos vermelhos, garras)
    const fury = g.huntMode;
    this.eyes.emissive.setHex(fury ? 0xff2a1a : 0x9ff3ff);
    this.glow.color.setHex(fury ? 0xff4030 : 0x9ff3ff);
    this.clawL.visible = this.clawR.visible = fury;
    this.shroud.color.setHex(fury ? 0x8a8199 : 0xdfe9f2);

    // Toque Gélido: avança o corpo no golpe
    const sinceAttack = time - g.lastAttackAt;
    const lunge = sinceAttack < 0.45 ? Math.sin((sinceAttack / 0.45) * Math.PI) : 0;
    this.body.position.z = lunge * 0.35;
    this.clawL.rotation.z = this.clawR.rotation.z = lunge * 0.8;

    // exposto: pisca
    const exposed = time < g.exposedUntil;
    this.shroud.emissiveIntensity = exposed ? 0.6 + 0.6 * Math.abs(Math.sin(time * 14)) : fury ? 0.15 : 0.35;
    this.shroud.opacity = fury ? 0.8 : 0.62;

    // exorcismo: gira, sobe e some
    if (g.exorcised) {
      this.vanish = Math.min(1, this.vanish + dt / 1.5);
      this.root.rotation.y += this.vanish * 12;
      this.body.position.y += this.vanish * 1.6;
      this.shroud.opacity *= 1 - this.vanish;
      this.glow.intensity = 1.6 * (1 - this.vanish);
    }
  }
}
