import { describe, expect, it } from "vitest";
import { BALANCE } from "../data/balance";
import { buildNav } from "../world/nav";
import { buildWorld, propCenter } from "../world/world";
import { buildWindows } from "../world/windows";
import { botIntent, createBotBrain } from "../sim/bots";
import { createMatch, stepMatch } from "../sim/match";
import { emptyIntent, type Intent, type MatchState, type PlayerSlot } from "../sim/types";

const world = buildWorld();
const nav = buildNav(world);
const DT = 1 / BALANCE.tickRate;
const G = BALANCE.ghost;

const players: PlayerSlot[] = [
  { id: "g0", name: "Fantasma", team: "ghost", bot: false },
  { id: "h0", name: "Caçador", team: "hunter", bot: false },
];

function run(s: MatchState, seconds: number, intents: (s: MatchState) => Record<string, Intent> = () => ({})) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepMatch(world, s, intents(s), DT);
}

/** Coloca o fantasma ao lado do móvel e possui. */
function possess(s: MatchState, propId: string) {
  const g = s.ghosts[0];
  const p = world.propById.get(propId)!;
  g.x = p.x;
  g.y = p.floor * world.data.floorHeight;
  g.z = p.z;
  stepMatch(world, s, { g0: { ...emptyIntent(), interact: true, targetPropId: propId } }, DT);
  expect(g.propId).toBe(propId);
}

describe("fases da partida", () => {
  it("esconderijo de 15 s com caçador parado, depois a busca", () => {
    const s = createMatch(world, players);
    run(s, 5, () => ({ h0: { ...emptyIntent(), forward: 1 } }));
    expect(s.phase).toBe("hiding");
    expect(s.hunters[0].canMove).toBe(false);
    run(s, 10.1);
    expect(s.phase).toBe("hunting");
    expect(s.timeRemaining).toBeCloseTo(BALANCE.match.round, 0); // esconderijo não desconta da busca
  });

  it("tempo da busca acaba com fantasma vivo: Caçada Invertida; sobreviveram: caçadores vencem", () => {
    const s = createMatch(world, players, { hideSeconds: 0.1, roundSeconds: 2, reversalSeconds: 2 });
    run(s, 2.3);
    expect(s.phase).toBe("reversal");
    expect(s.ghosts[0].huntMode).toBe(true);
    run(s, 2.2);
    expect(s.phase).toBe("ended");
    expect(s.winner).toBe("hunter");
  });

  it("sem Caçada Invertida, o tempo acabando dá vitória aos fantasmas", () => {
    const s = createMatch(world, players, { hideSeconds: 0.1, roundSeconds: 1, reversal: false });
    run(s, 1.3);
    expect(s.winner).toBe("ghost");
  });
});

describe("regra dos 20 segundos", () => {
  const propId = "prop_01";

  it("avisa aos 15 s e expulsa aos 20 s, expondo o fantasma por 3 s", () => {
    const s = createMatch(world, players);
    possess(s, propId);
    const g = s.ghosts[0];
    run(s, G.warning - 0.2);
    expect(s.props[propId].warning).toBe(false);
    run(s, 0.4);
    expect(s.props[propId].warning).toBe(true);
    run(s, G.maxStay - G.warning);
    expect(g.propId).toBeNull();
    expect(g.exposedUntil).toBeGreaterThan(s.time);
  });

  it("depois da expulsão, a mesma zona fica bloqueada por 10 s", () => {
    const s = createMatch(world, players);
    possess(s, propId);
    run(s, G.maxStay + 0.1);
    const g = s.ghosts[0];
    expect(g.propId).toBeNull();
    stepMatch(world, s, { g0: { ...emptyIntent(), interact: true, targetPropId: propId } }, DT);
    expect(g.propId).toBeNull();
  });

  it("sair e voltar à mesma zona em menos de 10 s mantém o contador", () => {
    const s = createMatch(world, players);
    possess(s, propId);
    run(s, 8);
    stepMatch(world, s, { g0: { ...emptyIntent(), eject: true } }, DT);
    const g = s.ghosts[0];
    expect(g.propId).toBeNull();
    run(s, 2);
    possess(s, propId);
    expect(g.possessTime).toBeGreaterThan(7.5);
  });
});

