# Roadmap de Melhorias — Hive (fork PHOENYX)

> Documento de **especificação** (não de execução). Escrito em 26/10/2026 sobre o commit
> `168bb6e08` (branch `master`, em dia com `origin/master`). Toda afirmação técnica abaixo
> foi verificada no código desta árvore ou em medição real na instância local
> (`C:/Users/cpsep/.paperclip/instances/default`, empresa **PHOENYX TECNOLOGIA**).

---

## 0. Linha de base medida (antes de qualquer mudança)

| Métrica | Valor medido | Como foi medido |
|---|---|---|
| Runs concluídos | 148 `succeeded`, 13 `failed`, 2 `timed_out`, 1 `cancelled` | `select status,count(*),avg(finished_at-created_at) from heartbeat_runs` |
| Duração média de run bem-sucedido | **404 s (6,7 min)** | idem |
| Runs `timed_out` | 2 × ~1800 s (30 min) | idem |
| Amostra de 15 runs recentes | 3 a 15 min cada (ex.: 23:36:02 → 23:40:28) | `GET /api/companies/{id}/heartbeat-runs` |
| Custo registrado | **0 centavos** — `cost_events` = 0 linhas, `usage_json` NULL em todos os runs | Postgres 54329 |
| Run analisado linha a linha (Hugbee, 22/10) | 18,3 min; **740 s (12,3 min) parados em gaps >10 s** | `data/run-logs/.../a212d9a9....ndjson` |
| — dentro disso | `npm install` 146 s + 132 s + 65 s e `npm run build` 55 s = **343 s só de instalação/build** | idem |
| — latência de modelo por turno | gaps de 20–46 s entre "preparing terminal…" e a execução de um comando de 0,6 s | idem |
| Prompt mínimo por chamada (Hermes, `-Q`) | **11.528 tokens de entrada** para responder "ok" | `hermes --usage-file` |
| Composição do prompt | system prompt 23,6 KB + **25 schemas de tool = 40,7 KB** | `hermes prompt-size` |
| Cold start de 1 pergunta trivial | ~20–40 s de parede (1 API call) | `time hermes chat -Q -q "ok"` |
| Runs falhando AGORA por skill | 3 (14:05–14:07 de 26/10), falha em 6 s | `heartbeat_runs.error` |

### Instrumentos descobertos (base das soluções)

