// Harness test: drive index.js with a stub ctx against a throwaway DSH home.
// Verifies the three stores are all cleaned and that the route answers.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-del-test-'))
process.env.DSH_HOME = home

const SID = 'session-11111111-2222-3333-4444-555555555555'
const slug = '--tmp-test-workspace--'

// --- fixture: what a real session leaves on disk -----------------------------
fs.mkdirSync(path.join(home, 'sessions', slug, SID), { recursive: true })
fs.writeFileSync(path.join(home, 'sessions', slug, SID, 'session.v4.jsonl.zstd'), 'dummy')
fs.mkdirSync(path.join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
fs.writeFileSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${SID}.json`), '{"title":"x"}')

// --- stub ctx ----------------------------------------------------------------
const calls = { unpin: 0, unarchive: 0, detach: 0 }
const workspace = {
  id: 'ws-1',
  sessionIds: [SID, 'session-other'],
  async detachSession(id) { calls.detach++; this.sessionIds = this.sessionIds.filter(x => x !== id) },
}
const ctx = {
  logger: { info() {}, warn() {} },
  effect(fn) { fn(); return () => {} },
  get(key) {
    if (key === 'workspaceRegistry') return {
      archivedSessionIds: [SID],
      pinnedSessionIds: [SID],
      list: () => [workspace],
      async unpinSession() { calls.unpin++ },
      async unarchiveSession() { calls.unarchive++ },
    }
    if (key === 'sessionPersistence') return { async stat() { return undefined } }
    if (key === 'agents') return { get: () => undefined }
    return undefined
  },
  webServer: {
    routes: [],
    register(spec) { this.routes.push(spec); return () => {} },
  },
}

const mod = await import('file:///F:/OneDrive/文档/deepseek-harness/default-workspace/dsh-session-delete/index.js')
mod.apply(ctx)

// --- exercise the route through a fake req/res ------------------------------
function callRoute(method, url, body, headers = {}) {
  const req = Object.assign(
    (async function* () { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) })(),
    { method, url, headers: { host: '127.0.0.1:58974', ...headers } },
  )
  const res = {
    status: 0, headers: {}, payload: '',
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) },
    end(text) { this.payload = text ?? '' },
  }
  return ctx.webServer.routes[0].handler(req, res).then(() => res)
}

const route = ctx.webServer.routes[0]
console.log('route mounted:', route.kind, route.path)

const before = await callRoute('GET', `/api/dsh-session-delete?id=${SID}`)
const beforeBody = JSON.parse(before.payload)
console.log('GET inspect:', before.status, JSON.stringify({
  logDirs: beforeBody.logDirs.length, archived: beforeBody.archived, pinned: beforeBody.pinned,
  workspaceIds: beforeBody.workspaceIds, cache: beforeBody.hasProjectionCache,
}))

const del = await callRoute('POST', '/api/dsh-session-delete', { sessionId: SID }, { 'content-type': 'application/json' })
const delBody = JSON.parse(del.payload)
console.log('POST delete:', del.status, 'clean=' + delBody.clean, 'removed=' + delBody.removed.map(r => r.step).join(','))

const after = await callRoute('GET', `/api/dsh-session-delete?id=${SID}`)
console.log('GET after:', after.status, 'exists=' + JSON.parse(after.payload).exists)

// --- assertions --------------------------------------------------------------
const problems = []
if (fs.existsSync(path.join(home, 'sessions', slug, SID))) problems.push('log dir still on disk')
if (fs.existsSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${SID}.json`))) problems.push('projection cache still on disk')
if (workspace.sessionIds.includes(SID)) problems.push('workspace still accounts the session')
if (workspace.sessionIds.includes('session-other') === false) problems.push('collateral: other session detached')
if (calls.unpin !== 1) problems.push('unpin not called once')
if (calls.unarchive !== 1) problems.push('unarchive not called once')
if (calls.detach !== 1) problems.push('detach not called once')
if (del.status !== 200) problems.push('delete status ' + del.status)
if (JSON.parse(after.payload).exists !== false) problems.push('inspect after delete still reports exists')

const bad = await callRoute('POST', '/api/dsh-session-delete', { sessionId: '../../etc/passwd' }, { 'content-type': 'application/json' })
if (bad.status !== 400) problems.push('path traversal not rejected: ' + bad.status)

// --- CSRF / cross-origin fences ---------------------------------------------
// Rebuild a fixture, then try the three ways a foreign page could reach it.
const SID2 = 'session-99999999-8888-7777-6666-555555555555'
fs.mkdirSync(path.join(home, 'sessions', slug, SID2), { recursive: true })

const crossOrigin = await callRoute('POST', '/api/dsh-session-delete',
  { sessionId: SID2 }, { 'content-type': 'application/json', origin: 'https://evil.example' })
if (crossOrigin.status !== 403) problems.push('cross-origin POST not refused: ' + crossOrigin.status)
if (!fs.existsSync(path.join(home, 'sessions', slug, SID2))) problems.push('cross-origin refused but log was deleted anyway')

const crossSite = await callRoute('POST', '/api/dsh-session-delete',
  { sessionId: SID2 }, { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })
if (crossSite.status !== 403) problems.push('cross-site POST not refused: ' + crossSite.status)

const plainText = await callRoute('POST', '/api/dsh-session-delete',
  { sessionId: SID2 }, { 'content-type': 'text/plain' })
if (plainText.status !== 415) problems.push('non-JSON content-type not refused: ' + plainText.status)

// Same-origin with the matching Origin header must still work.
const sameOrigin = await callRoute('POST', '/api/dsh-session-delete',
  { sessionId: SID2 }, { 'content-type': 'application/json', origin: 'http://127.0.0.1:58974' })
if (sameOrigin.status !== 200) problems.push('same-origin POST refused: ' + sameOrigin.status)
if (fs.existsSync(path.join(home, 'sessions', slug, SID2))) problems.push('same-origin POST did not delete')

console.log(problems.length === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL\n - ' + problems.join('\n - '))
fs.rmSync(home, { recursive: true, force: true })
process.exit(problems.length === 0 ? 0 : 1)
