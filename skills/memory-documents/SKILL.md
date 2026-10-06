---
name: memory-documents
description: >
  Read, create, edit, and delete Markdown documents in the company's shared
  Memory knowledge base, and organize them into folders. Trigger when asked to
  look something up in Memory, record durable knowledge for the team, write
  documentation that outlives a task, or reorganize the knowledge base. Memory
  documents are created only via POST /api/companies/{companyId}/memory-documents —
  never by writing files to disk, creating skills, or attaching artifacts.
---

# Memory Documents

## The route — read this first

A document only lands in Memory if it is created through this exact endpoint:

```
POST /api/companies/{companyId}/memory-documents
```

Implemented in `server/src/routes/memory-documents.ts`. The JSON body accepts
exactly four fields:

| Field | Required | Type | Meaning |
|---|---|---|---|
| `title` | **yes** | string, 1–200 chars | The document name, shown in the rail |
| `slug` | no | string | URL key; derived from `title` when omitted |
| `markdown` | no | string | The body. Omitted means an empty document |
| `folderId` | no | uuid or `null` | Target folder. `null`/omitted leaves it at the root |

```bash
mem_curl -X POST \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_BASE/api/companies/$PAPERCLIP_COMPANY_ID/memory-documents" \
  -d '{"title":"Database Decisions","slug":"database-decisions","markdown":"# Database Decisions\n\nWe use Postgres because…","folderId":null}'
```

**Nothing else counts as writing to Memory.** Writing a `.md` file to disk,
creating a company skill, attaching an artifact, posting an issue comment, or
using the file-based `para-memory-files` skill all succeed on their own terms
and leave Memory empty — the human opens the Memory page and finds nothing. If
the task says Memory, use the route above and no other surface.

Memory is the company's **shared** knowledge base: Markdown documents organized
into folders, stored in the Paperclip database and edited by humans in the
Memory page under Work. You read and write the same documents they see.

**This is not your private scratch memory.** If you need per-agent notes across
sessions, that is the file-based `para-memory-files` skill and lives in
`$AGENT_HOME`. Memory is curated, company-visible, and another agent or a human
may edit the same document. Write here only what the team should keep.

## Access

Use the injected env vars; never hard-code the API URL or paste the key anywhere.

```bash
PAPERCLIP_API_BASE="${PAPERCLIP_API_URL%/}"
PAPERCLIP_API_BASE="${PAPERCLIP_API_BASE%/api}"
MEM="$PAPERCLIP_API_BASE/api/companies/$PAPERCLIP_COMPANY_ID/memory-documents"

# Send the Authorization header ONLY when a key exists. See the warning below.
mem_curl() {
  if [ -n "${PAPERCLIP_API_KEY:-}" ]; then
    curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$@"
  else
    curl -sS "$@"
  fi
}
```

**Never send an empty bearer token.** `PAPERCLIP_API_KEY` is absent in
`local_trusted` mode — the default for local development — where the server
grants access to local requests with no header at all. Sending
`-H "Authorization: Bearer $PAPERCLIP_API_KEY"` with the variable unset produces
the literal header `Authorization: Bearer `, and the server rejects that with
**401 `Empty bearer token`**. No header succeeds where an empty one fails, so a
hard-coded header turns a working call into a failing one.

A 401 saying `Empty bearer token` therefore does **not** mean the operator
forgot to inject a key, and it is not a reason to stop and report the run as
blocked. It means the header was sent empty — drop it and retry. Use
`mem_curl` above, which covers both modes.

When a key *is* present it is scoped to one company; requests for another
company are rejected. If your responsible user is a `viewer`, reads succeed and
writes are denied.

## Read

**List everything.** Returns titles and folder placement, **without** the body —
cheap enough to call before deciding what to open.

```bash
mem_curl "$MEM"
# {"documents":[{"id":"…","folderId":"…"|null,"title":"…","slug":"…",
#                "createdAt":"…","updatedAt":"…"}],
#  "allCount":12,"unfiledCount":3}
```

**Open one.** This is the only call that returns `markdown`.

```bash
mem_curl "$MEM/$DOCUMENT_ID"
```

**Resolve a name** (how `[[wikilinks]]` are followed). Matches the slug first,
then the title case-insensitively. Returns `{"document": null}` when nothing
matches — that is a normal answer, not an error.

```bash
mem_curl "$MEM/resolve?target=Database%20Decisions"
```

**List folders.** Memory folders live in the shared folder table under
`kind=memory`; always pass the kind.

```bash
mem_curl \
  "$PAPERCLIP_API_BASE/api/companies/$PAPERCLIP_COMPANY_ID/folders?kind=memory"
# {"kind":"memory","folders":[{"id":"…","name":"…","parentId":null,
#   "path":"…","depth":1,"itemCount":4}],"allCount":9,"unfiledCount":2}
```

## Create a document

`POST $MEM` — the canonical route from the top of this file. `title` is
required; `slug`, `markdown` and `folderId` are optional. Returns **201** with
the full document.

```bash
mem_curl -X POST -H "Content-Type: application/json" "$MEM" \
  -d '{"title":"Database Decisions","folderId":null,"markdown":"# Database Decisions\n\nWe use Postgres because…"}'
```

Omitting `slug` derives it from the title, folding accents (`Decisões` →
`decisoes`) — that is the normal case, so pass `slug` only when you need a
specific URL key. Slugs are unique per company either way, so a second document
with the same title gets a numeric suffix (`database-decisions-2`). Two
documents **may** share a title — but then a `[[wikilink]]` to that title
resolves to only one of them, so prefer distinct titles.

