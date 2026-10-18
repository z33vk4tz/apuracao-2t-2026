// Painel de apuração. Lê data/resultado.json (gerado por scripts/collect.mjs) e desenha placar + mapas.
const UFS = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN",
  25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC",
  43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
};
const NOMES_UF = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
const REFRESH_MS = 30_000;
const MARGEM_SATURADA = { uf: 0.3, municipio: 0.5 }; // margem (em fração dos válidos) em que a cor chega ao máximo

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("pt-BR");
const pct = (x, d = 2) => (isFinite(x) ? (x * 100).toFixed(d).replace(".", ",") + "%" : "–");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let dados = null;
let geo = {};
let ufSelecionada = "";
let modo = "margem"; // margem | lider | lula | flavio
const MODOS = {
  margem: "Tons por margem (vermelho/azul)",
  lider: "Cor única por líder (vermelho/azul)",
  lula: "Só Lula: tons de vermelho pelo % de votos",
  flavio: "Só Flávio: tons de azul pelo % de votos",
};

// --- cores ---------------------------------------------------------------
function cor(lula, flavio, validos, escala) {
  if (!validos || lula + flavio === 0) return css("--vazio");
  const vazio = css("--vazio");
  if (modo === "lider") return lula === flavio ? vazio : lula > flavio ? css("--lula") : css("--flavio");
  if (modo === "lula" || modo === "flavio") {
    // um tom só: quanto maior o % do candidato entre os válidos, mais forte (20% -> claro, 80% -> cheio)
    const p = (modo === "lula" ? lula : flavio) / validos;
    const t = Math.max(0, Math.min((p - 0.2) / 0.6, 1));
    return d3.interpolateRgb(vazio, css(modo === "lula" ? "--lula" : "--flavio"))(0.12 + 0.88 * t);
  }
  const margem = (lula - flavio) / validos;
  const t = Math.min(Math.abs(margem) / escala, 1);
  const base = margem > 0 ? css("--lula") : css("--flavio");
  // do cinza-neutro à cor cheia; margens apertadas ficam quase neutras
  return d3.interpolateRgb(vazio, base)(0.2 + 0.8 * t);
}

// --- placar --------------------------------------------------------------
const BRASIL_VAZIO = { lula: 0, flavio: 0, validos: 0, brancos: 0, nulos: 0, secoes: 0, apuradas: 0 };
function placar() {
  const b = dados?.brasil ?? BRASIL_VAZIO;
  const pl = b.validos ? b.lula / b.validos : 0, pf = b.validos ? b.flavio / b.validos : 0;
  const lider = b.lula === b.flavio ? "" : b.lula > b.flavio ? "lula" : "flavio";
  const card = (id, nome, votos, p) => `
    <div class="cand ${id} ${lider === id ? "lider" : ""}">
      <h2>${nome}</h2>
      <div class="pct">${pct(p)}</div>
      <div class="votos">${fmt.format(votos)} votos</div>
    </div>`;
  $("#placar").innerHTML = `
    <div class="cands">${card("lula", "Lula (PT)", b.lula, pl)}${card("flavio", "Flávio Bolsonaro (PL)", b.flavio, pf)}</div>
    <div class="barra" aria-hidden="true"><div class="l" style="width:${pl * 100}%"></div><div class="f" style="width:${pf * 100}%"></div></div>
    <div class="meta">
      <span>Seções apuradas: <b>${b.secoes ? pct(b.apuradas / b.secoes) : "0,00%"}</b> (${fmt.format(b.apuradas)} de ${fmt.format(b.secoes)})</span>
      <span>Votos válidos: <b>${fmt.format(b.validos)}</b></span>
      <span>Brancos: <b>${fmt.format(b.brancos)}</b></span>
      <span>Nulos: <b>${fmt.format(b.nulos)}</b></span>
      <span>Diferença: <b>${fmt.format(Math.abs(b.lula - b.flavio))}</b></span>
    </div>`;
  if (!dados) return;
  const teste = dados.eleicao !== "6258" ? "⚠ DADOS DE TESTE (1º turno) · " : "";
  $("#status").textContent = `${teste}Última atualização do TSE: ${b.atualizado} · painel atualizado ${new Date(dados.geradoEm).toLocaleTimeString("pt-BR")}`;
}

// --- mapas ---------------------------------------------------------------
const tip = Object.assign(document.createElement("div"), { id: "tip" });
document.body.append(tip);
function mostrarTip(ev, html) {
  tip.innerHTML = html;
  tip.style.display = "block";
  tip.style.left = Math.min(ev.clientX + 12, innerWidth - 220) + "px";
  tip.style.top = ev.clientY + 12 + "px";
}
const esconderTip = () => (tip.style.display = "none");

function htmlTip(nome, lula, flavio, validos, secoes, apuradas) {
  return `<b>${nome}</b><br>
    Lula: ${fmt.format(lula)} (${pct(lula / validos)})<br>
    Flávio: ${fmt.format(flavio)} (${pct(flavio / validos)})<br>
    Seções apuradas: ${pct(apuradas / secoes, 1)}`;
}

