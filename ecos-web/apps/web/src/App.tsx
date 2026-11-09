import { useEffect, useState } from "react";
import { Game } from "./Game";
import { ROUND_OPTIONS, getSettings, subscribeSettings, updateSettings, type Quality, type Settings } from "./settings";

type Screen = "menu" | "setup" | "options" | "controls" | "game";

export function useSettings(): Settings {
  const [s, setS] = useState(getSettings());
  useEffect(() => subscribeSettings(setS), []);
  return s;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [gameKey, setGameKey] = useState(0);

  if (screen === "game") {
    return <Game key={gameKey} onExit={() => setScreen("menu")} onRestart={() => setGameKey((k) => k + 1)} />;
  }

  return (
    <div className="menu-bg">
      <div className="fog" aria-hidden />
      {screen === "menu" && <MainMenu go={setScreen} />}
      {screen === "setup" && <NewMatch onBack={() => setScreen("menu")} onStart={() => setScreen("game")} />}
      {screen === "options" && (
        <div className="center">
          <OptionsPanel onBack={() => setScreen("menu")} />
        </div>
      )}
      {screen === "controls" && (
        <div className="center">
          <ControlsPanel onBack={() => setScreen("menu")} />
        </div>
      )}
    </div>
  );
}

function MainMenu({ go }: { go: (s: Screen) => void }) {
  return (
    <main className="main-menu">
      <h1 className="title">Ecos do Além</h1>
      <p className="subtitle">Uma caçada assimétrica numa mansão vitoriana</p>
      <hr className="rule" />
      <nav className="menu-buttons">
        <button className="btn primary" onClick={() => go("setup")} autoFocus>
          Jogar
        </button>
        <button className="btn" onClick={() => go("options")}>
          Opções
        </button>
        <button className="btn" onClick={() => go("controls")}>
          Controles
        </button>
      </nav>
      <footer className="menu-footer">2 caçadores × 4 fantasmas · 58 móveis possuíveis · roda direto no navegador</footer>
    </main>
  );
}

