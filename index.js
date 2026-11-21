/**
 * dsh-session-delete — Host half.
 *
 * DSH's stock Session menu offers pin / rename / fork / copy-id / archive and
 * nothing else: archiving only hides a row, and a Workspace delete explicitly
 * keeps its Session logs, so the product has no way to actually remove a
 * conversation. This plugin adds the missing verb.
 *
 * The Host owns the destructive half, because deleting a Session means three
 * different stores must agree:
 *
 *   1. the append-only log directory under `<dsh home>/sessions/<slug>/<id>/`,
 *   2. the workspace registry's `sessionIds` account, which keeps an archived
 *      Session's slot so unarchiving restores its position,
 *   3. the archive and pin sets, plus the projection cache that carries the
 *      row's title.
 *
 * The list a browser renders comes from `sessionQuery.listSessions()`, a scan of
 * store (1), so removing the directory is what makes a row disappear; (2) and
 * (3) are why a half-delete leaves an empty shell behind.
 *
 * Wire shape: one same-origin JSON route, `/api/dsh-session-delete`, matching how
 * the other community plugins here reach the Host. It works on every kernel line
 * that mounts a web server, without needing a typed Remote namespace compiled
 * into the assembly. GET reports what a delete would touch; POST performs it.
 *
 * @module index.js
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-session-delete'

/**
 * Cordis withholds every service a fiber does not name here, and keeps the fiber
 * pending while a named one is absent. Only `webServer` is named: without it
 * there is no route, so the plugin has nothing to do. Everything else is read
 * with `ctx.get()`, the opportunistic lookup that answers `undefined` rather
 * than throwing, so a composition without a workspace registry still gets the
 * log-file half of a delete.
 */
export const inject = ['webServer']

const ROUTE = '/api/dsh-session-delete'
const SESSION_ID = /^session-[0-9A-Za-z-]{1,120}$/

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve the Harness home the way the rest of the product does: an explicit
 * `DSH_HOME`, else `~/.dsh`.
 * @returns {string} absolute home directory.
 */
function resolveDshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== ''
    ? path.resolve(configured)
    : path.join(os.homedir(), '.dsh')
}

