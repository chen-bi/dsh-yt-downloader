/**
 * client.js 自检：mock 一个浏览器环境，跑一遍工厂 + apply，确认不抛错、slot 都注册了。
 * 用法：node client-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

const registrations = []
let exported = null
let factoryError = null

function makeElement(tag) {
  return {
    tagName: tag,
    textContent: '',
    parentNode: null,
    setAttribute() {},
    appendChild(child) {
      child.parentNode = this
    },
    removeChild() {},
  }
}

const head = makeElement('head')
head.appendChild = function (child) {
  child.parentNode = head
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: {
    __ModuleLoader__: {
      load(definition) {
        try {
          const mockReact = {
            createElement: (type, props, ...children) => ({ type, props, children }),
            useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
            useEffect: () => {},
            useRef: (value) => ({ current: value }),
          }
          exported = definition.factory((name) => {
            if (name === 'react') return mockReact
            throw new Error('unexpected require: ' + name)
          })
        } catch (error) {
          factoryError = error
        }
      },
    },
    setTimeout,
    clearTimeout,
  },
  document: {
    createElement: makeElement,
    head,
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  },
  navigator: { clipboard: { readText: () => Promise.resolve('') } },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
}

vm.runInNewContext(source, sandbox)

function ok(label, condition, detail) {
  console.log((condition ? '  ✅ ' : '  ❌ ') + label + (detail ? ' — ' + detail : ''))
  if (!condition) process.exitCode = 1
}

ok('工厂没有抛错', factoryError === null, factoryError ? String(factoryError) : '')
ok('导出对象存在', exported !== null && typeof exported === 'object')

if (exported !== null) {
  ok('name 正确', exported.name === 'dsh-yt-downloader', exported.name)
  ok('inject 含 slots/locale', Array.isArray(exported.inject) && exported.inject.includes('slots') && exported.inject.includes('locale'))

  const ctx = {
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      bind: () => (key) => null,
      register() {},
      subscribe: () => () => {},
    },
    slots: {
      inject(owner, register) {
        ok('通过 ctx.slots.inject 挂到 ' + owner, true)
        register()
      },
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
    get() {
      return null
    },
    layout: null,
  }

  try {
    exported.apply(ctx)
    ok('apply 没有抛错', true)
  } catch (error) {
    ok('apply 没有抛错', false, String(error))
  }

  ok('注册了 2 个 slot entry', registrations.length === 2, registrations.map((entry) => entry.name).join(', '))
  const sidebar = registrations.find((entry) => entry.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.name === 'main')
  ok('侧边栏 id = ytdl', sidebar !== undefined && sidebar.id === 'ytdl', sidebar?.id)
  ok('主面板 key = ytdl', main !== undefined && main.key === 'ytdl', main?.key)
}
