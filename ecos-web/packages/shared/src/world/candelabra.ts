import { buildWindows, type WindowDef } from "./windows";
import { distanceToProp, type World } from "./world";

/**
 * Um candelabro de parede (três velas) em cada cômodo interno. Só visual: fica acima da cabeça, encostado na
 * parede, então não entra na colisão nem no raycast.
 *
 * Escolha do lugar: as paredes do cômodo da mais longa para a mais curta, e em cada uma do meio para as
 * pontas, o primeiro ponto onde existe parede de verdade na altura do candelabro, longe de portas, janelas,
 * escadas e móveis altos.
 */

export interface CandelabraDef {
  room: string;
  floor: number;
  /** ponto na face da parede, na altura das velas */
  x: number;
  y: number;
  z: number;
  /** normal da parede apontando para dentro do cômodo */
  nx: number;
  nz: number;
}

export const CANDELABRA = {
  /** altura do suporte acima do piso do andar */
  mountHeight: 1.85,
  /** meia largura do suporte ao longo da parede */
  halfWidth: 0.22,
  /** folga mínima até a borda de portas e janelas */
  clearance: 0.3,
};

export function buildCandelabras(world: World, windows: WindowDef[] = buildWindows(world)): CandelabraDef[] {
  const { rooms, doors, floorHeight: fh, wallThickness: t } = world.data;
  const out: CandelabraDef[] = [];

  for (const room of rooms) {
    if (room.outdoor) continue;
    const bottom = room.floor * fh;
    const y = bottom + CANDELABRA.mountHeight;
    const edges = [
      { alongZ: true, line: room.minX, from: room.minZ, to: room.maxZ, nx: 1, nz: 0 },
      { alongZ: true, line: room.maxX, from: room.minZ, to: room.maxZ, nx: -1, nz: 0 },
      { alongZ: false, line: room.minZ, from: room.minX, to: room.maxX, nx: 0, nz: 1 },
      { alongZ: false, line: room.maxZ, from: room.minX, to: room.maxX, nx: 0, nz: -1 },
    ].sort((a, b) => b.to - b.from - (a.to - a.from));

    /** strict = false: segunda passada, para cômodo apertado (folga menor, ignora escada e móvel alto) */
    const fits = (e: (typeof edges)[number], a: number, strict: boolean) => {
      const hw = CANDELABRA.halfWidth;
      // parede de verdade (não guarda-corpo nem verga de porta) cobrindo o suporte inteiro na altura dele
      const px = e.alongZ ? e.line : a;
      const pz = e.alongZ ? a : e.line;
      const wall = world.walls.some((w) => {
        if (w.kind === "railing" || w.kind === "lintel") return false;
        if (w.minY > y - 0.3 || w.maxY < y + 0.3) return false;
        return e.alongZ
          ? px >= w.minX - 0.01 && px <= w.maxX + 0.01 && a - hw >= w.minZ && a + hw <= w.maxZ
          : pz >= w.minZ - 0.01 && pz <= w.maxZ + 0.01 && a - hw >= w.minX && a + hw <= w.maxX;
      });
      if (!wall) return false;

      const clear = hw + (strict ? CANDELABRA.clearance : 0.05);
      for (const d of doors) {
        if (d.floor !== room.floor) continue;
        const dl = e.alongZ ? d.centerX : d.centerZ;
        if (Math.abs(dl - e.line) > t) continue;
        const da = e.alongZ ? d.centerZ : d.centerX;
        if (Math.abs(da - a) < d.width / 2 + clear) return false;
      }
      for (const w of windows) {
        if (w.floor !== room.floor || w.alongZ !== e.alongZ || Math.abs(w.line - e.line) > t) continue;
        if (Math.abs(w.center - a) < w.width / 2 + clear) return false;
      }

      if (!strict) return true;
      // ponto logo à frente do suporte, dentro do cômodo
      const ix = px + e.nx * (t / 2 + 0.25);
      const iz = pz + e.nz * (t / 2 + 0.25);
      for (const r of world.ramps) {
        if (r.h1 < bottom || r.h0 > bottom + fh) continue;
        if (ix > r.minX - 0.5 && ix < r.maxX + 0.5 && iz > r.minZ - 0.5 && iz < r.maxZ + 0.5) return false;
      }
      const tall = world.props.some((p) => p.floor === room.floor && p.y + p.height > y - 0.35 && distanceToProp(p, ix, y, iz, 0) < 0.5);
      return !tall;
    };

    /** primeiro ponto livre: paredes da mais longa para a mais curta, do meio para as pontas */
    const find = (strict: boolean) => {
      const step = strict ? 0.35 : 0.1;
      const margin = CANDELABRA.halfWidth + (strict ? 0.3 : 0.1);
      for (const e of edges) {
        const mid = (e.from + e.to) / 2;
        for (let k = 0; ; k++) {
          const off = Math.ceil(k / 2) * step * (k % 2 ? 1 : -1);
          if (Math.abs(off) > (e.to - e.from) / 2) break;
          const a = mid + off;
          if (a < e.from + margin || a > e.to - margin) continue;
          if (fits(e, a, strict)) return { e, a };
        }
      }
      return null;
    };

    const spot = find(true) ?? find(false);
    if (!spot) continue;
    const { e, a } = spot;
    out.push({
      room: room.name,
      floor: room.floor,
      x: e.alongZ ? e.line + e.nx * (t / 2) : a,
      y,
      z: e.alongZ ? a : e.line + e.nz * (t / 2),
      nx: e.nx,
      nz: e.nz,
    });
  }
  return out;
}
