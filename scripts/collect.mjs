// Coleta os JSON de resultado do TSE (Brasil, UFs e municípios) e gera web/data/resultado.json.
// Uso: node scripts/collect.mjs [--eleicao 6258] [--loop 60] [--ate <segundos>] [--out web/data/resultado.json]
//   --post <url>  envia o resultado (POST, Bearer $UPDATE_TOKEN) quando ele muda, ex.: https://eleicoes.katz.rec.br/api/update
//   --ate <s>     encerra o loop depois de <s> segundos (usado no GitHub Actions)
//   6258 = Presidente, 2º turno 2026 (padrão). 6257 = 1º turno (útil para testar).
// O TSE limita a 100 req/s por IP; aqui usamos ~80 req/s.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const ELEICAO = args.eleicao ?? "6258";
const OUT = args.out ?? "web/data/resultado.json";
const LOOP = Number(args.loop ?? 0);
const POST = args.post;
const FIM = args.ate ? Date.now() + Number(args.ate) * 1000 : Infinity;
let ultimoEnviado = "";
const CICLO = "ele2026";
const BASE = `https://resultados.tse.jus.br/oficial/${CICLO}`;
const COD = `e${ELEICAO.padStart(6, "0")}`;
const CONCURRENCY = 40;
const MIN_INTERVALO_MS = 500; // por worker => ~80 req/s no total

// Candidatos pelo número na urna. Em 1º turno de teste, os demais ficam fora do mapa.
const CANDIDATOS = { 13: { id: "lula", nome: "Lula" }, 22: { id: "flavio", nome: "Flávio Bolsonaro" } };

const num = (s) => Number(String(s ?? "0").replace(",", "."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "apuracao-2t-2026 (github)" } });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
    } catch {}
    await sleep(500 * (i + 1));
  }
  return null;
}

// Reduz um arquivo -u.json de presidente a um objeto pequeno.
function resumir(d) {
  if (!d) return null;
  const cargo = d.carg?.[0];
  const votos = {};
  for (const agr of cargo?.agr ?? [])
    for (const par of agr.par ?? [])
      for (const c of par.cand ?? []) if (CANDIDATOS[c.n]) votos[CANDIDATOS[c.n].id] = num(c.vap);
  return {
    lula: votos.lula ?? 0,
    flavio: votos.flavio ?? 0,
    validos: num(d.v?.vv), // votos válidos (nominais + legenda)
    brancos: num(d.v?.vb),
    nulos: num(d.v?.tvn),
    secoes: num(d.s?.ts),
    apuradas: num(d.s?.st), // seções totalizadas
    atualizado: `${d.dg} ${d.hg}`,
  };
}

async function pool(itens, fn) {
  const resultados = new Array(itens.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < itens.length) {
        const idx = i++;
        const t0 = Date.now();
        resultados[idx] = await fn(itens[idx]);
        const resto = MIN_INTERVALO_MS - (Date.now() - t0);
        if (resto > 0) await sleep(resto);
      }
    }),
  );
  return resultados;
}

// Só envia quando algo mudou (o KV do Cloudflare grátis aceita ~1000 gravações/dia).
async function enviar(saida) {
  const corpo = JSON.stringify(saida);
  const assinatura = JSON.stringify({ ...saida, geradoEm: 0 });
  if (assinatura === ultimoEnviado) return console.log("  sem mudanças, não enviado");
  const res = await fetch(POST, { method: "POST", headers: { authorization: `Bearer ${process.env.UPDATE_TOKEN}` }, body: corpo });
  if (!res.ok) throw new Error(`envio falhou: ${res.status} ${await res.text()}`);
  ultimoEnviado = assinatura;
  console.log("  enviado");
}

async function coletar() {
  const t0 = Date.now();
  const cfg = await getJson(`${BASE}/${ELEICAO}/config/mun-${COD}-cm.json`);
  if (!cfg) throw new Error(`config de municípios não encontrada para a eleição ${ELEICAO}`);
  const dados = `${BASE}/${ELEICAO}/dados`;

  const brasil = resumir(await getJson(`${dados}/br/br-c0001-${COD}-u.json`));
  if (!brasil) return console.log(`[${new Date().toISOString()}] sem dados ainda para a eleição ${ELEICAO} (aguardando TSE)`);

  const ufs = {};
  const exterior = cfg.abr.find((a) => a.cd === "zz");
  const estados = cfg.abr.filter((a) => a.cd !== "zz");
  await pool(estados, async (a) => {
    ufs[a.cd.toUpperCase()] = resumir(await getJson(`${dados}/${a.cd}/${a.cd}-c0001-${COD}-u.json`));
  });
  if (exterior) ufs.ZZ = resumir(await getJson(`${dados}/zz/zz-c0001-${COD}-u.json`));

  // municípios: chave = código IBGE (7 dígitos); arquivo do TSE usa o código TSE (5 dígitos)
  const munis = estados.flatMap((a) => a.mu.map((m) => ({ uf: a.cd, tse: m.cd, ibge: m.cdi })));
  const municipios = {};
  // municípios já 100% apurados na coleta anterior não mudam mais: reaproveita (ciclos seguintes ficam bem mais rápidos)
  const anterior = await readFile(OUT, "utf8").then(JSON.parse, () => null);
  const prev = anterior?.eleicao === ELEICAO ? anterior.municipios : {};
  const pendentes = munis.filter((m) => {
    const p = prev[m.ibge];
    if (p && p[3] > 0 && p[4] === p[3]) return (municipios[m.ibge] = p), false;
    return true;
  });
  await pool(pendentes, async (m) => {
    const r = resumir(await getJson(`${dados}/${m.uf}/${m.uf}${m.tse}-c0001-${COD}-u.json`));
    if (r) municipios[m.ibge] = [r.lula, r.flavio, r.validos, r.secoes, r.apuradas];
  });

  const saida = {
    eleicao: ELEICAO,
    geradoEm: new Date().toISOString(),
    candidatos: CANDIDATOS,
    brasil,
    ufs,
    // municipios: { ibge: [lula, flavio, validos, secoes, apuradas] }
    municipios,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(`${OUT}.tmp`, JSON.stringify(saida));
  await rename(`${OUT}.tmp`, OUT);
  if (POST) await enviar(saida);
  console.log(
    `[${saida.geradoEm}] ok: ${Object.keys(ufs).length} UFs, ${Object.keys(municipios).length} municípios em ${((Date.now() - t0) / 1000).toFixed(1)}s (${pendentes.length} consultados)`,
  );
}

do {
  try {
    await coletar();
  } catch (e) {
    console.error("falha na coleta:", e.message);
    if (!LOOP) process.exitCode = 1;
  }
  if (LOOP) await sleep(LOOP * 1000);
} while (LOOP && Date.now() < FIM);
