# Apuração · 2º turno 2026

Painel aberto para acompanhar a apuração do 2º turno da eleição presidencial (25/10/2026), com dados oficiais do TSE:

- placar parcial (votos e % dos válidos de cada candidato) e % de seções apuradas;
- mapa por estado e mapa por município (vermelho = Lula à frente, azul = Flávio Bolsonaro à frente; cor mais forte = maior margem);
- tabela por UF.

Projeto independente, sem vínculo com o TSE. O resultado oficial é o do [TSE](https://resultados.tse.jus.br).

## Como funciona

```
resultados.tse.jus.br (JSON estáticos) ──> scripts/collect.mjs ──> web/data/resultado.json ──> web/ (HTML + D3)
```

- `scripts/collect.mjs` baixa o arquivo de resultado do Brasil, das 27 UFs + exterior e dos ~5.570 municípios (~80 req/s; o TSE limita a 100 req/s por IP) e grava um JSON compacto (~200 KB).
- `scripts/build-geo.mjs` gera as malhas simplificadas do IBGE (`web/data/geo-*.json`). Já estão versionadas; só rode de novo se precisar.
- `web/` é um site estático (D3 + TopoJSON via CDN) que recarrega `resultado.json` a cada 30 s.
- `.github/workflows/pages.yml` coleta e publica no GitHub Pages a cada ~5 min.

Endpoints do TSE usados (ciclo `ele2026`, eleição `6258` = Presidente 2º turno; `6257` = 1º turno):

```
/oficial/ele2026/<eleicao>/config/mun-e00<eleicao>-cm.json        # municípios (cód. TSE -> cód. IBGE)
/oficial/ele2026/<eleicao>/dados/br/br-c0001-e00<eleicao>-u.json   # Brasil
/oficial/ele2026/<eleicao>/dados/<uf>/<uf>-c0001-e00<eleicao>-u.json
/oficial/ele2026/<eleicao>/dados/<uf>/<uf><cod_tse>-c0001-e00<eleicao>-u.json   # município
```

Os códigos vêm de `/oficial/comum/config/ele-c.json`. Especificações dos arquivos: <https://www.tse.jus.br/eleicoes/arquivos>.

## Rodando localmente

```bash
npm install
npm run collect -- --eleicao 6257   # 1º turno, para testar (o painel mostra aviso de "dados de teste")
npm run dev                         # http://localhost:8080
# no dia: npm run collect -- --loop 60   (coleta a cada 60 s)
```

Requer Node 20+. Antes do início da apuração o coletor não gera nada e o painel mostra "Aguardando…".

## Hospedagem (grátis)

Tudo roda online, sem servidor pago e sem depender de nenhum computador pessoal:

- **Site + API:** um Worker do Cloudflare (`src/worker.js`, `wrangler.jsonc`) serve `web/` e guarda o último resultado num KV. Deploy: `npx wrangler deploy`.
- **Coletor:** o workflow `.github/workflows/coletor.yml` roda em loop (a cada 45 s) no GitHub Actions e envia o JSON para `POST /api/update` com o segredo `UPDATE_TOKEN` (configure o mesmo valor no Worker e nos Secrets do repositório). Agendado para a noite de 25/10; também pode ser disparado manualmente (Actions → Run workflow).
- Quem quiser pode rodar o coletor em qualquer máquina: `UPDATE_TOKEN=... npm run collect -- --loop 45 --post https://SEU-DOMINIO/api/update`.

## Ideias para contribuir

- Atualização ao vivo de Brasil/UFs direto do navegador (o TSE responde com CORS e `cache-control: max-age=30`), deixando só os municípios no snapshot.
- Histórico/evolução da apuração (gráfico de linha da diferença ao longo do tempo) e projeção com base nas seções restantes.
- Requisições condicionais (ETag) e pular municípios 100% apurados para tornar o coletor mais leve.
- Zoom/clique no mapa, comparação com o 1º turno, voto no exterior, cidades-capitais em destaque.
- Município `5101837` (Boa Esperança do Norte/MT) existe no TSE mas ainda não na malha do IBGE usada.
- Testes e acessibilidade (navegação por teclado nos mapas).

PRs são bem-vindos. Licença MIT.
