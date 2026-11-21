/**
 * dsh-session-delete — browser half.
 *
 * Two contributions to the web shell:
 *   1. a `删除会话` entry in the Session row's context menu (and the "..." menu),
 *      which is the verb DSH itself does not ship;
 *   2. one confirmation dialog that names the Session and spells out that the log
 *      is destroyed, not archived.
 *
 * The destructive work happens on the Host over this plugin's own same-origin
 * route (see `index.js`), then `sessions.refresh()` rebuilds the list from the
 * Host scan — a deleted Session disappears because its directory is gone, so no
 * client-side tombstone is needed.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useRef } = React

    const NS = 'dsh.sessionDelete'
    /**
     * Only the services this bundle cannot work without. `contextMenus` is how the
     * entry reaches the row menu; `sessions` supplies the list refresh; `locale`
     * localizes the labels; `slots` renders the dialog into `shell.overlay`.
     */
    const inject = ['contextMenus', 'sessions', 'locale', 'slots']

    const DICT = {
      zh: {
        action: '删除会话',
        actionFailed: '删除会话失败',
        confirmTitle: '删除此会话？',
        confirmBody: '“{title}”的会话记录会从磁盘上删除：对话内容、工具输出和标题缓存都会一起消失，无法撤销。只想让它从列表里消失的话，用“归档会话”即可。',
        confirmNoLog: '（没有找到这个会话的日志目录，只会清理索引和缓存。）',
        confirmRunning: '这个会话还在运行。请先停止它，再删除。',
        cancel: '取消',
        confirm: '删除',
        pending: '正在删除…',
        done: '会话已删除',
        doneDetail: '“{title}”及其日志已从本地移除。',
        failed: '删除失败',
        partial: '部分内容未能删除'
      },
      en: {
        action: 'Delete session',
        actionFailed: 'Could not delete the session',
        confirmTitle: 'Delete this session?',
        confirmBody: 'The log for “{title}” is removed from disk: messages, tool output and the saved title all go with it, and this cannot be undone. To hide the row instead, use Archive.',
        confirmNoLog: '(No log directory was found; only the index and cache will be cleared.)',
        confirmRunning: 'This session is still running. Stop it before deleting.',
        cancel: 'Cancel',
        confirm: 'Delete',
        pending: 'Deleting…',
        done: 'Session deleted',
        doneDetail: '“{title}” and its log are gone from this machine.',
        failed: 'Delete failed',
        partial: 'Some items were not removed'
      }
    }

    /**
     * Resolve the plugin route against the page base, so a deployment behind a
     * path prefix keeps working instead of hitting the site root.
     */
    const API = (() => {
      try { return new URL('api/dsh-session-delete', document.baseURI).pathname } catch { return '/api/dsh-session-delete' }
    })()

    /** @param {string} path @param {RequestInit & {timeout?: number}} [options] */
    async function api(path, options) {
      const { timeout = 15000, ...init } = options ?? {}
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const response = await fetch(`${API}${path}`, { ...init, redirect: 'error', signal: controller.signal })
        const text = await response.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 300) } }
        if (!response.ok) {
          const error = new Error(payload?.error ?? `HTTP ${response.status}`)
          error.payload = payload
          throw error
        }
        return payload
      } finally {
        clearTimeout(timer)
      }
    }

    function apply(ctx) {
      const locale = ctx.locale
      const tag = () => {
        try {
          // `getLocale()` answers an immutable snapshot; `active` is the locale id.
          const snapshot = locale?.getLocale?.()
          const active = snapshot?.active ?? locale?.active
          return typeof active === 'string' && active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        } catch { return 'zh' }
      }
      const t = (key, vars) => {
        const table = DICT[tag()] ?? DICT.zh
        let text = table[key] ?? DICT.zh[key] ?? key
        for (const [name, value] of Object.entries(vars ?? {})) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
        return text
      }

      // ── the pending confirmation ────────────────────────────────────────────
      // A tiny observable the dialog subscribes to; no store package needed for
      // one value.
      let pending = null
      const listeners = new Set()
      const notify = () => { for (const listener of listeners) listener() }
      const request = (next) => { pending = next; notify() }
      const usePending = () => {
        const [, force] = useState(0)
        useEffect(() => {
          const listener = () => force(value => value + 1)
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }, [])
        return pending
      }

      /** Ask the Host what is on disk before promising anything to the user. */
      async function probe(sessionId) {
        try {
          return await api(`?id=${encodeURIComponent(sessionId)}`)
        } catch {
          // The dialog still opens: a probe failure must not block the action,
          // and the Host re-checks everything on the POST anyway.
          return { sessionId, logDirs: [], exists: true, running: false }
        }
      }

      /** Delete, then rebuild the list so the row disappears. */
      async function destroy(sessionId, displayTitle) {
        const result = await api('', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        try { await ctx.sessions.refresh() } catch { /* the next scan catches up */ }
        return { ...result, displayTitle }
      }

      // ── the menu entry ──────────────────────────────────────────────────────
      // `session` is the target kind the workspace browser opens for a row; the
      // same contribution therefore serves both the hover ellipsis and the
      // right-click menu without either knowing about this plugin.
      ctx.effect(() => ctx.contextMenus.register({
        id: 'session.delete',
        target: 'session',
        // Sits below archive (600) so the destructive verb is last, and carries
        // `danger` so the popup paints it in the destructive colour.
        order: 700,
        resolve: (target) => [{
          id: 'delete',
          label: t('action'),
          danger: true,
          separatorBefore: true,
          failureLabel: t('actionFailed'),
          run: async () => {
            const probeResult = await probe(target.sessionId)
            request({
              sessionId: target.sessionId,
              displayTitle: target.displayTitle ?? '',
              logDirs: probeResult?.logDirs ?? [],
              running: probeResult?.running === true,
            })
          },
        }],
      }), 'dsh-session-delete: session menu')

      // ── the confirmation dialog ─────────────────────────────────────────────
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-session-delete-dialog',
      }, () => h(ConfirmDialog, { usePending, request, destroy, t })))
    }

    /**
     * One dialog per pending request. The body spells out what is destroyed and
     * names the log directories the Host reported, so the user is confirming a
     * specific on-disk effect rather than a generic "are you sure".
     */
    function ConfirmDialog({ usePending, request, destroy, t }) {
      const current = usePending()
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [done, setDone] = useState(null)
      const alive = useRef(true)

      useEffect(() => () => { alive.current = false }, [])

      const close = useCallback(() => {
        if (busy) return
        setError(null)
        setDone(null)
        request(null)
      }, [busy, request])

      // Escape closes, the way the shell's own dialogs behave.
      useEffect(() => {
        if (current === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') close() }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [current, close])

      if (current === null) return null

      const confirm = async () => {
        setBusy(true)
        setError(null)
        try {
          const result = await destroy(current.sessionId, current.displayTitle)
          if (!alive.current) return
          if (result.clean === false) {
            setError(`${t('partial')}: ${(result.failed ?? []).map(item => item.step).join(', ')}`)
            setBusy(false)
            return
          }
          setDone({ title: current.displayTitle })
          setBusy(false)
        } catch (reason) {
          if (!alive.current) return
          setError(reason instanceof Error ? reason.message : String(reason))
          setBusy(false)
        }
      }

      const overlay = {
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.42)',
      }
      const panel = {
        width: 'min(520px, calc(100vw - 32px))',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        color: 'var(--dsw-alias-text-primary, #1f2328)',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,0.12))',
        borderRadius: 12, padding: 20,
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.22)',
        font: '14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
      }
      const muted = { color: 'var(--dsw-alias-text-secondary, #6b7280)' }
      const danger = {
        background: 'var(--dsw-alias-state-error-primary, #d92d20)', color: '#fff',
        border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600,
      }
      const plain = {
        background: 'transparent', color: 'inherit',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,0.18))',
        borderRadius: 8, padding: '8px 16px', cursor: 'pointer',
      }

      if (done !== null) {
        return h('div', { style: overlay, onClick: close }, h('div', {
          style: { ...panel, cursor: 'default' },
          onClick: event => event.stopPropagation(),
          role: 'status',
        }, [
          h('div', { key: 'title', style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, t('done')),
          h('div', { key: 'body', style: muted }, t('doneDetail', { title: done.title || current.sessionId })),
          h('div', { key: 'actions', style: { display: 'flex', justifyContent: 'flex-end', marginTop: 18 } },
            h('button', { type: 'button', style: plain, onClick: close }, t('cancel'))),
        ]))
      }

      return h('div', { style: overlay, onClick: close }, h('div', {
        style: { ...panel, cursor: 'default' },
        onClick: event => event.stopPropagation(),
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('confirmTitle'),
      }, [
        h('div', { key: 'title', style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, t('confirmTitle')),
        h('div', { key: 'body' }, t('confirmBody', { title: current.displayTitle || current.sessionId })),
        current.logDirs.length === 0
          ? h('div', { key: 'nolog', style: { ...muted, marginTop: 8, fontSize: 13 } }, t('confirmNoLog'))
          : h('ul', { key: 'logs', style: { ...muted, marginTop: 8, paddingLeft: 18, fontSize: 12 } },
            current.logDirs.map(dir => h('li', { key: dir }, h('code', null, dir)))),
        current.running
          ? h('div', {
            key: 'running',
            style: { marginTop: 10, color: 'var(--dsw-alias-state-error-primary, #d92d20)', fontSize: 13 },
          }, t('confirmRunning'))
          : null,
        busy ? h('div', { key: 'busy', style: { ...muted, marginTop: 10, fontSize: 13 } }, t('pending')) : null,
        error !== null
          ? h('div', {
            key: 'error',
            role: 'alert',
            style: { marginTop: 10, color: 'var(--dsw-alias-state-error-primary, #d92d20)', fontSize: 13 },
          }, error)
          : null,
        h('div', { key: 'actions', style: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 } }, [
          h('button', { key: 'cancel', type: 'button', style: plain, disabled: busy, onClick: close }, t('cancel')),
          h('button', {
            key: 'confirm', type: 'button', style: danger, disabled: busy || current.running, onClick: confirm,
          }, t('confirm')),
        ]),
      ]))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'session-delete'
    exports.__test = { DICT }
    return module.exports
  },
})
