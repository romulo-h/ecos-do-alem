import { useEffect, useRef, useState } from "react";
import { ControlsPanel, OptionsPanel } from "./App";
import { GameSession, type HudState, type MatchResult } from "./game/session";

type Overlay = "pause" | "options" | "controls" | null;

export function Game({ onExit, onRestart }: { onExit: () => void; onRestart: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<GameSession | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [result, setResult] = useState<MatchResult | null>(null);

  useEffect(() => {
    const s = new GameSession(host.current!, {
      onHud: setHud,
      onPause: (p) => setOverlay(p ? "pause" : null),
      onEnd: setResult,
      onLoaded: () => setLoaded(true),
    });
    session.current = s;
    // só em desenvolvimento: deixa testes e depuração lerem o estado da partida pelo console
    if (import.meta.env.DEV) (window as unknown as { __ecos?: GameSession }).__ecos = s;
    void s.start();
    return () => s.dispose();
  }, []);

  const resume = () => session.current?.resume();

  return (
    <div className="game" ref={host}>
      {!loaded && <div className="loading">Abrindo a mansão…</div>}
      {loaded && hud && !result && <Hud h={hud} />}
      {loaded && hud && !hud.started && (
        <button className="click-to-play" onClick={() => session.current?.requestLock()}>
          <strong>Clique para começar</strong>
          <span>{hud.team === "ghost" ? "Você é um fantasma: esconda-se num móvel antes dos caçadores entrarem." : "Você é um caçador: espere os fantasmas se esconderem e comece a busca."}</span>
        </button>
      )}
      {loaded && hud?.started && !hud.locked && !overlay && !result && (
        <button className="click-to-play subtle" onClick={() => session.current?.requestLock()}>
          <strong>Clique para continuar controlando</strong>
        </button>
      )}

      {overlay && (
        <div className="overlay dim">
          {overlay === "pause" && (
            <section className="panel pause" aria-labelledby="pause-title">
              <h2 id="pause-title">Pausado</h2>
              <p className="phase-line">{hud ? phaseLine(hud) : ""}</p>
              <button className="btn primary" onClick={resume} autoFocus>
                Continuar
              </button>
              <button className="btn" onClick={() => setOverlay("options")}>
                Opções
              </button>
              <button className="btn" onClick={() => setOverlay("controls")}>
                Controles
              </button>
              <button className="btn" onClick={onRestart}>
                Reiniciar partida
              </button>
              <button className="btn" onClick={onExit}>
                Menu principal
              </button>
            </section>
          )}
          {overlay === "options" && <OptionsPanel inGame onBack={() => setOverlay("pause")} />}
          {overlay === "controls" && <ControlsPanel onBack={() => setOverlay("pause")} />}
        </div>
      )}

      {result && <Results r={result} onRestart={onRestart} onExit={onExit} />}
    </div>
  );
}

function clock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function phaseLine(h: HudState) {
  if (h.phase === "hiding") return `Fase de esconderijo · ${clock(h.hideRemaining)}`;
  if (h.phase === "hunting") return `Busca · ${clock(h.timeRemaining)} restantes`;
  if (h.phase === "reversal") return `Caçada Invertida · ${clock(h.reversalRemaining)} restantes`;
  return "";
}

function Bar({ value, label, kind, thin = false }: { value: number; label?: string; kind: string; thin?: boolean }) {
  return (
    <div className={`bar ${kind} ${thin ? "thin" : ""}`} role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      {label && <span>{label}</span>}
    </div>
  );
}

function Hud({ h }: { h: HudState }) {
  const rev = h.phase === "reversal";
  const g = h.ghost;
  const hu = h.hunter;

  // caçador cego enquanto os fantasmas se escondem
  if (hu && h.phase === "hiding" && h.started) {
    return (
      <div className="hud blind">
        <p className="big">Os fantasmas estão se escondendo…</p>
        <p className="count">{Math.ceil(h.hideRemaining)} s</p>
      </div>
    );
  }

  const time = rev ? h.reversalRemaining : h.phase === "hiding" ? h.hideRemaining : h.timeRemaining;
  return (
    <div className="hud">
      {hu?.thermal && <div className="tint thermal" />}
      {g?.warning && <div className="tint warning" />}
      {hu && hu.hurt > 0 && <div className="tint hurt" style={{ opacity: hu.hurt * 0.55 }} />}
      {hu?.dead && <div className="tint dead" />}

      <header className={`top ${rev ? "reversal" : ""}`}>
        <span className="phase">{h.phase === "hiding" ? "Esconderijo" : rev ? "Caçada Invertida" : "Busca"}</span>
        <span className="timer">{clock(time)}</span>
        <span className="counts">
          Fantasmas {h.aliveGhosts}/{h.totalGhosts} · Caçadores {h.aliveHunters}/{h.totalHunters}
        </span>
      </header>
      <div className="corner-hint">
        Esc ou P · Pausar{h.room ? <em> · {h.room}</em> : null}
      </div>

      {h.reversalBanner > 0 && (
        <div className="banner" style={{ opacity: h.reversalBanner }}>
          <strong>A caçada se inverteu!</strong>
          <span>{hu ? "Seu aspirador está sem bateria. Fuja e sobreviva!" : "Agora você caça. [Botão esq.] Toque Gélido"}</span>
        </div>
      )}

      {!(hu?.dead || g?.exorcised) && <div className="crosshair" aria-hidden />}
      {h.prompt && <div className="prompt">{h.prompt}</div>}

      {g && (
        <>
          {g.exorcised && <p className="center-msg">Você foi exorcizado.</p>}
          {g.exposed && <p className="exposed">Exposto!</p>}
          <div className="dock left">
            <Bar value={g.health} label="Ectoplasma" kind="ecto" />
            {g.possessing && (
              <>
                <Bar value={g.possessTime / g.maxStay} label={`Instabilidade ${g.possessTime.toFixed(1)}/${g.maxStay}s`} kind={g.warning ? "danger" : "warn"} />
                {g.expulsion > 0 && <Bar value={g.expulsion} kind="beam" thin />}
                <p className="line">
                  Possuindo: <b>{g.propName}</b> ({g.roomName})
                </p>
              </>
            )}
            {!g.possessing && !g.huntMode && <p className="line">Mire num móvel e aperte E · portas não te seguram</p>}
          </div>
          <div className="dock right">
            {g.huntMode ? <Cooldown k="Botão esq." name="Toque Gélido" cd={g.attackCd} /> : <Cooldown k="Q" name="Salto Espectral" cd={g.jumpCd} />}
            <Cooldown k="R" name="Assombração" cd={g.hauntCd} />
          </div>
        </>
      )}

      {hu && (
        <>
          {hu.dead && <p className="center-msg">Você foi pego pelos fantasmas.</p>}
          <div className="dock left">
            <Bar value={hu.health} label="Vida" kind="life" />
            <Bar value={hu.stamina} kind={hu.exhausted ? "tired" : "stamina"} thin />
            {hu.flee && <p className="line alert">Aspirador sem bateria. Fuja! [Shift] correr · [G] sal</p>}
            <p className="line">
              <kbd>F</kbd> Lanterna {hu.flashlight ? "ligada" : "desligada"} · <kbd>T</kbd> Térmica {hu.thermal ? "ligada" : "desligada"} · <kbd>G</kbd> Sal ×{hu.salt}
            </p>
          </div>
          <div className="dock right emf" aria-label={`EMF nível ${hu.emf}`}>
            <span>EMF</span>
            <div className="emf-leds">
              {[1, 2, 3, 4, 5].map((i) => (
                <i key={i} className={i <= hu.emf ? `on l${i}` : ""} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Cooldown({ k, name, cd }: { k: string; name: string; cd: number }) {
  return (
    <p className={`cooldown ${cd > 0 ? "" : "ready"}`}>
      <kbd>{k}</kbd> {name}: {cd > 0 ? `${cd.toFixed(cd < 2 ? 1 : 0)}s` : "pronto"}
    </p>
  );
}

function Results({ r, onRestart, onExit }: { r: MatchResult; onRestart: () => void; onExit: () => void }) {
  return (
    <div className="overlay results">
      <h2 className={r.winner}>{r.winner === "ghost" ? "Vitória dos fantasmas" : "Vitória dos caçadores"}</h2>
      <p className="reason">{r.reason}</p>
      <p className={`personal ${r.won ? "won" : "lost"}`}>{r.won ? "Você venceu!" : "Você perdeu."}</p>
      <dl className="panel stats">
        <div>
          <dt>Fantasmas livres</dt>
          <dd>
            {r.ghostsAlive} / {r.ghostsTotal}
          </dd>
        </div>
        <div>
          <dt>Caçadores de pé</dt>
          <dd>
            {r.huntersAlive} / {r.huntersTotal}
          </dd>
        </div>
        <div>
          <dt>Duração da partida</dt>
          <dd>{clock(r.duration)}</dd>
        </div>
        <div>
          <dt>Seu destino</dt>
          <dd>{r.fate}</dd>
        </div>
      </dl>
      <div className="actions">
        <button className="btn primary" onClick={onRestart} autoFocus>
          Jogar de novo
        </button>
        <button className="btn" onClick={onExit}>
          Menu principal
        </button>
      </div>
    </div>
  );
}