describe("habilidades do fantasma", () => {
  it("Salto Espectral vai para outro móvel a até 6 m e entra em recarga", () => {
    const s = createMatch(world, players);
    const from = world.propById.get("prop_01")!;
    const c = propCenter(from);
    const target = world.props.find((p) => {
      const d = propCenter(p);
      return p.id !== from.id && Math.hypot(d.x - c.x, d.y - c.y, d.z - c.z) < 5.5;
    })!;
    possess(s, from.id);
    stepMatch(world, s, { g0: { ...emptyIntent(), jump: true, targetPropId: target.id } }, DT);
    const g = s.ghosts[0];
    expect(g.propId).toBe(target.id);
    expect(g.jumpReadyAt).toBeCloseTo(s.time + G.jumpCooldown, 1);
  });

  it("Assombração acende o EMF do móvel por 6 s mesmo vazio (isca)", () => {
    const s = createMatch(world, players);
    possess(s, "prop_01");
    stepMatch(world, s, { g0: { ...emptyIntent(), haunt: true } }, DT);
    stepMatch(world, s, { g0: { ...emptyIntent(), eject: true } }, DT);
    expect(s.props.prop_01.possessedBy).toBeNull();
    expect(s.props.prop_01.decoyUntil).toBeGreaterThan(s.time + 5);
  });
});

describe("caçador", () => {
  function hunterFacing(s: MatchState, propId: string) {
    const h = s.hunters[0];
    const p = world.propById.get(propId)!;
    const c = propCenter(p);
    // na frente do móvel, olhando para ele
    const ang = p.yawRad;
    h.x = p.x + Math.sin(ang) * (p.hz + 1.6);
    h.z = p.z + Math.cos(ang) * (p.hz + 1.6);
    h.y = p.floor * world.data.floorHeight;
    const dx = c.x - h.x;
    const dz = c.z - h.z;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(c.y - (h.y + BALANCE.hunter.eye), Math.hypot(dx, dz));
    return { yaw, pitch };
  }

  it("EMF marca o móvel possuído e zera sem ninguém", () => {
    const s = createMatch(world, players, { hideSeconds: 0 });
    run(s, DT * 2);
    const { yaw } = hunterFacing(s, "prop_01");
    run(s, DT, () => ({ h0: emptyIntent(yaw) }));
    expect(s.hunters[0].emf).toBe(0);
    possess(s, "prop_01");
    hunterFacing(s, "prop_01");
    run(s, DT, () => ({ h0: emptyIntent(yaw) }));
    expect(s.hunters[0].emf).toBeGreaterThanOrEqual(3);
  });

  it("1,5 s de aspirador no móvel expulsa o fantasma", () => {
    const s = createMatch(world, players, { hideSeconds: 0 });
    run(s, DT * 2);
    possess(s, "prop_01");
    const aim = hunterFacing(s, "prop_01");
    run(s, 1.7, () => ({ h0: { ...emptyIntent(aim.yaw, aim.pitch), fire: true } }));
    expect(s.ghosts[0].propId).toBeNull();
    expect(s.ghosts[0].health).toBeLessThan(G.maxHealth);
  });

  it("estamina acaba correndo e só volta a correr com 25", () => {
    const s = createMatch(world, players, { hideSeconds: 0 });
    run(s, DT * 2);
    const h = s.hunters[0];
    let yaw = 0;
    run(s, 6, () => {
      yaw += 0.15; // corre em círculos para não travar na parede
      return { h0: { ...emptyIntent(yaw), forward: 1, sprint: true } };
    });
    expect(h.exhausted).toBe(true);
    expect(h.sprinting).toBe(false);
  });
});

describe("Caçada Invertida", () => {
  it("Toque Gélido tira 34 de vida; três golpes derrubam e os fantasmas vencem", () => {
    const s = createMatch(world, players, { hideSeconds: 0.05, roundSeconds: 0.1 });
    run(s, 0.3);
    expect(s.phase).toBe("reversal");
    const g = s.ghosts[0];
    const h = s.hunters[0];
    // fantasma colado no caçador, na varanda (sem parede no meio)
    g.x = h.x;
    g.y = h.y;
    g.z = h.z + 1.2;
    const yaw = Math.atan2(h.x - g.x, h.z - g.z);
    run(s, 4, () => ({ g0: { ...emptyIntent(yaw), fire: true } }));
    expect(h.dead).toBe(true);
    expect(s.winner).toBe("ghost");
  });
});

