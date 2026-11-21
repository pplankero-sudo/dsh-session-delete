// Harness test for client.js: stub the browser globals the ModuleLoader bundle
// expects, then assert the menu contribution and the dialog's behaviour.
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8')

// --- globals the bundle touches ---------------------------------------------
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'Fragment',
  useState: (initial) => {
    // Minimal hook: storage lives on the fake instance keyed by call order.
    const slot = { value: typeof initial === 'function' ? initial() : initial }
    return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
  },
  useEffect: (fn) => { const cleanup = fn(); return cleanup },
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}
const loaded = {}
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded[id] = factory((name) => {
        if (name === 'react') return React
        throw new Error('unexpected require: ' + name)
      })
    },
  },
  addEventListener() {}, removeEventListener() {},
}
globalThis.document = { baseURI: 'http://127.0.0.1:52734/' }
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' })

// --- evaluate the bundle -----------------------------------------------------
new Function('window', 'document', 'fetch', source)(globalThis.window, globalThis.document, globalThis.fetch)

const mod = loaded['dsh-session-delete']
const problems = []
if (mod === undefined) problems.push('bundle did not export a module')
if (mod.applt !== undefined) { /* typo guard placeholder */ }

// --- drive apply() with a stub ctx ------------------------------------------
const menus = []
const slots = []
const effects = []
const ctx = {
  locale: { getLocale: () => ({ active: 'zh', locales: [], revision: 1 }) },
  sessions: { async refresh() { ctx.refreshed++ }, refreshed: 0 },
  slots: {
    inject(name, callback) { const dispose = callback(); return dispose },
    register(options, component) { slots.push({ options, component }); return () => {} },
  },
  contextMenus: { register(contribution) { menus.push(contribution); return () => {} } },
  effect(fn) { effects.push(fn()); return () => {} },
}

mod.apply(ctx)

// --- assertions --------------------------------------------------------------
if (menus.length !== 1) problems.push('expected 1 menu contribution, got ' + menus.length)
const menu = menus[0]
if (menu?.target !== 'session') problems.push('menu target is not "session"')
if (menu?.order !== 700) problems.push('menu order is ' + menu?.order)

const actions = menu?.resolve({ sessionId: 'session-abc', displayTitle: '测试会话' })
const action = actions?.[0]
if (action?.label !== '删除会话') problems.push('label is ' + JSON.stringify(action?.label))
if (action?.danger !== true) problems.push('action is not marked danger')
if (typeof action?.run !== 'function') problems.push('action has no run callback')

if (slots.length !== 1) problems.push('expected 1 overlay slot, got ' + slots.length)
if (slots[0]?.options?.name !== 'shell.overlay') problems.push('overlay slot name is ' + slots[0]?.options?.name)
if (slots[0]?.options?.id === undefined) problems.push('overlay slot has no id')
if (typeof slots[0]?.component !== 'function') problems.push('overlay component is not a function')

// English locale should switch the label.
const ctxEn = { ...ctx, locale: { getLocale: () => ({ active: 'en', locales: [], revision: 2 }) }, contextMenus: { register: (c) => { menus.push(c); return () => {} } } }
mod.apply(ctxEn)
if (menus[1]?.resolve({ sessionId: 's', displayTitle: 't' })[0]?.label !== 'Delete session') {
  problems.push('english label wrong')
}

// The overlay entry is a wrapper that renders the dialog; unwrap it to test both.
const Wrapper = slots[0].component
const element = Wrapper()
if (element === null || typeof element !== 'object') problems.push('overlay wrapper rendered nothing')
const Dialog = element?.type
if (typeof Dialog !== 'function') problems.push('unwrapped dialog is not a component')

// The dialog must render nothing while no request is pending.
const idle = Dialog({
  usePending: () => null,
  request: () => {},
  destroy: async () => ({}),
  t: (key) => key,
})
if (idle !== null) problems.push('dialog renders while idle')

// With a pending request it renders the confirmation copy.
const pending = {
  sessionId: 'session-abc', displayTitle: '测试会话',
  logDirs: ['C:/x/sessions/slug/session-abc'], running: false,
}
const busyUi = Dialog({
  usePending: () => pending,
  request: () => {},
  destroy: async () => ({ clean: true }),
  t: (key, vars) => (vars?.title ? `${key}:${vars.title}` : key),
})
if (busyUi === null) problems.push('dialog renders nothing while a request is pending')
const flat = JSON.stringify(busyUi)
if (!flat.includes('confirmTitle')) problems.push('dialog is missing the confirmation title')
if (!flat.includes('测试会话')) problems.push('dialog does not name the session')

// A running session must disable the destructive button.
const runningUi = JSON.stringify(Dialog({
  usePending: () => ({ ...pending, running: true }),
  request: () => {},
  destroy: async () => ({ clean: true }),
  t: (key) => key,
}))
if (!runningUi.includes('confirmRunning')) problems.push('running session warning missing')
if (!runningUi.includes('"disabled":true')) problems.push('confirm button not disabled while running')

console.log(problems.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL\n - ' + problems.join('\n - '))
process.exit(problems.length === 0 ? 0 : 1)
