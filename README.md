# dsh-session-delete

Adds the **delete session** action that DeepSeek Harness does not ship.

DSH's Session menu offers pin, rename, fork, copy-id and archive. Archiving only hides a row, and deleting a Workspace explicitly keeps its Session logs — so there is no way in the product to actually remove a conversation from disk. This plugin adds that verb.

## What it does

Right-click any Session row in the sidebar (or use the row's `…` menu) and pick **Delete session** — a red entry at the bottom of the menu. A confirmation dialog lists the exact log directories about to be destroyed. Confirm, and the row is gone.

Deleting takes three stores, because removing only one leaves a shell behind:

| Store | Location | Why it must go |
|---|---|---|
| Session log | `<DSH_HOME>/sessions/<workspace-slug>/<session-id>/` | The list is a scan of this directory — the row disappears only when it is gone |
| Workspace account | `<DSH_HOME>/storages/workspace.json` → `sessionIds` | Records which Workspace owns the Session |
| Title cache | `<DSH_HOME>/storages/session_projcache/sessions/<id>.json` | Holds the row's title and first prompt |

The archive and pin sets are cleaned in the same pass; a stale id left in either one resurrects an invisible ghost row after a restart.

## Two guards

- **A running Session is refused.** The dialog says so and disables the button; the Host checks again before touching anything, so a live agent loop never loses its directory mid-turn.
- **Local only.** The route is served on the Host's own origin behind DSH's signed-cookie auth. A remote viewer without that cookie gets 401.

## Install

```sh
dsh plugin add https://github.com/pplankero-sudo/dsh-session-delete
```

Or add it to a profile by hand — the package declares a `dsh.bundle` manifest, so both paths work:

```json
{
  "dependencies": { "dsh-session-delete": "file:<absolute path to this repo>" },
  "dsh": { "profile": { "bundles": ["...", "dsh-session-delete"] } }
}
```

Restart DeepSeek Harness afterwards, tray included.

## How it is built

Two halves, both plain JavaScript with no build step:

- `index.js` — the Host half. Registers `POST/GET /api/dsh-session-delete` on `ctx.webServer`, and does the actual removal across the three stores through `ctx.get()` lookups, so a composition missing the workspace registry still gets the log-file half.
- `client.js` — the browser half. A hand-written ModuleLoader bundle registering a `session` context-menu contribution at `order: 700` and a confirmation dialog in `shell.overlay`. After a successful delete it calls `sessions.refresh()`, which re-scans the Host.

## HTTP route

`/api/dsh-session-delete`

- `GET ?id=session-<uuid>` — read-only probe. Reports `logDirs`, `archived`, `pinned`, `running`, `workspaceIds`, `exists`.
- `POST { "sessionId": "session-<uuid>" }` — performs the delete. Returns `{ removed: [...], failed: [...], clean: boolean }`.

Session ids must match `^session-[0-9A-Za-z-]{1,120}$`; anything else is rejected with 400 before it can reach the filesystem.

## Tests

```sh
npm test
```

`test-host.mjs` drives the Host half against a throwaway `DSH_HOME` and asserts that all three stores are cleaned, that a sibling Session is untouched, that a running Session is refused, and that a traversal-shaped id is rejected. `test-client.mjs` evaluates the browser bundle against stub globals and asserts the menu contribution's target/order/danger flags, both locales, and the dialog's idle, pending and running states.

## Uninstall

Remove the entry from `dsh.profile.bundles` and its dependency line, then restart. The plugin writes nothing unless a delete is invoked.

## License

MIT
