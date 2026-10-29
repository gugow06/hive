# Hive — Problemas encontrados e soluções aplicadas

> Registro de trabalho no fork `gugow06/hive` (base `paperclip`), máquina Windows.

## 1. Servidor não sobe — `Node.js 22.x is unsupported`

**Problema:** `doctor` falha com `Node.js X is unsupported. Paperclip requires Node.js 24.11.0 or newer` e bloqueia o boot.

**Causa:** o `node` ativo no PATH era a versão 22 (do Hermes), abaixo do mínimo exigido. O `nvm use` não altera o PATH de uma sessão git-bash já aberta.

**Solução:** invocar o Node 24 pelo caminho absoluto:
```bash
/e/Local/nvm/v24.22.0/node.exe ./cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts run
```

---

## 2. UI com erro `Cannot read properties of null (reading 'useEffect')`

**Problema:** tela quebra com erro de React (useEffect em `null`).

**Causa:** cache de pré-bundle do Vite corrompido — os 504 durante a otimização de dependências no primeiro boot deixam o grafo de módulos quebrado (React resolvendo como `null`).

**Solução:**
```bash
cd /e/LOCAL/Hive && rm -rf ./ui/node_modules/.vite/
```
Reiniciar o servidor e recarregar com `Ctrl+Shift+R` (hard reload).

---

## 3. Servidor cai — `PostgresError: out of memory`

**Problema:** servidor cai repetidamente; log mostra `Failed to reconcile chat run milestones ... PostgresError: out of memory`.

**Causa:** `work_mem = 4MB` (default) no PostgreSQL embutido, insuficiente para as queries de reconciliação de chat (joins/sorts grandes).

**Solução:** em `C:\Users\cpsep\.paperclip\instances\default\db\postgresql.conf`:
```
work_mem = 64MB
maintenance_work_mem = 128MB
```
Reiniciar o servidor (recarrega o config).

---

## 4. Boot falha — `pre-existing shared memory block is still in use`

**Problema:** novo boot do Postgres embutido falha com `FATAL: pre-existing shared memory block is still in use`.

**Causa:** processos `postgres` órfãos — quando o servidor é morto de forma brusca, o Postgres (filho) fica vivo segurando memória compartilhada e a porta.

**Solução (git-bash):**
```bash
MSYS_NO_PATHCONV=1 taskkill /F /IM postgres.exe
```
Prevenção: parar o servidor com `Ctrl+C` no terminal onde roda (shutdown limpo).

---

## 5. Task do agente falha — `spawn ENAMETOOLONG`

**Problema:** run do agente falha com `spawn ENAMETOOLONG(adapter_failed)`.

**Causa:** o adaptador `hermes_local` passava o prompt inteiro como argumento de linha de comando (`-q "<prompt>"`), estourando o limite de ~32 KB do Windows.

**Solução:** alterado `packages/adapters/hermes/src/server/execute.ts` para gravar o prompt em arquivo temporário e usar `--query-file`:
```ts
const promptFile = path.join(os.tmpdir(), `paperclip-hermes-prompt-${ctx.runId ?? Date.now()}.txt`);
await fs.writeFile(promptFile, prompt, "utf-8");
const args: string[] = ["chat", "--query-file", promptFile];
```
(adicionado import `os` de `node:os`).

---

## 6. Agente não executa — `model "auto" rejected`

**Problema:** execução falha com `The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed auto`; UI ecoa o prompt em vez de responder.

**Causa:** agente "Hugbee" (`hermes_local`) estava com `model: auto`, que o DeepSeek não aceita.

**Solução:** `PATCH` no agente definindo modelo explícito:
```json
{ "adapterConfig": { "model": "deepseek-v4-pro", "provider": "deepseek" } }
```

---

## 7. Banner ASCII "PAPERCLIP"

**Problema:** banner de inicialização mostrava "PAPERCLIP"; desejo de rebrand para "HIVE WITH PAPERCLIP".

**Solução:** substituída a arte ASCII (fonte "ANSI Shadow") em:
- `cli/src/utils/banner.ts`
- `server/src/startup-banner.ts`

Novo texto empilhado: HIVE / WITH / PAPERCLIP.

---

## Mudanças não commitadas (pendentes)

| Arquivo | Mudança |
|---|---|
| `packages/adapters/hermes/src/server/execute.ts` | `--query-file` (fix ENAMETOOLONG) |
| `cli/src/utils/banner.ts` | banner HIVE/WITH/PAPERCLIP |
| `server/src/startup-banner.ts` | banner HIVE/WITH/PAPERCLIP |

O `postgresql.conf` (item 3) fica em `~/.paperclip/`, fora do repo.

---

## Comandos úteis (git-bash)

```bash
# Listar processos do Hive
tasklist | grep -iE "postgres|node.exe"

# Matar órfãos
MSYS_NO_PATHCONV=1 taskkill /F /IM postgres.exe
MSYS_NO_PATHCONV=1 taskkill /F /IM node.exe

# Subir o servidor
cd /e/LOCAL/Hive
/e/Local/nvm/v24.22.0/node.exe ./cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts run
```
