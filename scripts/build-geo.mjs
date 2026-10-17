// Baixa as malhas do IBGE (UFs e municípios) e gera TopoJSON simplificado em web/data/.
// Uso: npm run geo
import { writeFile } from "node:fs/promises";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile } from "topojson-simplify";

const IBGE = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR";

async function malha(nivel) {
  const url = `${IBGE}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=${nivel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function toTopo(geojson, nome, quantil) {
  const feats = geojson.features.map((f) => ({
    type: "Feature",
    id: f.properties.codarea,
    properties: {},
    geometry: f.geometry,
  }));
  let topo = topology({ [nome]: { type: "FeatureCollection", features: feats } }, 1e5);
  topo = presimplify(topo);
  topo = simplify(topo, quantile(topo, quantil));
  return topo;
}

for (const [nivel, nome, quantil] of [
  ["UF", "ufs", 0.3],
  ["municipio", "municipios", 0.12],
]) {
  const topo = toTopo(await malha(nivel), nome, quantil);
  const out = `web/data/geo-${nome}.json`;
  await writeFile(out, JSON.stringify(topo));
  console.log(out, topo.objects[nome].geometries.length, "geometrias");
}

// Nomes dos municípios por código IBGE, a partir da configuração do TSE.
const cfg = await (await fetch("https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json")).json();
const nomes = {};
for (const uf of cfg.abr) for (const m of uf.mu ?? []) nomes[m.cdi] = m.nm;
await writeFile("web/data/municipios.json", JSON.stringify(nomes));
console.log("web/data/municipios.json", Object.keys(nomes).length, "nomes");
