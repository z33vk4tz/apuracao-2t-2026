// Servidor estático mínimo para desenvolvimento: npm run dev -> http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const raiz = new URL("../web/", import.meta.url).pathname;
createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const arq = join(raiz, p.endsWith("/") ? p + "index.html" : p);
    res.writeHead(200, { "content-type": TIPOS[extname(arq)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(arq));
  } catch {
    res.writeHead(404).end("não encontrado");
  }
}).listen(8080, () => console.log("http://localhost:8080"));
