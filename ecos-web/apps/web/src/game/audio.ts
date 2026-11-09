import * as THREE from "three";

/**
 * Sons do jogo (os mesmos .wav do projeto Unity, em public/assets/audio).
 * Efeitos no mundo usam áudio posicional preso ao ouvinte da câmera; alertas do jogador local são 2D.
 */

export const SOUNDS = {
  ambient: "mansao_drone_ambiente.wav",
  emf: "emf_detector_beep.wav",
  clock: "relogio_pendulo_tic_tac.wav",
  haunt: "interacao_movel_assombrado.wav",
  glass: "copo_tilintando.wav",
  plant: "planta_farfalhar.wav",
  creak: "porta_rangendo.wav",
  slam: "porta_batendo.wav",
  warning: "fantasma_instabilidade_alerta.wav",
  eject: "fantasma_ejecao_forcada.wav",
  reversal: "inversao_cacada.wav",
  attack: "ataque_fantasma.wav",
  hurt: "cacador_ferido.wav",
} as const;

export type SoundName = keyof typeof SOUNDS;

export class GameAudio {
  readonly listener = new THREE.AudioListener();
  private buffers = new Map<SoundName, AudioBuffer>();
  private ambient: THREE.Audio | null = null;
  private loops: THREE.PositionalAudio[] = [];
  private ambientVolume = 0.5;

  async load(): Promise<void> {
    const loader = new THREE.AudioLoader();
    await Promise.all(
      (Object.keys(SOUNDS) as SoundName[]).map(
        (k) =>
          new Promise<void>((resolve) => {
            loader.load(
              `/assets/audio/${SOUNDS[k]}`,
              (buf) => {
                this.buffers.set(k, buf);
                resolve();
              },
              undefined,
              () => resolve(), // som faltando não impede o jogo
            );
          }),
      ),
    );
  }

  setVolumes(master: number, ambient: number) {
    this.listener.setMasterVolume(master);
    this.ambientVolume = ambient;
    this.ambient?.setVolume(ambient);
  }

  startAmbient() {
    const buf = this.buffers.get("ambient");
    if (!buf || this.ambient) return;
    this.ambient = new THREE.Audio(this.listener);
    this.ambient.setBuffer(buf);
    this.ambient.setLoop(true);
    this.ambient.setVolume(this.ambientVolume);
    this.ambient.play();
  }

  setAmbientPitch(rate: number) {
    this.ambient?.setPlaybackRate(rate);
  }

  /** Som 2D (só para o jogador local). */
  play2D(name: SoundName, volume = 1, rate = 1) {
    const buf = this.buffers.get(name);
    if (!buf) return;
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.play();
    a.onEnded = () => a.disconnect();
  }

  /** Som no mundo: o volume cai com a distância até a câmera. */
  playAt(scene: THREE.Scene, name: SoundName, x: number, y: number, z: number, volume = 1, maxDistance = 18) {
    const buf = this.buffers.get(name);
    if (!buf) return;
    const holder = new THREE.Object3D();
    holder.position.set(x, y, z);
    scene.add(holder);
    const a = new THREE.PositionalAudio(this.listener);
    a.setBuffer(buf);
    a.setRefDistance(1.5);
    a.setMaxDistance(maxDistance);
    a.setDistanceModel("linear");
    a.setRolloffFactor(1);
    a.setVolume(volume);
    holder.add(a);
    a.play();
    a.onEnded = () => {
      a.disconnect();
      scene.remove(holder);
    };
  }

  /** Som contínuo preso a um objeto (tic-tac dos relógios). */
  loopOn(obj: THREE.Object3D, name: SoundName, volume = 0.5, maxDistance = 10) {
    const buf = this.buffers.get(name);
    if (!buf) return;
    const a = new THREE.PositionalAudio(this.listener);
    a.setBuffer(buf);
    a.setLoop(true);
    a.setRefDistance(1);
    a.setMaxDistance(maxDistance);
    a.setDistanceModel("linear");
    a.setVolume(volume);
    obj.add(a);
    a.play();
    this.loops.push(a);
  }

  suspend() {
    void this.listener.context.suspend();
  }

  resume() {
    void this.listener.context.resume();
  }

  dispose() {
    this.ambient?.stop();
    for (const l of this.loops) if (l.isPlaying) l.stop();
    this.loops = [];
    this.ambient = null;
  }
}
