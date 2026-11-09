import { describe, expect, it } from "vitest";
import { BALANCE } from "../data/balance";
import { parseMansion } from "../data/mansion";
import { buildWorld, groundAt, moveBody, rampHeight, raycast, type Body, type DynamicWorld } from "../world/world";
import { buildWindows } from "../world/windows";
import { buildCandelabras } from "../world/candelabra";
import { roomAt } from "../world/walls";

const world = buildWorld();
const closedDoors: DynamicWorld = { isDoorOpen: () => false, salt: [] };
const openDoors: DynamicWorld = { isDoorOpen: () => true, salt: [] };
const hunterOpt = { passDoors: false, blockedBySalt: false };
const H = BALANCE.hunter;

function body(x: number, y: number, z: number): Body {
  return { x, y, z, vy: 0, grounded: true };
}

describe("dados da mansão", () => {
  it("lê os 27 cômodos, as 27 aberturas e os 58 móveis", () => {
    const d = parseMansion();
    expect(d.rooms).toHaveLength(27);
    expect(d.doors).toHaveLength(27);
    expect(d.props).toHaveLength(58);
    expect(d.spawns.hunters).toHaveLength(2);
    expect(d.spawns.ghosts).toHaveLength(4);
  });

  it("toda porta cai sobre uma parede entre os dois cômodos (porte do MansionWalls)", () => {
    expect(world.errors).toEqual([]);
    // 13 portas simples + 2 duplas viram folhas; arcos e vãos abertos não
    expect(world.doors).toHaveLength(15);
  });

  it("gera paredes externas, internas, vergas e guarda-corpos", () => {
    const kinds = new Set(world.walls.map((w) => w.kind));
    expect(kinds).toEqual(new Set(["interior", "exterior", "lintel", "railing"]));
  });
});

describe("chão e escadas", () => {
  it("o térreo está em y = 0 e o primeiro andar em 3,2", () => {
    const hall = world.data.rooms.find((r) => r.floor === 0 && r.name === "Hall de Entrada")!;
    expect(groundAt(world, (hall.minX + hall.maxX) / 2, hall.maxZ - 0.3, 0)).toBeCloseTo(0);
    const up = world.data.rooms.find((r) => r.floor === 1 && r.name.startsWith("Suite"))!;
    expect(groundAt(world, (up.minX + up.maxX) / 2, (up.minZ + up.maxZ) / 2, 3.2)).toBeCloseTo(3.2);
  });

  it("a rampa da escada sobe de 0 a 3,2 no sentido indicado", () => {
    const st = world.ramps.find((r) => r.name === "Escada_Principal_Lance_Esquerdo")!;
    const cx = (st.minX + st.maxX) / 2;
    expect(rampHeight(st, cx, st.maxZ)).toBeCloseTo(0); // sobe para -z
    expect(rampHeight(st, cx, st.minZ)).toBeCloseTo(3.2);
  });

  it("um caçador sobe a escada principal andando para os fundos", () => {
    const st = world.ramps.find((r) => r.name === "Escada_Principal_Lance_Esquerdo")!;
    const b = body((st.minX + st.maxX) / 2, 0, st.maxZ + 0.6);
    for (let i = 0; i < 120; i++) moveBody(world, closedDoors, b, H.radius, H.height, 0, -H.walk / 30, 1 / 30, hunterOpt);
    expect(b.y).toBeCloseTo(3.2, 1);
    expect(b.z).toBeLessThan(st.minZ);
  });

  it("a escada de serviço liga a Despensa ao andar de cima", () => {
    const st = world.ramps.find((r) => r.name === "Escada_Servico")!;
    const b = body(st.maxX + 0.6, 0, (st.minZ + st.maxZ) / 2);
    for (let i = 0; i < 150; i++) moveBody(world, closedDoors, b, H.radius, H.height, -H.walk / 30, 0, 1 / 30, hunterOpt);
    expect(b.y).toBeCloseTo(3.2, 1);
  });
});

