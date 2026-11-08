/**
 * dsh-yt-downloader 自检：mock 一个最小 ctx，直接调 Host 半侧的 HTTP 路由。
 * 用法：node smoke.mjs            （只测 /state 与 /settings，不联网）
 *       node smoke.mjs --probe    （额外探测一个真实视频，需要代理可用）
 */
import { apply } from './index.js'

let handler = null
const tools = []

const ctx = {
  effect(fn) {
    fn()
    return () => {}
  },
  webServer: {
    register(options) {
      handler = options.handler
      return () => {}
    },
  },
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
}

apply(ctx)

function makeReq(method, url, body) {
  const listeners = {}
  const req = {
    method,
    url,
    on(event, fn) {
      ;(listeners[event] ??= []).push(fn)
      return req
    },
    destroy() {},
  }
  setImmediate(() => {
    if (body !== undefined) {
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      for (const fn of listeners.data ?? []) fn(Buffer.from(text, 'utf8'))
    }
    for (const fn of listeners.end ?? []) fn()
  })
  return req
}

function call(method, path, body) {
  return new Promise((resolve) => {
    const chunks = []
    let status = 0
    const res = {
      writeHead(code) {
        status = code
      },
      end(text) {
        resolve({ status, data: (() => { try { return JSON.parse(String(text)) } catch { return text } })() })
      },
    }
    handler(makeReq(method, path, body), res).catch((error) => resolve({ status: 500, data: String(error) }))
  })
}

function ok(label, condition, detail) {
  console.log((condition ? '  ✅ ' : '  ❌ ') + label + (detail ? ' — ' + detail : ''))
  if (!condition) process.exitCode = 1
}

const wantProbe = process.argv.includes('--probe')

console.log('1) 工具注册')
ok('youtube_download 已注册', tools.some((tool) => tool.name === 'youtube_download'))

console.log('2) GET /api/ytdl/state')
const state = await call('GET', '/api/ytdl/state')
console.log('   ', JSON.stringify(state.data, null, 1).split('\n').slice(0, 14).join('\n   '))
ok('返回 ok', state.data.ok === true)
ok('yt-dlp 就绪', state.data.ytdlp?.ready === true, state.data.ytdlp?.version || state.data.ytdlp?.error)
ok('读到了下载目录', typeof state.data.downloadDir === 'string' && state.data.downloadDir !== '')
ok('读到了代理状态', typeof state.data.proxy?.source === 'string', `source=${state.data.proxy?.source} alive=${state.data.proxy?.alive}`)

console.log('3) POST /api/ytdl/settings（写回同一个值，不改配置）')
const settings = await call('POST', '/api/ytdl/settings', { downloadDir: state.data.downloadDir })
ok('保存成功', settings.data.ok === true)

console.log('4) 拒绝非 http(s) 链接')
const bad = await call('POST', '/api/ytdl/probe', { url: 'file:///C:/windows/system32/calc.exe' })
ok('被判成非法链接', bad.status === 400 || bad.data.ok === false, bad.data.error)

if (wantProbe) {
  console.log('5) POST /api/ytdl/probe（真实网络）')
  const probe = await call('POST', '/api/ytdl/probe', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
  if (probe.data.ok) {
    console.log('   ', probe.data.video.title, '·', probe.data.qualities.length, '档画质')
    for (const quality of probe.data.qualities.slice(0, 8)) {
      console.log(`    - ${quality.label} (${quality.sublabel}) ${quality.codec} ${Math.round(quality.size / 1024 / 1024)}MB id=${quality.id}`)
    }
    ok('画质数量 > 0', probe.data.qualities.length > 0)
    ok('有音频轨', probe.data.audio !== null)
    ok('画质有 1080p', probe.data.qualities.some((quality) => quality.height === 1080))
  } else {
    ok('探测成功', false, probe.data.error)
  }
}

console.log('\n自检结束')
