// Cloudflare Worker: serve o site estático (web/) e o resultado mais recente guardado no KV.
// O coletor (GitHub Actions ou qualquer máquina) envia o JSON por POST /api/update com Bearer UPDATE_TOKEN.
const CHAVE = "resultado";

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (pathname === "/data/resultado.json" && req.method === "GET") {
      const corpo = await env.RESULTADO.get(CHAVE, { cacheTtl: 30 });
      if (!corpo) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      return new Response(corpo, { headers: { "content-type": "application/json", "cache-control": "public, max-age=15" } });
    }

    if (pathname === "/api/update" && req.method === "POST") {
      if (!env.UPDATE_TOKEN || req.headers.get("authorization") !== `Bearer ${env.UPDATE_TOKEN}`)
        return new Response("não autorizado", { status: 401 });
      const corpo = await req.text();
      try {
        const d = JSON.parse(corpo);
        if (!d.brasil || !d.ufs || !d.municipios) throw new Error("formato inválido");
      } catch (e) {
        return new Response(`JSON inválido: ${e.message}`, { status: 400 });
      }
      await env.RESULTADO.put(CHAVE, corpo);
      return new Response("ok");
    }

    return env.ASSETS.fetch(req);
  },
};