describe("colisão", () => {
  it("parede segura o caçador", () => {
    const b = body(0, 0, 4);
    for (let i = 0; i < 200; i++) moveBody(world, openDoors, b, H.radius, H.height, H.walk / 30, 0, 1 / 30, hunterOpt);
    expect(b.x).toBeLessThan(7.5); // não sai pela fachada direita
  });

  it("porta fechada segura o caçador, aberta deixa passar, e fantasma atravessa", () => {
    const door = world.doorById.get("porta_principal")!;
    const start = () => body(door.centerX, 0, door.centerZ + 1.2); // na varanda, de frente para a porta
    const walk = (dyn: DynamicWorld, passDoors: boolean) => {
      const b = start();
      for (let i = 0; i < 40; i++) moveBody(world, dyn, b, H.radius, H.height, 0, -H.walk / 30, 1 / 30, { passDoors, blockedBySalt: false });
      return b.z;
    };
    expect(walk(closedDoors, false)).toBeGreaterThan(door.centerZ);
    expect(walk(openDoors, false)).toBeLessThan(door.centerZ - 0.5);
    expect(walk(closedDoors, true)).toBeLessThan(door.centerZ - 0.5);
  });

  it("raycast acerta um móvel na frente", () => {
    const p = world.props[0];
    const hit = raycast(world, openDoors, p.x + 2, p.y + p.height / 2, p.z, -1, 0, 0, 5, { props: true });
    expect(hit?.kind === "prop" || hit?.kind === "wall").toBe(true);
  });
});

describe("janelas", () => {
  const windows = buildWindows(world);

  it("toda janela fica numa parede externa, dando para um cômodo interno, sem sobrepor outra", () => {
    expect(windows.length).toBeGreaterThan(10);
    for (const w of windows) {
      expect(world.walls[w.wall].kind).toBe("exterior");
      const rooms = world.data.rooms.filter((r) => r.floor === w.floor);
      const inX = w.alongZ ? w.line - w.outward * 0.4 : w.center;
      const inZ = w.alongZ ? w.center : w.line - w.outward * 0.4;
      const room = roomAt(rooms, inX, inZ);
      expect(room?.name).toBe(w.room);
      expect(room?.outdoor).toBeFalsy();
      expect(w.top - w.sill).toBeGreaterThan(0.8);
      const same = windows.filter((o) => o !== w && o.wall === w.wall);
      for (const o of same) expect(Math.abs(o.center - w.center)).toBeGreaterThanOrEqual(w.width);
    }
  });

  it("cada andar tem janelas (o luar chega aos dois pisos)", () => {
    const floors = new Set(windows.map((w) => w.floor));
    for (const r of world.data.rooms) expect(floors.has(r.floor)).toBe(true);
  });

  it("nenhuma janela abre em vão de porta", () => {
    for (const w of windows) {
      for (const d of world.data.doors) {
        if (d.floor !== w.floor) continue;
        const lineCoord = w.alongZ ? d.centerX : d.centerZ;
        if (Math.abs(lineCoord - w.line) > 0.05) continue;
        const a = w.alongZ ? d.centerZ : d.centerX;
        expect(Math.abs(a - w.center)).toBeGreaterThan((d.width + w.width) / 2);
      }
    }
  });
});

describe("candelabros", () => {
  const windows = buildWindows(world);
  const cands = buildCandelabras(world, windows);

  it("todo cômodo interno tem exatamente um candelabro, dentro dele e na parede", () => {
    const indoor = world.data.rooms.filter((r) => !r.outdoor);
    const missing = indoor.filter((r) => !cands.some((c) => c.room === r.name)).map((r) => r.name);
    expect(missing).toEqual([]);
    expect(cands).toHaveLength(indoor.length);
    for (const c of cands) {
      const room = indoor.find((r) => r.name === c.room)!;
      // um pouco à frente da parede cai dentro do próprio cômodo
      const inside = roomAt(world.data.rooms.filter((r) => r.floor === c.floor), c.x + c.nx * 0.2, c.z + c.nz * 0.2);
      expect(inside?.name).toBe(room.name);
      expect(c.y - c.floor * world.data.floorHeight).toBeCloseTo(1.85, 5);
    }
  });

  it("nenhum candelabro fica em cima de porta ou janela", () => {
    const t = world.data.wallThickness;
    for (const c of cands) {
      const alongZ = c.nx !== 0;
      const line = alongZ ? c.x - c.nx * (t / 2) : c.z - c.nz * (t / 2);
      const a = alongZ ? c.z : c.x;
      for (const d of world.data.doors) {
        if (d.floor !== c.floor || Math.abs((alongZ ? d.centerX : d.centerZ) - line) > t) continue;
        expect(Math.abs((alongZ ? d.centerZ : d.centerX) - a)).toBeGreaterThan(d.width / 2 + 0.22);
      }
      for (const w of windows) {
        if (w.floor !== c.floor || w.alongZ !== alongZ || Math.abs(w.line - line) > t) continue;
        expect(Math.abs(w.center - a)).toBeGreaterThan(w.width / 2 + 0.22);
      }
    }
  });
});
