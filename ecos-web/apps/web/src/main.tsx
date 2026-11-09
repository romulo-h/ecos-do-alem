import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Sem StrictMode: a sessão do jogo cria WebGL e áudio, e montar duas vezes em dev só atrapalha.
createRoot(document.getElementById("root")!).render(<App />);
