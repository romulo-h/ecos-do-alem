import { roomAt } from "./walls";
import { distanceToProp, type World } from "./world";

/**
 * Janelas nas paredes externas, por onde entra o luar. Só visual: na física a parede continua inteira
 * (é vidro), então colisão, linha de visão e aspirador não mudam.
 *
 * Cada trecho de parede externa recebe janelas espaçadas por igual, longe dos cantos e dos vãos de porta.
 * Uma janela é descartada quando atravessa a junção com uma parede interna ou quando um móvel alto está
 * encostado nela por dentro.
 */

export interface WindowDef {
  /** índice em world.walls da parede que recebe o vão */
  wall: number;
  floor: number;
  /** a parede corre ao longo de Z (plano x = line) */
  alongZ: boolean;
  line: number;
  /** centro da janela ao longo da parede */
  center: number;
  width: number;
  /** Y absoluto do peitoril e da verga */
  sill: number;
  top: number;
  /** lado (no eixo perpendicular à parede) que dá para fora: +1 coordenada maior, -1 menor */
  outward: 1 | -1;
  /** cômodo interno iluminado */
  room: string;
  /** profundidade livre do cômodo a partir da parede (limita até onde o feixe pode ir) */
  depth: number;
}

export const WINDOW = {
  width: 1.1,
  minWidth: 0.7, // trecho curto ganha janela mais estreita
  spacing: 2.8, // entre centros
  margin: 0.45, // distância mínima das pontas do trecho (cantos e batentes)
  sillHeight: 0.95,
  topHeight: 2.35,
};

export function buildWindows(world: World): WindowDef[] {
  const { rooms, floorHeight: fh, wallThickness: t } = world.data;
  const out: WindowDef[] = [];

  world.walls.forEach((w, wall) => {
    if (w.kind !== "exterior") return;
    const alongZ = w.maxX - w.minX < w.maxZ - w.minZ;
    const line = alongZ ? (w.minX + w.maxX) / 2 : (w.minZ + w.maxZ) / 2;
    const from = (alongZ ? w.minZ : w.minX) + t / 2;
    const to = (alongZ ? w.maxZ : w.maxX) - t / 2;
    const floor = Math.round(w.minY / fh);
    const bottom = floor * fh;
    const sill = bottom + WINDOW.sillHeight;
    const top = Math.min(bottom + WINDOW.topHeight, w.maxY - 0.35);
    if (top - sill < 0.8) return;

    const usable = to - from - 2 * WINDOW.margin;
    if (usable < WINDOW.minWidth) return;
    const width = Math.min(WINDOW.width, usable);
    const n = Math.floor((usable - width) / WINDOW.spacing) + 1;
    const mid = (from + to) / 2;
    const onFloor = rooms.filter((r) => r.floor === floor);
    const at = (side: number, a: number) => (alongZ ? roomAt(onFloor, line + side, a) : roomAt(onFloor, a, line + side));
    const placed: number[] = [];

    const fits = (c: number) => {
      if (c - width / 2 < from + WINDOW.margin - 1e-6 || c + width / 2 > to - WINDOW.margin + 1e-6) return null;
      if (placed.some((o) => Math.abs(o - c) < width + 0.4)) return null;
      const lo = at(-0.3, c);
      const hi = at(0.3, c);
      const inside = lo && !lo.outdoor ? lo : hi && !hi.outdoor ? hi : undefined;
      if (!inside || (lo && !lo.outdoor && hi && !hi.outdoor)) return null;
      const side = inside === lo ? -1 : 1;

      // a janela inteira (com folga) tem de olhar para o mesmo cômodo
      const span = width / 2 + 0.15;
      if (at(0.3 * side, c - span) !== inside || at(0.3 * side, c + span) !== inside) return null;

      // móvel alto encostado na janela por dentro
      const px = alongZ ? line + side * 0.35 : c;
      const pz = alongZ ? c : line + side * 0.35;
      const blocked = world.props.some(
        (p) => p.floor === floor && p.y + p.height > sill + 0.1 && distanceToProp(p, px, sill + 0.4, pz, 0) < width / 2 + 0.05,
      );
      return blocked ? null : { inside, side };
    };

    for (let i = 0; i < n; i++) {
      const ideal = mid + (i - (n - 1) / 2) * WINDOW.spacing;
      // móvel na frente: tenta deslizar a janela para o lado antes de desistir
      for (const shift of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const c = ideal + shift;
        const ok = fits(c);
        if (!ok) continue;
        const { inside, side } = ok;
        const outward = (side === -1 ? 1 : -1) as 1 | -1;
        const depth = alongZ ? (side === 1 ? inside.maxX - line : line - inside.minX) : side === 1 ? inside.maxZ - line : line - inside.minZ;
        out.push({ wall, floor, alongZ, line, center: c, width, sill, top, outward, room: inside.name, depth });
        placed.push(c);
        break;
      }
    }
  });
  return out;
}