1. **`hermes --usage-file <path>`** (flag global, já suportada pela versão instalada) grava JSON
   por execução: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`,
   `reasoning_tokens`, `estimated_cost_usd`, `cost_status`, `cost_source`, `api_calls`,
   `model`, `provider`, `session_id`. Validado nesta máquina:
   `{"estimated_cost_usd":0.00174192,"input_tokens":11528,"output_tokens":2,"cache_read_tokens":3840,"model":"deepseek-flash","provider":"deepseek","session_id":"20261026_110721_90132d",...}`
2. **`~/.hermes/state.db`** (SQLite) tem `sessions` e `session_model_usage` com
   tokens por modelo, `estimated_cost_usd`, `actual_cost_usd`, `pricing_version`.
   É a fonte para *backfill* do histórico.
3. **`hermes prompt-size`** mede o prompt por plataforma/modelo — serve de gate de regressão
   para qualquer corte de prompt.
4. O adapter `hermes_local` já sabe (a) **resumir sessão** (`--resume`, `persistSession` default
   **true**), (b) restringir toolsets (`-t`), (c) limitar turnos (`--max-turns`),
   (d) **override por issue** (`issues.assigneeAdapterOverrides.adapterConfig`, aplicado em
   `server/src/services/heartbeat.ts:20322`).

---

## 1. FASE 1 — Desbloqueio: reconciliação de skills (bloqueia runs hoje)

**Problema.** Três runs de hoje (agente *Gerente de Projetos 2*) falham em 6 s:

```
Cannot reconcile Hermes skill "paperclipai/paperclip/memory-documents-read"
because C:\Users\cpsep\.hermes\skills\memory-documents-read is occupied by another installation.
```

**Causa raiz.** `~/.hermes/skills/memory-documents-read` é um **symlink** →
`E:\LOCAL\Hive\skills\memory-documents-read`. O reconciliador
(`packages/adapters/hermes/src/server/skills.ts:242`) só aceita o destino se o *manifest/marcador
de instalação* bater; como o banco/instalação foi recriado em algum momento, o marcador não
confere e ele trata o link como "de outra instalação" — em vez de **adotar** um link que aponta
para a própria origem.

**Especificação.**
1. `skills.ts`: ao encontrar o destino ocupado, resolver o link; se
   `realpath(target) === realpath(source)` (mesmo `skills/<nome>` do checkout), **adotar**
   (regravar marcador/entrada de manifest e seguir), em vez de lançar erro.
2. Só emitir o erro atual quando o destino for genuinamente estranho (diretório real com
   conteúdo de outro produto).
3. Logar `[hermes] Adopted existing skill link <nome>` para rastreabilidade.
4. Correção operacional imediata (se precisar rodar antes do patch): remover
   `~/.hermes/skills/{memory-documents-read,paperclip}` e deixar o Hive re-sincronizar no
   próximo run.

**Critérios de aceite.** Run do agente `094c5802` inicia e conclui sem esse erro; 3 runs
consecutivos `succeeded`; teste unitário novo cobrindo "symlink apontando para a mesma origem".

**Esforço.** ~2 h. **Risco.** Baixo (path já validado por realpath).

---

## 2. FASE 2 — Indicador de custo real (item 3 do pedido)

### 2.1 Problema
O card de custo do Dashboard mostra zero porque **nunca existe evento de custo**:
`cost_events` = 0 e `heartbeat_runs.usage_json` = NULL em 100% dos runs.

### 2.2 Causa raiz (duas, independentes)

**Causa A — o adapter não coleta usage.** `packages/adapters/hermes/src/server/execute.ts`
tenta *raspar texto* da saída (`TOKEN_USAGE_REGEX = /tokens?[:\s]+(\d+)\s*(?:input|in)\b.*?(\d+)\s*(?:output|out)\b/i`,
linha 229). O Hermes em modo `-Q` **não imprime** esse padrão — imprime a resposta e
`session_id:`. Logo `result.usage` fica vazio, `hasTokenUsage` é falso e
`updateRuntimeState` (`heartbeat.ts:19664`) **não cria** `cost_events`.

**Causa B — arredondamento para centavo.** `normalizeBilledCostCents`
(`heartbeat.ts:5187`) faz `Math.round(costUsd * 100)`. Um run trivial custa
US$ 0,0017 → **0 centavos**. Mesmo com dados reais, o dashboard somaria zero.

### 2.3 Especificação

**A. Coleta (adapter `hermes_local`)**
1. Ao montar `args`, adicionar `--usage-file <runScratch>/usage.json` (arquivo por run, dentro do
   scratch do run, apagado no fim).
2. Após o processo sair: ler o JSON e mapear para `ExecutionResult`:
   - `usage = { inputTokens, outputTokens, cachedInputTokens: cache_read_tokens }`
   - `costUsd = estimated_cost_usd`; se `cost_status === "actual"` → usar como real
   - `billingType`: `subscription_included` quando `cost_status === "included"`, senão `metered`
   - `model`/`provider` vindos do arquivo passam a ser **autoritativos** (sobrescrevem o que
     veio do config), o que também corrige o run que reporta `provider=auto`
   - guardar `api_calls` e `session_id` em `sessionParams` (útil para backfill e auditoria)
3. Manter os regex atuais como *fallback* apenas se o arquivo não existir (adapter antigo/erro).
4. Se o arquivo faltar e o run tiver sucesso → logar `[hermes] usage file missing` (visibilidade
   de regressão, sem falhar o run).

**B. Precisão sub-centavo (servidor)**
1. Nova coluna `cost_micros bigint not null default 0` em `cost_events` e
   `agent_runtime_state` (`total_cost_micros`). Migração drizzle + backfill 0.
2. `costCents` continua existindo (compatibilidade com budgets e relatórios), calculado como
   `round(micros/10000)` **apenas na leitura**; a soma oficial passa a ser em micros.
3. `costs.ts` (`sumAsNumber`) e todos os endpoints `costs/*` retornam também
   `costMicros`/`costUsd` agregados; UI formata 2 casas quando ≥ US$ 1 e **4 casas** quando menor.
4. Orçamentos (budgets) seguem em centavos — converter micros→cents na fronteira, com teste
   garantindo que budget de 0 centavos não bloqueia por arredondamento.

**C. Backfill do histórico (opcional, recomendado)**
Script `scripts/backfill-run-usage.ts`:
1. Copiar `~/.hermes/state.db` para um temp (o arquivo fica travado pelo Hermes em uso) via
   `VACUUM INTO`.
2. Para cada `heartbeat_runs` com `session_params->>'sessionId'`, casar em
   `sessions`/`session_model_usage` e preencher `usage_json`, `cost_events`,
   `agent_runtime_state`.
3. Modo `--dry-run` por padrão, imprimindo o total que seria gravado.

**D. Dashboard**
1. Card principal: custo do mês em US$ (não centavos), com selo `estimado`/`real`
   (`cost_status`) — nunca apresentar estimativa como valor faturado.
2. Nova linha "custo por run" e "custo por agente" (já existe `costs/by-agent`, hoje zerado).
3. Detalhe do run: tokens in/out/cache + custo + modelo, lidos de `usage_json`.

**Critérios de aceite.**
- 3 runs novos → 3 `cost_events` com `cost_micros > 0` e `usage_json` preenchido.
- Soma do dashboard = soma dos `--usage-file` dos runs (tolerância 1 micro).
- Run trivial (< US$ 0,01) aparece **não-zero** no dashboard.
- `cost_status` visível na UI; nenhum valor "0.00" falso.
- Testes: `costs-service`, `heartbeat` (updateRuntimeState) e um teste do adapter com usage-file
  fixture.

**Esforço.** 2–3 dias. **Risco.** Médio: migração de schema (precisa parar servidor/postgres);
mitigado por coluna aditiva e backfill em dry-run.

---

## 3. FASE 3 — Latência das iterações (item 1 do pedido)

### 3.1 Onde o tempo realmente vai (medido)

| Fase | Evidência | Peso |
|---|---|---|
| Modelo "pensando" por turno | gaps de 20–46 s antes de cada tool call (v4-pro) | **dominante** |
| Comandos lentos em série | `npm install`/`build` 343 s no run de 18 min | alto quando há código |
| Turnos em excesso | run de 18 min com dezenas de turnos exploratórios | alto |
| Prompt inflado | 11,5 k tokens mínimos; 40,7 KB de schemas de tool | médio (custo + latência) |
| Cold start do processo Hermes | ~3 s até `[hermes] Starting`, ~20–40 s até a 1ª resposta completa | baixo/médio |
| Sessão resumida acumulando contexto | `persistSession` default true → `--resume` reenvia histórico | cresce a cada run |
| Fila / concorrência | `startNextQueuedRunForAgent`, `maxConcurrentRuns` | situacional |

### 3.2 Especificação (por alavanca, com meta)

**L1. Roteamento por complexidade** — depende da FASE 4. É a maior alavanca: flash responde em
~3 s/chamada contra 20–46 s do v4-pro. Meta: tarefas mecânicas sempre em `deepseek-flash`.

**L2. Enxugar prompt e toolsets por papel.**
- Adapter: passar `-t <toolsets>` derivado do papel do agente (ex.: designer → `file,terminal`;
  PM → `file,terminal,skills`; CEO → `file,terminal,delegation`), configurável em
  `adapterConfig.toolsets` e com default por `role`.
- Corte do índice de skills: só as skills realmente usadas pelo papel (hoje 8 sincronizadas
  para todo mundo).
- Meta: `hermes prompt-size` cai de 23,6 KB/25 tools para ≤ 15 KB/≤ 14 tools;
  tokens de entrada por chamada de 11,5 k → ≤ 7 k.
- Gate: teste de regressão que falha se o prompt exceder o teto por papel.

**L3. Menos turnos.**
- Wake prompt (contrato de execução): instruir explicitamente a **agrupar tool calls
  independentes num único turno**, proibir releitura de arquivos já lidos e exigir plano curto
  antes de explorar.
- Default `--max-turns` por complexidade (ex.: 12 simples / 40 complexo) — hoje não há default.

**L4. Tirar trabalho lento de dentro do run.**
- Projeto com `node_modules` pré-instalado no workspace; `npm install` só quando `package.json`
  mudou (hash).
- Builds/testes longos: rodar em background e retomar por monitor (`executionPolicy.monitor`)
  em vez de bloquear o turno.
- Cache de pnpm/store compartilhado no host.

**L5. Política de sessão.**
- Hoje: resumo da sessão do agente acumula histórico e encarece cada run.
- Especificar: sessão nova por **issue**; `--resume` só dentro da mesma issue; compactação
  quando o contexto passar de X tokens (medir antes/depois com `--usage-file`).

**L6. Concorrência e fila.**
- Revisar `maxConcurrentRuns` por agente e o intervalo do dispatcher; garantir que sub-issues
  independentes rodem em paralelo (vários agentes) em vez de em série.
- Meta: lote de 5 tarefas independentes não deve somar as latências.

**L7. Instrumentação obrigatória (pré-requisito para provar ganho).**
Nova tabela `run_metrics` (por run): `queuedAt`, `startedAt`, `firstTokenAt`,
`finishedAt`, `turns`, `toolCalls`, `toolTimeMs`, `modelWaitMs`, `model`, `complexity`.
Alimentada pelo adapter (timestamps que ele já vê no stream) + pelo heartbeat. Sem isso, qualquer
otimização vira achismo.

### 3.3 Metas de aceite (p50 em 20 runs reais)
- Tarefa **simples** (≤ 5 turnos, sem build): **≤ 90 s** (hoje 4–6 min).
- Tarefa média: **≤ 3 min** (hoje 6,7 min de média).
- Tokens de entrada por run: **−40%**.
- Nenhum run `timed_out` por exploração (só por bloqueio real).
- Regressão zero na taxa de sucesso (`succeeded` mantém ≥ 90%).

**Esforço.** 3–4 dias (sendo L1 da FASE 4).

---

## 4. FASE 4 — Inteligência de modelo no CEO/agente principal (item 2)

### 4.1 Situação atual
- Todo agente roda `deepseek-flash` — exceto **Hugbee** (`deepseek-v4-pro` no primeiro log
  analisado) e **Financeiro** com `model: "deepseek-v4-flash"` (nome **inválido**, quebra run).
- Permissões do agente (`agent.permissions`) só carregam `canCreateAgents`/`canCreateSkills`;
  `agents:configure` existe como **grant de empresa** (`PERMISSION_KEYS`,
  `packages/shared/src/constants.ts:1003`) e há o fluxo de consentimento
  `agents:suggest-changes` (`authorization.ts:1560+`).
- O override por issue já funciona: `issues.assigneeAdapterOverrides.adapterConfig` é aplicado
  no run quando o agente é o assignee (`heartbeat.ts:5519` + `:20322`).

### 4.2 Desenho recomendado — política determinística + decisão do CEO

Em vez de dar ao CEO poder irrestrito de reconfigurar agentes (blast radius alto), separar:

**(a) Campo de complexidade na tarefa.** `issues.complexity: low | medium | high`
(default `medium`). O CEO define no triage (1 campo, barato cognitivamente).

**(b) Política de empresa (determinística, auditável).**
`companies.modelRoutingPolicy = { low: {model,provider,reasoning}, medium: {...}, high: {...} }`
com default sugerido:

| complexidade | modelo | reasoning | uso típico |
|---|---|---|---|
| low | `deepseek-flash` | `low` | status, comentário, mover tarefa, resposta curta |
| medium | `deepseek-flash` | `medium` | implementar tarefa bem especificada, análise de doc |
| high | `deepseek-v4-pro` | `high` | arquitetura, debug difícil, refactor multi-arquivo, decisão de risco |

**(c) Precedência de resolução do modelo no run** (implementar em um único resolver, perto de
`heartbeat.ts:20322`):
`issue.assigneeAdapterOverrides.adapterConfig` → `policy[issue.complexity]` →
`agent.adapterConfig` → default do adapter.
Com log da decisão: `[hive] model=deepseek-flash reason=policy:low issue=PHO-xx`.

**(d) Escalonamento e descalonamento automáticos.** Regras de segurança que o CEO aplica:
- 2 tentativas falhas na mesma tarefa → sobe um nível (low→medium→high).
- Tarefa em `high` sem progresso por 2 runs e custo > US$ X → abre pergunta ao board
  (`ask_user_questions`) em vez de continuar queimando tokens.
- Retrabalho trivial (ex.: renomear texto) → desce.

**(e) Consciência de custo.** O wake prompt do CEO passa a incluir um bloco gerado dos dados da
FASE 2: custo médio por run por modelo (últimos 7 dias), gasto do mês vs orçamento, e a tabela da
política. Nada hardcoded: os números vêm de `cost_events`.

**(f) Guardrails.**
- Lista `allowedModels` por empresa (nada fora da lista roda).
- Teto de custo por issue (`maxCostUsd`): ao exceder, o resolver cai para o nível inferior e o
  run registra `cost_guardrail_hit`.
- Cada decisão de roteamento gera **evento de auditoria** (issue, de→para, motivo, custo antes).

**(g) Se o usuário quiser também mudança a nível de agente.** Aí sim conceder
`agents:configure` ao CEO via grant de empresa, com o fluxo `suggest-changes` (board aprova).
Isso é decisão separada da política: a política resolve 90% dos casos sem esse poder.

**(h) Correção necessária no caminho:** normalizar modelos inválidos (`deepseek-v4-flash` →
`deepseek-flash`) e validar `adapterConfig.model` contra `VALID_MODELS` no create/PATCH do agente,
hoje aceito silenciosamente (o Financeiro quebra por isso).

### 4.3 Critérios de aceite
- 20 tarefas triadas: ≥ 70% das triviais em `flash`, nenhuma tarefa difícil presa em `flash`
  por mais de 1 run.
- Custo médio por issue −50% vs linha de base.
- Taxa de sucesso não cai (≥ 90%).
- Toda tarefa mostra na UI **qual modelo rodou e por quê** (motivo da política no detalhe do run).
- Nenhum run com modelo fora de `allowedModels`.

**Esforço.** 2–3 dias. **Risco.** Médio (qualidade): mitigado por escalonamento automático e
por medir sucesso, não só custo.

---

## 5. Ordem de execução e dependências

```
FASE 1  skills reconcile .............. 0,5 d   (desbloqueia runs)          → independe
FASE 2  custo real .................... 2–3 d   (dá o medidor p/ FASE 3/4)  → independe
FASE 3a instrumentação (run_metrics) .. 1 d     (mede antes/depois)         → depende de FASE 2
FASE 4  roteamento (política + CEO) ... 2–3 d   (maior ganho de latência)   → depende de FASE 2/3a
FASE 3b tuning (prompt, turnos, sessão) 2 d     (ajuste fino)               → depende de 4
```

Racional: **custo primeiro** porque ele é o instrumento de medição das outras duas fases
(sem tokens/custo por run não se prova ganho de latência nem de roteamento).

- **FASE 3 — primeira leva (26/10/2026)**
  - `DEFAULT_MAX_TURNS = 60` quando o agente não define `maxTurnsPerRun`: runaway vira falha
    rápida e atribuível em vez de estourar o timeout de 30 min (2 runs estouraram num dia).
  - Contrato de execução (compartilhado por todos os adapters) ganhou 4 diretrizes:
    agrupar tool calls independentes no mesmo turno; não reler arquivo/comando já executado;
    checar dependências antes de reinstalar (e rodar job longo em background); preferir uma
    verificação decisiva a uma sequência exploratória.
  - Instrumentação: `[hermes] Timing: wall=..s turns=.. wall_per_turn=..s model_timeout=..
    max_turns=..` por run no log do run (sem tabela nova: `heartbeat_runs` + `usage_json`
    já dão duração e `apiCallCount`).
  - Corrigido de quebra o mock de `node:fs/promises` em `execute.onspawn.test.ts` (6 testes
    estavam vermelhos por falta de export default, antes de chegar ao adapter).
  - Verificado: run de fumaça com 3 turnos → `wall=26.6s`, `wall_per_turn=8.9s`,
    `max_turns=60`, custo US$ 0,001139 registrado.
  - **Pendente da FASE 3**: política de sessão (resume acumulando contexto), toolsets por papel
    (prompt de 11,5k tokens por chamada) e paralelismo de sub-issues. Dependem da FASE 4.

---

## 6. Decisões tomadas (aprovadas em 26/10/2026)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Precisão de custo | **`cost_micros` (bigint)** aditivo ao lado de `costCents` |
| 2 | Poder do CEO | **Política determinística + `agents:configure` concedido ao CEO** (ele pode mudar config de qualquer agente, com auditoria) |
| 3 | Backfill histórico | **Não** — custo passa a valer daqui pra frente |
| 4 | Níveis de complexidade | **3 níveis**: `low` / `medium` / `high` |
| 5 | Ordem de execução | **FASE 1 (desbloqueio) → FASE 2 (custo) → FASE 3 → FASE 4** |

### Status de execução

- **FASE 1 — CONCLUÍDA (26/10/2026)**
  - `packages/adapter-utils/src/server-utils.ts`: nova `isSameSkillTargetPath()` (comparação
    case-insensitive/separador-agnóstica no Windows + `realpath` como autoridade) e uso dela em
    `ensurePaperclipSkillSymlink`.
  - `packages/adapters/hermes/src/server/skills.ts`: adota link para a própria origem; adota
    diretório real com `SKILL.md` idêntico; mensagem de erro agora mostra origem e destino.
  - Teste novo: `packages/adapter-utils/src/skill-symlink-reconcile.test.ts` (7 passam).
  - Verificado em run real: `[hermes] Reconciled 2 Paperclip-managed skill(s)` — antes falhava
    em 6 s com "occupied by another installation".
  - Agente **Financeiro** corrigido: `deepseek-v4-flash` (inválido) → `deepseek-flash` + provider.

- **FASE 2 — IMPLEMENTADA E VERIFICADA (26/10/2026)**
  - Adapter: `--usage-file` **não serve** (flag só existe no parser raiz, não após `chat`, e não
    escreve nada em `chat -Q`). Solução real: `packages/adapters/hermes/src/server/session-usage.ts`
    lê `<HERMES_HOME>/state.db` (tabela `sessions`) com `node:sqlite` read-only, por
    `session_id`; devolve tokens, cache, `cost_usd`, `cost_status`, modelo e provider.
  - Sessão resumida acumula totais → o adapter devolve o **delta** (`usageBasis: per_run`) e guarda
    o acumulado em `sessionParams.usageTotals` para o próximo run.
  - Modo não-quiet: o id da sessão só aparece no bloco final (`Session: 2026...`) → novo regex
    `SESSION_SUMMARY_ID_REGEX` (sem ele não há como casar a sessão com o custo).
  - Schema: `cost_events.cost_micros` + `agent_runtime_state.total_cost_micros`
    (migração `0283_daffy_dreaming_celestial`) e escrita em `heartbeat.ts`
    (`normalizeBilledCostMicros`).
  - Leitura: todas as somas de custo passam a usar
    `sum(greatest(cost_micros, cost_cents*10000))/10000` — micros como fonte, centavos como
    fallback (linhas antigas/manuais continuam corretas). Arquivos: `costs.ts`, `dashboard.ts`,
    `agents.ts`, `budgets.ts`, `companies.ts`, `company-skills.ts`, `plugin-host-services.ts`,
    `status-cards.ts`, `routes/user-profiles.ts`.
  - UI: `formatCents` mostra 4 casas abaixo de US$ 1 (antes `$0.00` engolia valores reais).
  - **Prova real**: run do Financeiro gravou `usage_json` com `inputTokens=3825`,
    `outputTokens=541`, `cachedInputTokens=54528`, `costUsd=0.001061934`; `cost_events` com
    `cost_cents=0` e `cost_micros=1062`; dashboard `Month Spend = $0.0011`.
  - Testes: `costs-service` (17), `budgets-service`, `user-profile-routes` verdes;
    `skill-symlink-reconcile` (adapter-utils) verde. (Duas suítes falharam uma vez por
    `Hook timed out` do Postgres efêmero com a máquina carregada — passam isoladas.)
  - **Pendente da FASE 2**: selo "estimado/real" no dashboard (usa `cost_status`), detalhe do run
    com tokens/custo, e teste unitário do `session-usage.ts` com fixture de sqlite.


---

## Anexo A — Como reproduzir as medições

```bash
# 1) duração real dos runs (Postgres embutido, sem psql)
cd E:/Local/hive && NODE_PATH="E:/Local/hive/node_modules/.pnpm/pg@8.18.0/node_modules" \
  E:/Local/nvm/v24.22.0/node.exe pq_tmp.cjs
#   select status,count(*),avg(extract(epoch from (finished_at-created_at))) from heartbeat_runs group by status;

# 2) custo real de uma execução Hermes isolada
hermes -z "diga apenas ok" --usage-file "C:/Users/cpsep/AppData/Local/Temp/u.json" \
  -m deepseek-flash --provider deepseek && cat "C:/Users/cpsep/AppData/Local/Temp/u.json"

# 3) tamanho do prompt por papel/modelo
hermes prompt-size

# 4) onde o run perdeu tempo (gaps > 10 s)
python - <<'PY' "$f"
import json,sys,datetime
rows=[json.loads(l) for l in open(sys.argv[1],encoding='utf-8',errors='replace') if l.strip()]
t=[datetime.datetime.fromisoformat(r['ts'].replace('Z','+00:00')) for r in rows]
g=sorted(((t[i]-t[i-1]).total_seconds(),rows[i-1].get('chunk','')[:70]) for i in range(1,len(t)))[::-1]
[print(f'{d:7.1f}s {c!r}') for d,c in g[:10]]
PY
```

## Anexo B — Arquivos que cada fase toca

| Fase | Arquivos |
|---|---|
| 1 | `packages/adapters/hermes/src/server/skills.ts` (+ teste) |
| 2 | `packages/adapters/hermes/src/server/execute.ts`, `server/src/services/heartbeat.ts` (updateRuntimeState/5187/5209), `server/src/services/costs.ts`, `server/src/db/schema`, migração drizzle, `ui/src/pages/Dashboard*.tsx`, `ui/src/api/costs.ts`, `scripts/backfill-run-usage.ts` |
| 3 | `packages/adapters/hermes/src/server/execute.ts` (toolsets/max-turns/prompt), `packages/adapters/hermes/src/shared/constants.ts`, `server/src/services/heartbeat.ts` (run_metrics, dispatcher), `ui` (detalhe do run) |
| 4 | `server/src/services/heartbeat.ts` (resolver de modelo), `packages/shared/src/validators` (complexity/policy), `server/src/routes/issues.ts` + `companies.ts`, `ui` (badge complexidade + motivo do modelo), `skills/paperclip*` (instruções de triage do CEO) |