/**
 * Mount the delete route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  const logger = ctx.logger
  const home = resolveDshHome()
  /** @param {string} key @returns {any} */
  const service = key => ctx.get(key)

  /**
   * Resolve the Session log directories on disk.
   *
   * The persistence backend knows the exact artifact path, but only when the
   * Session is statable, and a corrupt log may not be. The store is keyed by a
   * slug of the Session's cwd, so the fallback walks `<home>/sessions/*\/<id>`
   * and collects every candidate it finds.
   * @param {string} sessionId - Session to locate.
   * @returns {Promise<string[]>} existing directories holding this Session.
   */
  async function locateLogDirs(sessionId) {
    const found = new Set()
    try {
      const snapshot = await service('sessionPersistence')?.stat(sessionId)
      const located = snapshot?.location?.path
      if (typeof located === 'string' && located !== '') {
        // `location.path` is the log file; the Session's directory is its parent.
        const dir = path.dirname(located)
        if (fs.existsSync(dir)) found.add(dir)
      }
    } catch { /* a log this broken is exactly what the user wants gone */ }

    const root = path.join(home, 'sessions')
    try {
      for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(root, entry.name, sessionId)
        if (fs.existsSync(candidate)) found.add(candidate)
      }
    } catch { /* no sessions root: nothing to walk */ }
    return [...found]
  }

  /**
   * Absolute path of the projection cache that carries this row's title.
   * @param {string} sessionId - Session identity.
   * @returns {string} cache file path.
   */
  function projectionCachePath(sessionId) {
    return path.join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  }

  /**
   * Report what a delete would touch, without touching it.
   * @param {string} sessionId - Session to inspect.
   */
  async function inspect(sessionId) {
    const logDirs = await locateLogDirs(sessionId)
    const cache = projectionCachePath(sessionId)
    const registry = service('workspaceRegistry')
    let archived = false
    let pinned = false
    /** @type {string[]} */
    const workspaceIds = []
    try {
      archived = registry?.archivedSessionIds?.includes(sessionId) === true
      pinned = registry?.pinnedSessionIds?.includes(sessionId) === true
      for (const workspace of registry?.list?.() ?? []) {
        if (workspace.sessionIds?.includes(sessionId)) workspaceIds.push(workspace.id)
      }
    } catch { /* registry absent: the file sweep still works */ }
    const running = service('agents')?.get?.(sessionId)?.status === 'running'
    return {
      sessionId,
      logDirs,
      hasProjectionCache: fs.existsSync(cache),
      archived,
      pinned,
      running,
      workspaceIds,
      exists: logDirs.length > 0 || fs.existsSync(cache) || workspaceIds.length > 0,
    }
  }

  /**
   * Delete one Session from every store that remembers it.
   *
   * Order matters. The registry account is dropped first, while the Session is
   * still known so `detachSession` resolves, then the log directory, then the
   * cache. A failure after the account is gone leaves a row-less log that the
   * next attempt still finds by walking the store; the reverse order would leave
   * an indexed row whose log is missing, which renders as a broken entry.
   * @param {string} sessionId - Session to delete.
   */
  async function destroy(sessionId) {
    const report = await inspect(sessionId)

    // A running Session must not lose its directory under a live loop: it would
    // keep appending to a path that no longer exists and reappear on the next
    // list refresh. The browser disables the action for these rows; this is the
    // second fence.
    if (report.running) throw new Error('这个会话还在运行，先停止它再删除。')

    /** @type {{step: string, [k: string]: unknown}[]} */
    const removed = []
    /** @type {{step: string, [k: string]: unknown}[]} */
    const failed = []
    const registry = service('workspaceRegistry')

    // 1. Unpin and unarchive first: both are idempotent, and a stale id left in
    //    either set keeps an invisible ghost row alive across startup.
    try { await registry?.unpinSession?.(sessionId) } catch (error) {
      failed.push({ step: 'unpin', message: messageOf(error) })
    }
    try { await registry?.unarchiveSession?.(sessionId) } catch (error) {
      failed.push({ step: 'unarchive', message: messageOf(error) })
    }
    removed.push({ step: 'release-sets' })

    // 2. Detach from every Workspace that accounts for it.
    for (const workspaceId of report.workspaceIds) {
      try {
        const workspace = registry?.list?.().find(entry => entry.id === workspaceId)
        await workspace?.detachSession?.(sessionId)
        removed.push({ step: 'detach', workspaceId })
      } catch (error) {
        failed.push({ step: 'detach', workspaceId, message: messageOf(error) })
      }
    }

    // 3. The logs themselves.
    for (const dir of report.logDirs) {
      try {
        await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
        removed.push({ step: 'rm-log', path: dir })
      } catch (error) {
        failed.push({ step: 'rm-log', path: dir, message: messageOf(error) })
      }
    }

    // 4. The projection cache holding the title.
    const cache = projectionCachePath(sessionId)
    if (fs.existsSync(cache)) {
      try {
        await fsp.rm(cache, { force: true })
        removed.push({ step: 'rm-cache', path: cache })
      } catch (error) {
        failed.push({ step: 'rm-cache', path: cache, message: messageOf(error) })
      }
    }

    return { sessionId, removed, failed, clean: failed.length === 0 }
  }

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {number} status
   * @param {unknown} body
   */
  function json(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    })
    res.end(text)
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<Record<string, unknown>>}
   */
  async function readBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 8_192) throw new Error('request body too large')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text === '') return {}
    return JSON.parse(text)
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function route(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const queryId = url.searchParams.get('id') ?? ''
      if (req.method === 'GET') {
        if (queryId === '') return json(res, 400, { error: 'missing ?id=session-...' })
        if (!SESSION_ID.test(queryId)) return json(res, 400, { error: 'malformed session id' })
        return json(res, 200, await inspect(queryId))
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      const body = await readBody(req)
      const sessionId = String(body.sessionId ?? body.id ?? '')
      if (!SESSION_ID.test(sessionId)) return json(res, 400, { error: 'malformed session id' })
      const result = await destroy(sessionId)
      logger?.info?.(`dsh-session-delete: removed ${sessionId} (${result.clean ? 'clean' : 'partial'})`)
      return json(res, result.clean ? 200 : 500, result)
    } catch (error) {
      logger?.warn?.(`dsh-session-delete: ${messageOf(error)}`)
      return json(res, 500, { error: messageOf(error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: route }),
    'dsh-session-delete: api route',
  )
  logger?.info?.(`dsh-session-delete: API mounted at ${ROUTE}`)
}
