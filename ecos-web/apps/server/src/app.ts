import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Servidor de produção, no mesmo formato do expediente-caotico: entrega o build do cliente e responde
 * /health para o Coolify. Em dev o Vite cuida de tudo. A etapa 2 (salas multiplayer por WebSocket) entra aqui.
 */

/** dist/index.js -> ../../web/dist (mesmo layout no monorepo e na imagem Docker) */
const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".obj": "text/plain; charset=utf-8",
  ".mtl": "text/plain; charset=utf-8",
};

/** Arquivo com hash no nome (gerado pelo Vite em /assets): nunca muda, pode ficar em cache para sempre. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css)$/;

function cacheHeader(file: string): Record<string, string> {
  if (extname(file) === ".html") return { "cache-control": "no-cache" }; // o app novo chega no próximo acesso
  if (HASHED.test(file)) return { "cache-control": "public, max-age=31536000, immutable" };
  return { "cache-control": "public, max-age=3600" }; // modelos e sons
}

/** Serve o build do cliente. Caminho desconhecido cai no index.html; nada sai de dentro de `root`. */
function serveStatic(url: string, res: ServerResponse, root: string, head: boolean): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.split("?")[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const path = normalize(decoded).replace(/^([/\\])+/, "");
  let file = join(root, path);
  const inside = file === root || file.startsWith(root + sep);
  if (!inside || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  if (!existsSync(file)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Servidor do Ecos do Além no ar, mas sem o build do cliente. Rode pnpm build.");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": statSync(file).size,
    "x-content-type-options": "nosniff",
    ...cacheHeader(file),
  });
  if (head) res.end();
  else createReadStream(file).pipe(res);
}

export interface ServerOptions {
  /** pasta do build do cliente (padrão: apps/web/dist) */
  webDist?: string;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

export function startServer(port: number, opts: ServerOptions = {}): Promise<RunningServer> {
  const webDist = resolve(opts.webDist ?? WEB_DIST);
  const http: Server = createServer((req, res) => {
    try {
      const method = req.method ?? "GET";
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/health") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      serveStatic(req.url ?? "/", res, webDist, method === "HEAD");
    } catch (err) {
      console.error("erro http", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  return new Promise((ok, fail) => {
    http.once("error", fail);
    http.listen(port, () => {
      const addr = http.address();
      ok({
        port: typeof addr === "object" && addr ? addr.port : port,
        close: () => new Promise((done) => http.close(() => done())),
      });
    });
  });
}
