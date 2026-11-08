/**
 * 下载链路实测：改到临时目录 → 探测 → 下 360p → 轮询进度 → 校验文件 → 还原设置。
 * 用法：node download-test.mjs
 */
import { apply } from './index.js'
import { existsSync } from 'node:fs'
import { rm, mkdir } from 'node:fs/promises'
import path from 'node:path'

const TMP = path.join(process.cwd(), '.tmp-download-test')

let handler = null
apply({
  effect(fn) {
    fn()
    return () => {}
  },
  webServer: { register(options) { handler = options.handler; return () => {} } },
  tools: { register() { return () => {} } },
})

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

function call(method, pathname, body) {
  return new Promise((resolve) => {
    let status = 0
    handler(makeReq(method, pathname, body), {
      writeHead(code) { status = code },
      end(text) {
        let parsed = text
        try { parsed = JSON.parse(String(text)) } catch { /* keep text */ }
        resolve({ status, data: parsed })
      },
    }).catch((error) => resolve({ status: 500, data: String(error) }))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const before = await call('GET', '/api/ytdl/state')
const originalDir = before.data.downloadDir
console.log('原下载目录:', originalDir)

await mkdir(TMP, { recursive: true })
await call('POST', '/api/ytdl/settings', { downloadDir: TMP })
console.log('临时改到:', TMP)

try {
  const probe = await call('POST', '/api/ytdl/probe', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
  if (!probe.data.ok) throw new Error('探测失败: ' + probe.data.error)
  const target = probe.data.qualities.find((q) => q.height === 360) ?? probe.data.qualities[probe.data.qualities.length - 1]
  console.log('选画质:', target.label, target.codec, 'id=' + target.id)

  const created = await call('POST', '/api/ytdl/download', {
    url: probe.data.video.url,
    mode: 'video',
    formatId: target.id,
    qualityLabel: target.label,
    ext: target.ext,
    title: probe.data.video.title,
    thumbnail: probe.data.video.thumbnail,
    duration: probe.data.video.duration,
  })
  if (!created.data.ok) throw new Error('建任务失败: ' + created.data.error)
  const jobId = created.data.job.id
  console.log('任务:', jobId)

  let last = -1
  for (let i = 0; i < 300; i += 1) {
    await sleep(800)
    const jobs = await call('GET', '/api/ytdl/jobs')
    const job = (jobs.data.jobs ?? []).find((j) => j.id === jobId)
    if (!job) throw new Error('任务消失了')
    const shown = Math.round(job.percent)
    if (shown !== last) {
      last = shown
      console.log(`  ${job.status.padEnd(11)} ${String(shown).padStart(3)}% ${job.speed || ''} ${job.eta ? 'ETA ' + job.eta : ''}`)
    }
    if (job.status === 'done') {
      console.log('文件:', job.filePath)
      console.log(existsSync(job.filePath) ? '✅ 文件已落盘' : '❌ 文件不存在')
      break
    }
    if (job.status === 'error') throw new Error('下载失败: ' + job.error)
  }
} finally {
  await call('POST', '/api/ytdl/settings', { downloadDir: originalDir })
  console.log('下载目录已还原:', originalDir)
  await rm(TMP, { recursive: true, force: true })
}
