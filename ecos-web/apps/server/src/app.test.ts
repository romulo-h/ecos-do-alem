import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "./app";

describe("servidor de produção", () => {
  let root: string;
  let dist: string;
  let srv: RunningServer;
  let base: string;

  beforeAll(async () => {
    // root/dist é o build; root/segredo.txt fica do lado de fora e não pode vazar
    root = mkdtempSync(join(tmpdir(), "ecos-srv-"));
    dist = join(root, "dist");
    mkdirSync(join(dist, "assets", "moveis"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Ecos</title>");
    writeFileSync(join(dist, "assets", "index-AbCd1234.js"), "console.log(1)");
    writeFileSync(join(dist, "assets", "moveis", "pia.obj"), "v 0 0 0");
    writeFileSync(join(root, "segredo.txt"), "não pode sair");
    srv = await startServer(0, { webDist: dist });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("responde /health para o Coolify", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("entrega o index.html sem cache e cai nele em caminho desconhecido", async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    const r2 = await fetch(`${base}/qualquer/coisa`);
    expect(await r2.text()).toContain("<title>Ecos</title>");
  });

  it("bundle com hash fica em cache para sempre; modelos chegam com o conteúdo certo", async () => {
    const js = await fetch(`${base}/assets/index-AbCd1234.js`);
    expect(js.headers.get("content-type")).toBe("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    const obj = await fetch(`${base}/assets/moveis/pia.obj`);
    expect(obj.status).toBe(200);
    expect(await obj.text()).toBe("v 0 0 0");
  });

  it("não deixa sair da pasta do build", async () => {
    for (const p of ["/../segredo.txt", "/%2e%2e/segredo.txt", "/..%2fsegredo.txt", "/..%5csegredo.txt"]) {
      const r = await fetch(`${base}${p}`);
      expect(await r.text()).not.toContain("não pode sair");
    }
  });

  it("recusa métodos que não são leitura", async () => {
    const r = await fetch(`${base}/`, { method: "POST" });
    expect(r.status).toBe(405);
  });
});