After the 201, confirm the document is really in Memory before reporting the
task done:

```bash
mem_curl "$MEM" | grep -o '"title":"[^"]*"'
```

If your new title is not in that list, it was not written to Memory — say so
instead of reporting success.

## Edit a document

Send `title`, `markdown`, or both. At least one is required; an empty object is
rejected with 400.

```bash
mem_curl -X PATCH -H "Content-Type: application/json" \
  "$MEM/$DOCUMENT_ID" -d '{"markdown":"# Updated\n\nNew content."}'
```

`markdown` **replaces the whole body** — there is no append or patch-by-section.
To add to a document, `GET` it first, build the new full body, then `PATCH`.
Because humans edit these too, re-read immediately before writing if any time
has passed, or you will silently overwrite their edits.

## Delete a document

```bash
mem_curl -X DELETE "$MEM/$DOCUMENT_ID"
# {"deleted":{...}}
```

This is permanent — there is no trash and no undo. Delete only what you created
in this run, or what you were explicitly asked to delete. When in doubt, ask in
a comment instead of deleting.

## Organize

**Move a document** between folders. `null` moves it out to the root.

```bash
mem_curl -X POST -H "Content-Type: application/json" \
  "$MEM/$DOCUMENT_ID/move" -d '{"folderId":"'"$FOLDER_ID"'"}'
```

**Create a folder.** `kind` must be `"memory"`. Omit `parentId` for a root folder.

```bash
mem_curl -X POST -H "Content-Type: application/json" \
  "$PAPERCLIP_API_BASE/api/companies/$PAPERCLIP_COMPANY_ID/folders" \
  -d '{"kind":"memory","name":"Architecture","parentId":null}'
```

**Delete a folder.** Its documents are **kept** and fall back to the root; they
are not deleted with it.

```bash
mem_curl -X DELETE \
  "$PAPERCLIP_API_BASE/api/companies/$PAPERCLIP_COMPANY_ID/folders/$FOLDER_ID"
```

## Writing style

Documents are plain Markdown, rendered for humans. Use `#` headings, lists,
fenced code blocks.

Link documents with Obsidian-style wikilinks — this is what makes the base a
graph rather than a pile of files:

```markdown
See [[Database Decisions]] for the reasoning, and [[Runbook: Deploy]] for steps.
```

A wikilink whose target does not exist renders as plain text, so it is safe to
reference a document you intend to write next. Link by the exact title.

## Response shapes

Only three calls wrap their result in an envelope. The rest return the bare
document, so looking for `.document` on a create or an edit finds nothing and
makes a successful write look like a failure.

| Call | Shape |
|---|---|
| `GET` list | `{"documents":[…],"allCount":N,"unfiledCount":N}` |
| `GET` resolve | `{"document": {…}}` or `{"document": null}` |
| `DELETE` | `{"deleted": {…}}` |
| `GET` one | the document itself |
| `POST` create | the document itself (**not** `{"document":…}`) |
| `PATCH` edit | the document itself |
| `POST` move | the document itself |

```bash
# id of a freshly created document
ID=$(mem_curl -X POST -H "Content-Type: application/json" "$MEM"   -d '{"title":"Example"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
```

## Verify writes — never infer them

Every successful write echoes the resulting JSON: create returns 201 with the
document, update and move return 200 with it, delete returns `{"deleted":…}`.
An empty body means the write **failed** even when curl exited 0. Capture the
status and check the echo:

```bash
RESPONSE=$(mem_curl -w '\n%{http_code}' -X PATCH \
  -H "Content-Type: application/json" "$MEM/$DOCUMENT_ID" \
  -d '{"markdown":"…"}')
STATUS=$(printf '%s' "$RESPONSE" | tail -n1)
[ "$STATUS" = "200" ] || echo "WRITE FAILED: $RESPONSE"
```

Never pipe a write through `head`/`tail` alone — the pipe swallows curl's exit
status, and a dropped connection then looks exactly like success. If you cannot
confirm a write, report it as FAILED, not as "sent".

## Errors

| Status | Meaning |
|---|---|
| 400 | Invalid payload — missing `title` on create, or an empty update object |
| 403 | Key belongs to another company, or the responsible user lacks write access |
| 404 | Document or folder does not exist in this company |
| 409 | Slug could not be made unique — the title collides too many times; rename |
| 422 | `folderId` points at a folder whose kind is not `memory` |

## Quick reference

| Goal | Call |
|---|---|
| List documents | `GET /api/companies/:companyId/memory-documents` |
| Read one | `GET /api/companies/:companyId/memory-documents/:id` |
| Resolve a title | `GET /api/companies/:companyId/memory-documents/resolve?target=Name` |
| **Create** | **`POST /api/companies/:companyId/memory-documents`** — body: `title`, `slug`, `markdown`, `folderId` |
| Edit | `PATCH /api/companies/:companyId/memory-documents/:id` |
| Delete | `DELETE /api/companies/:companyId/memory-documents/:id` |
| Move document | `POST /api/companies/:companyId/memory-documents/:id/move` |
| List folders | `GET /api/companies/:companyId/folders?kind=memory` |
| Create folder | `POST /api/companies/:companyId/folders` |
| Delete folder | `DELETE /api/companies/:companyId/folders/:folderId` |
