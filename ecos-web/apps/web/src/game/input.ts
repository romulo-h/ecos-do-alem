import { KEYS } from "../settings";

/**
 * Teclado e mouse. O mouse só gira a câmera com o ponteiro preso (clique na tela).
 * Botões de toque único (E, Q, R...) ficam guardados até a simulação consumir no próximo passo.
 */
export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  fire = false;
  aim = false;
  private firePressed = false;
  pointerLocked = false;
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  onPauseKey: (() => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
    target.addEventListener("mousedown", this.mouseDown);
    window.addEventListener("mouseup", this.mouseUp);
    document.addEventListener("mousemove", this.mouseMove);
    document.addEventListener("pointerlockchange", this.lockChange);
    target.addEventListener("contextmenu", this.noMenu);
  }

  dispose() {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    this.target.removeEventListener("mousedown", this.mouseDown);
    window.removeEventListener("mouseup", this.mouseUp);
    document.removeEventListener("mousemove", this.mouseMove);
    document.removeEventListener("pointerlockchange", this.lockChange);
    this.target.removeEventListener("contextmenu", this.noMenu);
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  requestLock() {
    if (document.pointerLockElement !== this.target) {
      const r = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => undefined);
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  /** Foi apertado desde o último consumo (e limpa). */
  take(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
    this.fire = false;
    this.aim = false;
    this.firePressed = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  axis(neg: string, pos: string): number {
    return (this.down.has(pos) ? 1 : 0) - (this.down.has(neg) ? 1 : 0);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (e.code === "Tab") e.preventDefault();
    if (e.code === KEYS.pause && !e.repeat) {
      this.onPauseKey?.();
      return;
    }
    if (!this.pointerLocked) return;
    if (e.code === "Space") e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private keyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private blur = () => this.clear();

  private mouseDown = (e: MouseEvent) => {
    if (!this.pointerLocked) {
      this.requestLock();
      return;
    }
    if (e.button === 0) {
      this.fire = true;
      this.firePressed = true;
    }
    if (e.button === 2) this.aim = true;
  };

  private mouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.fire = false;
    if (e.button === 2) this.aim = false;
  };

  private mouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private lockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.target;
    if (!this.pointerLocked) this.clear();
    this.onPointerLockChange?.(this.pointerLocked);
  };

  private noMenu = (e: Event) => e.preventDefault();
}