function desenhar(svgSel, features, corDe, tipDe, w = 600, h = 640) {
  const svg = d3.select(svgSel).attr("viewBox", `0 0 ${w} ${h}`);
  const fc = { type: "FeatureCollection", features };
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitSize([w, h], fc));
  const sel = svg.selectAll("path").data(features, (d) => d.id);
  sel.exit().remove();
  sel.enter().append("path")
    .on("mousemove", (ev, d) => mostrarTip(ev, tipDe(d)))
    .on("mouseleave", esconderTip)
    .merge(sel)
    .attr("d", path)
    .attr("fill", corDe);
}

function mapas() {
  const ufDados = (id) => dados?.ufs[UFS[id]];
  desenhar(
    "#mapa-ufs",
    geo.ufs,
    (d) => { const u = ufDados(d.id); return u ? cor(u.lula, u.flavio, u.validos, MARGEM_SATURADA.uf) : css("--vazio"); },
    (d) => { const u = ufDados(d.id); return u ? htmlTip(NOMES_UF[UFS[d.id]], u.lula, u.flavio, u.validos, u.secoes, u.apuradas) : NOMES_UF[UFS[d.id]]; },
  );
  const feats = ufSelecionada ? geo.municipios.filter((f) => UFS[f.id.slice(0, 2)] === ufSelecionada) : geo.municipios;
  desenhar(
    "#mapa-municipios",
    feats,
    (d) => { const m = dados?.municipios[d.id]; return m ? cor(m[0], m[1], m[2], MARGEM_SATURADA.municipio) : css("--vazio"); },
    (d) => { const m = dados?.municipios[d.id]; const nome = geo.nomes[d.id] ?? d.id; return m ? htmlTip(nome, m[0], m[1], m[2], m[3], m[4]) : nome; },
  );
}

function legenda() {
  const v = css("--vazio"), l = css("--lula"), f = css("--flavio");
  const rampa = { margem: [f, v, l], lider: [f, f, l, l], lula: [v, l], flavio: [v, f] }[modo];
  const [esq, dir] = {
    margem: ["Flávio à frente", "Lula à frente"], lider: ["Flávio à frente", "Lula à frente"],
    lula: ["Menos votos em Lula", "Mais votos em Lula"], flavio: ["Menos votos em Flávio", "Mais votos em Flávio"],
  }[modo];
  const g = `linear-gradient(to right, ${rampa.join(", ")})`;
  const nota = modo === "margem" ? "cor mais forte = maior margem" : modo === "lider" ? "uma cor por vencedor" : "cor mais forte = maior % dos válidos";
  $("#legenda").innerHTML = `<span>${esq}</span><span class="grad" style="background:${g}"></span><span>${dir}</span>
    <span>· cinza = sem votos apurados · ${nota}</span>`;
}

function tabela() {
  if (!dados) return;
  const linhas = Object.entries(dados.ufs)
    .filter(([uf]) => NOMES_UF[uf])
    .sort((a, b) => NOMES_UF[a[0]].localeCompare(NOMES_UF[b[0]], "pt-BR"))
    .map(([uf, u]) => `<tr><td>${NOMES_UF[uf]}</td>
      <td class="lula">${pct(u.lula / u.validos)}</td><td class="flavio">${pct(u.flavio / u.validos)}</td>
      <td>${fmt.format(u.lula)}</td><td>${fmt.format(u.flavio)}</td><td>${pct(u.apuradas / u.secoes, 1)}</td></tr>`)
    .join("");
  $("#tabela-ufs").innerHTML = `<table><thead><tr><th>UF</th><th>Lula</th><th>Flávio</th><th>Votos Lula</th><th>Votos Flávio</th><th>Apurado</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

// --- carga ---------------------------------------------------------------
async function carregarGeo() {
  const [u, m, nomes] = await Promise.all(["geo-ufs", "geo-municipios", "municipios"].map((n) => fetch(`data/${n}.json`).then((r) => r.json())));
  geo.nomes = nomes;
  geo.ufs = topojson.feature(u, u.objects.ufs).features;
  geo.municipios = topojson.feature(m, m.objects.municipios).features;
}

async function atualizar() {
  try {
    const r = await fetch(`data/resultado.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    dados = await r.json();
  } catch {
    if (!dados) $("#status").textContent = "Aguardando o início da apuração…";
    return;
  }
  placar(); mapas(); legenda(); tabela();
}

function filtroUF() {
  const sel = $("#filtro-uf");
  for (const [uf, nome] of Object.entries(NOMES_UF).sort((a, b) => a[1].localeCompare(b[1], "pt-BR")))
    sel.append(new Option(nome, uf));
  sel.addEventListener("change", () => { ufSelecionada = sel.value; if (dados) mapas(); });
}

function seletorModo() {
  const sel = $("#modo-cor");
  for (const [k, nome] of Object.entries(MODOS)) sel.append(new Option(nome, k));
  sel.addEventListener("change", () => { modo = sel.value; mapas(); legenda(); });
}

filtroUF();
seletorModo();
await carregarGeo();
placar(); mapas(); legenda(); // estado inicial (sem dados): totais zerados e mapas cinza
await atualizar();
setInterval(atualizar, REFRESH_MS);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => dados && (mapas(), legenda()));
