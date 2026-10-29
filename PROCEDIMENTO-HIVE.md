# Procedimento — Executar o Hive (Paperclip)

## Pré-requisitos (uma vez só)

1. **Node 24.11+ obrigatório.** O Node 22 faz o `doctor` falhar com
   `Node.js X is unsupported` e o servidor não sobe.
   - O Node 24 está em `E:\Local\nvm\v24.22.0\node.exe`.
   - **Nunca use `nvm use`** para trocar de versão dentro de uma janela
     git-bash já aberta — o nvm-windows não altera o PATH de sessão já ativa.
     Use sempre o caminho absoluto do `node.exe`.

2. Pasta do projeto: `E:\LOCAL\Hive`

---

## Iniciar o servidor

```bash
cd /e/LOCAL/Hive
/e/Local/nvm/v24.22.0/node.exe ./cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts run
```

- O primeiro boot demora ~1–2 min (compila `@paperclipai/shared` e
  `@paperclipai/plugin-sdk`, depois o Vite empacota a UI).
- O servidor sobe em `http://127.0.0.1:3100`.

### Confirmar que subiu

Abrir em outro terminal:

```bash
curl http://127.0.0.1:3100/api/health
```

Deve retornar algo com `"status":"ok"` (enquanto sobe, vem
`"status":"starting"` — espere e repita).

### Abrir a UI

Navegador: `http://127.0.0.1:3100`

---

## Parar o servidor

- No terminal onde ele roda: `Ctrl+C`.
- Se rodou em background, encerrar o processo Node (ex.: pelo PID).

---

## Se a tela der "Cannot read properties of null (reading 'useEffect')"

É **cache do Vite corrompido**. Corrigir:

```bash
cd /e/LOCAL/Hive
rm -rf ./ui/node_modules/.vite/
```

Depois iniciar o servidor de novo e **recarregar o navegador com
`Ctrl+Shift+R`** (hard reload — um reload normal mantém o bundle quebrado).

---

## Tabela de erros comuns

| Sintoma | Causa | Correção |
|---|---|---|
| `Node.js 22.x is unsupported` / "Not starting server" | Node errado ativo | Rodar com `/e/Local/nvm/v24.22.0/node.exe` |
| `Cannot read properties of null (reading 'useEffect')` | Cache Vite corrompido | `rm -rf ./ui/node_modules/.vite/` + reiniciar + Ctrl+Shift+R |
| `Command not found in PATH: "opencode"` | CLI OpenCode ausente | Só afeta agentes `opencode_local`; instalar o CLI se for usar |

---

## Zerar a base (apagar todos os dados, manter config)

1. Parar o servidor.
2. Conferir que a porta 54329 (PostgreSQL embutido) está livre:
   ```bash
   netstat -ano | grep ":54329"
   ```
   (se aparecer listener, o servidor ainda está de pé — pare primeiro)
3. Apagar os dados (mantém `config.json`, `.env`, `secrets/`):
   ```bash
   cd /c/Users/cpsep/.paperclip/instances/default
   rm -rf companies workspaces db data ai-local-logins telemetry runtime-services runtime-service-logs
   ```
4. Subir o servidor de novo (primeiro boot recria o banco vazio).