function NewMatch({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  const s = useSettings();
  return (
    <div className="center">
      <section className="panel setup" aria-labelledby="setup-title">
        <h2 id="setup-title">Nova partida</h2>
        <div className="team-cards">
          <TeamCard
            team="ghost"
            selected={s.team === "ghost"}
            title="Fantasma"
            text="Possua móveis, salte entre esconderijos e engane o EMF. Sobreviva à busca; depois, a caçada se inverte."
          />
          <TeamCard
            team="hunter"
            selected={s.team === "hunter"}
            title="Caçador"
            text="Siga o EMF e as pegadas na câmera térmica, feche passagens com sal e exorcize todos com o aspirador."
          />
        </div>
        <label className="row">
          <span>Seu nome</span>
          <input className="text-input" maxLength={20} value={s.name} onChange={(e) => updateSettings({ name: e.target.value || "Você" })} />
        </label>
        <Selector label="Fantasmas na mansão" options={["1", "2", "3", "4"]} index={s.ghosts - 1} onChange={(i) => updateSettings({ ghosts: i + 1 })} />
        <Selector label="Caçadores" options={["1", "2"]} index={s.hunters - 1} onChange={(i) => updateSettings({ hunters: i + 1 })} />
        <Selector
          label="Duração da busca"
          options={ROUND_OPTIONS.map((m) => `${m} min`)}
          index={Math.max(0, ROUND_OPTIONS.indexOf(s.roundMinutes))}
          onChange={(i) => updateSettings({ roundMinutes: ROUND_OPTIONS[i] })}
        />
        <Selector label="Caçada Invertida" options={["Ligada (2 min)", "Desligada"]} index={s.reversal ? 0 : 1} onChange={(i) => updateSettings({ reversal: i === 0 })} />
        <p className="note">Os outros lugares são preenchidos por bots. O multiplayer em rede vem na próxima etapa.</p>
        <div className="actions">
          <button className="btn" onClick={onBack}>
            Voltar
          </button>
          <button className="btn primary" onClick={onStart}>
            Começar partida
          </button>
        </div>
      </section>
    </div>
  );
}

function TeamCard({ team, selected, title, text }: { team: "ghost" | "hunter"; selected: boolean; title: string; text: string }) {
  return (
    <button className={`team-card ${team} ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => updateSettings({ team })}>
      <span className="team-title">{title}</span>
      <span className="team-text">{text}</span>
    </button>
  );
}

export function Selector({ label, options, index, onChange }: { label: string; options: string[]; index: number; onChange: (i: number) => void }) {
  const n = options.length;
  return (
    <div className="row">
      <span>{label}</span>
      <div className="selector">
        <button className="btn small" aria-label={`${label}: anterior`} onClick={() => onChange((index - 1 + n) % n)}>
          ‹
        </button>
        <output>{options[index]}</output>
        <button className="btn small" aria-label={`${label}: próximo`} onClick={() => onChange((index + 1) % n)}>
          ›
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, text, onChange }: { label: string; value: number; min: number; max: number; step: number; text: string; onChange: (v: number) => void }) {
  return (
    <label className="row">
      <span>{label}</span>
      <div className="slider">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <output>{text}</output>
      </div>
    </label>
  );
}

const QUALITIES: Quality[] = ["baixa", "media", "alta"];
const QUALITY_LABEL: Record<Quality, string> = { baixa: "Baixa", media: "Média", alta: "Alta (sombras)" };

export function OptionsPanel({ onBack, inGame = false }: { onBack: () => void; inGame?: boolean }) {
  const s = useSettings();
  return (
    <section className="panel options" aria-labelledby="opt-title">
      <h2 id="opt-title">Opções</h2>
      <Slider label="Sensibilidade do mouse" value={s.sensitivity} min={0.25} max={3} step={0.05} text={`${s.sensitivity.toFixed(2)}×`} onChange={(v) => updateSettings({ sensitivity: v })} />
      <Selector label="Inverter eixo vertical" options={["Não", "Sim"]} index={s.invertY ? 1 : 0} onChange={(i) => updateSettings({ invertY: i === 1 })} />
      <Slider label="Volume geral" value={s.masterVolume} min={0} max={1} step={0.01} text={`${Math.round(s.masterVolume * 100)}%`} onChange={(v) => updateSettings({ masterVolume: v })} />
      <Slider label="Som ambiente da mansão" value={s.ambientVolume} min={0} max={1} step={0.01} text={`${Math.round(s.ambientVolume * 100)}%`} onChange={(v) => updateSettings({ ambientVolume: v })} />
      <Selector label="Qualidade gráfica" options={QUALITIES.map((q) => QUALITY_LABEL[q])} index={QUALITIES.indexOf(s.quality)} onChange={(i) => updateSettings({ quality: QUALITIES[i] })} />
      {inGame && <p className="note">A qualidade gráfica vale a partir da próxima partida.</p>}
      <div className="actions single">
        <button className="btn" onClick={onBack} autoFocus>
          Voltar
        </button>
      </div>
    </section>
  );
}

const GHOST_KEYS: [string, string][] = [
  ["W A S D", "Mover"],
  ["Mouse", "Câmera"],
  ["E", "Possuir o móvel mirado / sair"],
  ["Espaço", "Sair do móvel"],
  ["Q", "Salto Espectral (até 6 m)"],
  ["R", "Assombração Ativa · bater porta"],
  ["Botão esq.", "Toque Gélido (Caçada Invertida)"],
];
const HUNTER_KEYS: [string, string][] = [
  ["W A S D", "Andar"],
  ["Shift", "Correr (gasta estamina)"],
  ["Botão esq.", "Aspirador Ectoplásmico"],
  ["Botão dir.", "Mirar"],
  ["E", "Abrir / fechar porta"],
  ["F · T", "Lanterna · Câmera Térmica/UV"],
  ["G", "Sal Purificador (3 cargas)"],
];

export function ControlsPanel({ onBack }: { onBack: () => void }) {
  return (
    <section className="panel controls" aria-labelledby="ctl-title">
      <h2 id="ctl-title">Controles</h2>
      <div className="key-columns">
        <KeyList title="Fantasma · 3ª pessoa" team="ghost" keys={GHOST_KEYS} />
        <KeyList title="Caçador · 1ª pessoa" team="hunter" keys={HUNTER_KEYS} />
      </div>
      <p className="note">Clique na tela para prender o mouse. Esc ou P pausa. Regra dos 20 s: o fantasma não pode ficar no mesmo móvel (ou num raio de 2 m) por mais de 20 segundos.</p>
      <div className="actions single">
        <button className="btn" onClick={onBack} autoFocus>
          Voltar
        </button>
      </div>
    </section>
  );
}

function KeyList({ title, team, keys }: { title: string; team: string; keys: [string, string][] }) {
  return (
    <div className={`key-list ${team}`}>
      <h3>{title}</h3>
      <dl>
        {keys.map(([k, d]) => (
          <div key={k} className="key-row">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
