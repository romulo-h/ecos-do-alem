/**
 * Todos os números de balanceamento do jogo. Vieram do projeto Unity (GhostController, HunterController,
 * GhostGameManager, PossessableProp) e da tabela "Regras Detalhadas" do game design.
 */
export const BALANCE = {
  /** Passos da simulação por segundo (o servidor da etapa 2 usa o mesmo valor). */
  tickRate: 30,

  match: {
    hidePhase: 15, // s livres para os fantasmas; NÃO descontados da busca
    round: 360, // 6 min de busca
    reversal: 120, // 2 min de Caçada Invertida
  },

  world: {
    gravity: 18,
    stepUp: 0.45, // degrau que o personagem sobe sem pular
    stepDown: 0.6, // desce "grudado" no chão (escada) até esta altura
    slab: 0.2,
    upperFloorY: 2.0, // acima disto o personagem está no 1º andar
  },

  ghost: {
    radius: 0.35,
    height: 1.6,
    speed: 5.0,
    huntSpeed: 5.6,
    maxStay: 20, // regra dos 20 s
    warning: 15, // tremor + pulso vermelho
    zoneRadius: 2,
    zoneMemory: 10, // a zona "lembra" o tempo por 10 s; também é o bloqueio após expulsão
    possessRange: 3.5,
    exposed: 3,
    jumpRange: 6,
    jumpCooldown: 20,
    hauntCooldown: 12,
    hauntRange: 3.5,
    maxHealth: 100,
    beamOnProp: 10, // dano/s do aspirador com o fantasma dentro do móvel
    beamEthereal: 35, // dano/s na forma etérea
    exposedMultiplier: 1.5,
    expulsionTime: 1.5, // s de feixe contínuo no móvel para expulsar
    expulsionDecay: 1, // o medidor esvazia nesta taxa sem feixe
    regenDelay: 4,
    regen: 5,
    footprintSpacing: 0.8,
    footprintLife: 12,
    attackRange: 1.8,
    attackAngle: 70, // meio-ângulo do cone, em graus
    attackDamage: 34,
    attackCooldown: 1.1,
    attackWindup: 0.25, // o dano sai no instante do golpe
  },

  hunter: {
    radius: 0.35,
    height: 1.8,
    eye: 1.65,
    walk: 3.8,
    sprint: 6.2,
    maxHealth: 100,
    maxStamina: 100,
    staminaDrain: 20,
    staminaRegen: 15,
    staminaRegenDelay: 0.8,
    staminaRecover: 25, // esgotou: só volta a correr com esta estamina
    emfRange: 6.5,
    emfVerticalWeight: 1.5,
    beamRange: 6,
    saltCharges: 3,
    saltRange: 3,
    saltDuration: 20,
    saltWidth: 1.6,
    saltHeight: 2.4,
    saltDepth: 0.4,
    interactRange: 2.5,
    fovNormal: 75,
    fovAim: 50,
  },

  prop: {
    decoyEmf: 6, // a Assombração "acende" o EMF do móvel por 6 s, mesmo vazio
    hauntShake: 0.8,
  },
} as const;
