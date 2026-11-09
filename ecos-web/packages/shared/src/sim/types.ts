import type { PropCategory, Vec3 } from "../data/mansion";
import type { SaltBox } from "../world/world";

export type Team = "ghost" | "hunter";
export type Phase = "hiding" | "hunting" | "reversal" | "ended";

/**
 * O que o jogador (ou bot) quer fazer neste passo. Como no expediente-caotico, o cliente só manda intenções;
 * quem decide dano, possessão e recargas é a simulação (no navegador agora, no servidor na etapa 2).
 * Os campos "botão" (interact, eject...) valem só no passo em que foram apertados.
 */
export interface Intent {
  forward: number; // -1..1
  right: number; // -1..1
  yaw: number; // radianos (direção da câmera)
  pitch: number; // radianos, > 0 olhando para cima
  sprint: boolean;
  fire: boolean; // segurando: aspirador (caçador) / Toque Gélido (fantasma na Caçada Invertida)
  aim: boolean;
  interact: boolean; // E: possuir/sair (fantasma), porta (caçador)
  eject: boolean; // Espaço: sair do móvel
  jump: boolean; // Q: Salto Espectral
  haunt: boolean; // R: Assombração Ativa / bater porta
  flashlight: boolean; // F
  thermal: boolean; // T
  salt: boolean; // G
  /** móvel mirado pelo cliente (possuir, saltar, assombrar) */
  targetPropId?: string | null;
  /** porta mirada pelo cliente */
  targetDoorId?: string | null;
}

export function emptyIntent(yaw = 0, pitch = 0): Intent {
  return {
    forward: 0,
    right: 0,
    yaw,
    pitch,
    sprint: false,
    fire: false,
    aim: false,
    interact: false,
    eject: false,
    jump: false,
    haunt: false,
    flashlight: false,
    thermal: false,
    salt: false,
  };
}

interface ActorBase {
  id: string;
  name: string;
  bot: boolean;
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  /** direção da câmera/mira */
  yaw: number;
  pitch: number;
  /** direção para onde o corpo está virado (visual) */
  bodyYaw: number;
  /** velocidade horizontal no último passo (animação) */
  speed: number;
  health: number;
}

export interface Ghost extends ActorBase {
  team: "ghost";
  exorcised: boolean;
  exorcisedAt: number;
  lastDamageAt: number;
  propId: string | null;
  possessTime: number;
  zone: Vec3 | null;
  zoneLeftAt: number;
  burned: Vec3 | null;
  burnedUntil: number;
  warned: boolean;
  exposedUntil: number;
  jumpReadyAt: number;
  hauntReadyAt: number;
  attackReadyAt: number;
  /** instante em que o golpe em preparo acerta (-1 = nenhum) */
  attackAt: number;
  lastAttackAt: number;
  expulsion: number;
  lastBeamAt: number;
  footX: number;
  footZ: number;
  footLeft: boolean;
  huntMode: boolean;
  emergedAt: number;
}

export interface Hunter extends ActorBase {
  team: "hunter";
  dead: boolean;
  diedAt: number;
  stamina: number;
  exhausted: boolean;
  lastSprintAt: number;
  sprinting: boolean;
  flashlight: boolean;
  thermal: boolean;
  salt: number;
  emf: number;
  /** ponta do feixe do aspirador, ou null se desligado */
  beam: Vec3 | null;
  aiming: boolean;
  lastHurtAt: number;
  canMove: boolean;
}

export type Actor = Ghost | Hunter;

export interface PropState {
  possessedBy: string | null;
  /** tremendo no aviso dos 15 s (visível para todos) */
  warning: boolean;
  decoyUntil: number;
  shakeUntil: number;
}

export interface Footprint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  left: boolean;
  at: number;
}

export interface MatchConfig {
  roundSeconds: number;
  hideSeconds: number;
  reversal: boolean;
  reversalSeconds: number;
}

export type GameEvent =
  | { type: "phase"; phase: Phase }
  | { type: "possess"; ghostId: string; propId: string }
  | { type: "eject"; ghostId: string; propId: string; forced: boolean }
  | { type: "warning"; ghostId: string; propId: string }
  | { type: "jump"; ghostId: string; from: string; to: string }
  | { type: "haunt"; ghostId: string; propId: string; category: PropCategory }
  | { type: "door"; doorId: string; open: boolean; slam: boolean }
  | { type: "exorcised"; ghostId: string }
  | { type: "attack"; ghostId: string }
  | { type: "hit"; hunterId: string; ghostId: string }
  | { type: "hunterDown"; hunterId: string }
  | { type: "salt"; hunterId: string; saltId: number }
  | { type: "end"; winner: Team; reason: string };

export interface MatchState {
  time: number;
  phase: Phase;
  hideRemaining: number;
  timeRemaining: number;
  reversalRemaining: number;
  config: MatchConfig;
  ghosts: Ghost[];
  hunters: Hunter[];
  props: Record<string, PropState>;
  doorsOpen: Record<string, boolean>;
  salt: SaltBox[];
  footprints: Footprint[];
  winner: Team | null;
  winReason: string;
  /** eventos do último passo (sons, efeitos e HUD) */
  events: GameEvent[];
  nextId: number;
  startedAt: number;
  endedAt: number;
}

export interface PlayerSlot {
  id: string;
  name: string;
  team: Team;
  bot: boolean;
}