describe("partida só com bots", () => {
  it("2 caçadores × 4 fantasmas jogam até o fim sem travar", () => {
    const slots: PlayerSlot[] = [
      ...[0, 1, 2, 3].map((i) => ({ id: `g${i}`, name: `F${i}`, team: "ghost" as const, bot: true })),
      ...[0, 1].map((i) => ({ id: `h${i}`, name: `C${i}`, team: "hunter" as const, bot: true })),
    ];
    const s = createMatch(world, slots, { roundSeconds: 90, reversalSeconds: 60 });
    const brains = slots.map((p, i) => createBotBrain(p.id, 1234 + i));
    let possessions = 0;
    let doorEvents = 0;
    for (let i = 0; i < 200 * BALANCE.tickRate && s.phase !== "ended"; i++) {
      const intents: Record<string, Intent> = {};
      for (const b of brains) intents[b.id] = botIntent(world, nav, s, b);
      stepMatch(world, s, intents, DT);
      possessions += s.events.filter((e) => e.type === "possess").length;
      doorEvents += s.events.filter((e) => e.type === "door").length;
    }
    expect(s.phase).toBe("ended");
    expect(s.winner).not.toBeNull();
    expect(possessions).toBeGreaterThan(3); // fantasmas acharam esconderijos
    expect(doorEvents).toBeGreaterThan(0); // caçadores abriram portas
  });
});

describe("movimento do fantasma", () => {
  /** Anda reto na direção perpendicular à parede (sinal +1/-1 no eixo dela) por alguns segundos. */
  function walk(s: MatchState, alongZ: boolean, sign: number, seconds: number) {
    const yaw = alongZ ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : sign > 0 ? 0 : Math.PI;
    run(s, seconds, () => ({ g0: { ...emptyIntent(yaw, 0), forward: 1 } }));
  }

  it("mirando a quina do batente, contorna e passa pela porta em vez de travar", () => {
    const fh = world.data.floorHeight;
    let tried = 0;
    const stuck: string[] = [];
    for (const d of world.doors) {
      const p = d.placement;
      // 15 cm para fora do vão, de frente para o batente: sem o desvio o fantasma fica parado ali
      for (const edge of [p.from - 0.15, p.to + 0.15]) {
        for (const sign of [1, -1]) {
          const s = createMatch(world, players);
          const g = s.ghosts[0];
          const place = (along: number) => {
            g.x = p.alongZ ? p.line - sign * 1.2 : along;
            g.z = p.alongZ ? along : p.line - sign * 1.2;
            g.y = d.floor * fh;
          };
          // controle: pelo meio do vão o caminho tem de estar livre (sem móvel na frente)
          place((p.from + p.to) / 2);
          walk(s, p.alongZ, sign, 1);
          const across = (p.alongZ ? g.x : g.z) - p.line;
          if (across * sign < 0.5) continue;
          tried++;
          const s2 = createMatch(world, players);
          s.ghosts = s2.ghosts;
          const g2 = s.ghosts[0];
          g2.x = p.alongZ ? p.line - sign * 1.2 : edge;
          g2.z = p.alongZ ? edge : p.line - sign * 1.2;
          g2.y = d.floor * fh;
          walk(s, p.alongZ, sign, 1.2);
          const crossed = ((p.alongZ ? g2.x : g2.z) - p.line) * sign;
          if (crossed < 0.5) stuck.push(`${d.id} ${edge.toFixed(2)} ${sign}`);
        }
      }
    }
    expect(tried).toBeGreaterThan(20);
    expect(stuck).toEqual([]);
  });

  it("de frente para uma parede lisa fica parado (não escorrega de lado)", () => {
    const win = buildWindows(world)[0];
    const s = createMatch(world, players);
    const g = s.ghosts[0];
    g.x = win.alongZ ? win.line - win.outward * 1.0 : win.center;
    g.z = win.alongZ ? win.center : win.line - win.outward * 1.0;
    g.y = win.floor * world.data.floorHeight;
    walk(s, win.alongZ, win.outward, 1);
    const along = win.alongZ ? g.z : g.x;
    expect(Math.abs(along - win.center)).toBeLessThan(0.05);
    expect(((win.alongZ ? g.x : g.z) - win.line) * win.outward).toBeLessThan(0);
  });
});
