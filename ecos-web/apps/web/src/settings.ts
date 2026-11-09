import type { Team } from "@ecos/shared";

/**
 * Configurações do jogador e escolhas da última partida, salvas no navegador.
 * Única fonte das teclas: o jogo e a tela de Controles leem daqui.
 */

export type Quality = "baixa" | "media" | "alta";

export interface Settings {
  name: string;
  team: Team;
  ghosts: number; // 1..4
  hunters: number; // 1..2
  roundMinutes: number;
  reversal: boolean;
  sensitivity: number; // multiplicador
  invertY: boolean;
  masterVolume: number; // 0..1
  ambientVolume: number; // 0..1
  quality: Quality;
}

export const ROUND_OPTIONS = [3, 6, 9, 12];

export const DEFAULT_SETTINGS: Settings = {
  name: "Você",
  team: "hunter",
  ghosts: 4,
  hunters: 2,
  roundMinutes: 6,
  reversal: true,
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  ambientVolume: 0.5,
  quality: "media",
};

export const KEYS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  sprint: "ShiftLeft",
  interact: "KeyE",
  eject: "Space",
  jump: "KeyQ",
  haunt: "KeyR",
  flashlight: "KeyF",
  thermal: "KeyT",
  salt: "KeyG",
  pause: "KeyP",
} as const;

const STORAGE_KEY = "ecos.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    s.ghosts = clampInt(s.ghosts, 1, 4);
    s.hunters = clampInt(s.hunters, 1, 2);
    if (!ROUND_OPTIONS.includes(s.roundMinutes)) s.roundMinutes = 6;
    s.sensitivity = Math.min(3, Math.max(0.25, Number(s.sensitivity) || 1));
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clampInt(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, Math.round(Number(v) || a)));
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // modo privado ou armazenamento bloqueado: segue sem salvar
  }
  for (const l of listeners) l(current);
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
