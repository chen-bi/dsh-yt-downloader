/**
 * dsh-yt-downloader —— Host 半侧（手写插件，无构建步骤）。
 *
 * 一件事：把 YouTube 链接变成文件。后端全部逻辑都在这里：
 *   - 解析视频：`yt-dlp -J` 拿标题、封面、时长和完整格式表，整理成「画质选项」；
 *   - 下载：`yt-dlp -f <视频>+<音轨>` 或 `-x` 抽音频，实时解析进度；
 *   - 口子：/api/ytdl/*，给侧边栏面板用。
 *
 * yt-dlp 不依赖全局安装：包放在本插件目录的 vendor/ 下，用 uv 的 Python 跑
 * `python -m yt_dlp`。代理默认读 Windows 系统代理（注册表），面板里也能手写。
 *
 * 修改后做语法校验：node --check index.js
 */
import { execFile, spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const API_PREFIX = '/api/ytdl'
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = path.join(PLUGIN_DIR, 'vendor')
const CONFIG_DIR = path.join(os.homedir(), '.dsh', 'yt-downloader')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

/** 只放行 http(s) 链接：file/ftp/本地路径之类的协议不走这个口子。 */
function normalizeUrl(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw
  return 'https://' + raw
}

function isDownloadableUrl(value) {
  const normalized = normalizeUrl(value)
  if (normalized === '') return false
  try {
    const parsed = new URL(normalized)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const DEFAULT_CONFIG = {
  proxy: '',
  downloadDir: path.join(os.homedir(), 'Downloads'),
  audioFormat: 'mp3',
  /** '' = 不带 cookie；chrome/edge/firefox/brave/opera = --cookies-from-browser。 */
  cookiesFrom: '',
}

const TOOL_DESCRIPTION = `用任意视频/音频链接下载（和侧边栏「视频下载器」面板同一套后端，支持 yt-dlp 认识的 1000+ 站点和直链）。
- action:"probe"：先解析链接，返回标题、时长和可选的画质列表；
- action:"download"：下载。format 传 probe 返回的画质 id（如 "137"），mode 传 video 或 audio。
不确定画质就先 probe，用户没指定就挑 1080p（没有就挑最高的）。
只在用户明确要求下载某个链接的内容时使用。`

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['probe', 'download', 'status'], description: 'probe 解析 | download 下载 | status 看队列' },
    url: { type: 'string', description: '视频/音频页面的链接（http 或 https）' },
    format: { type: 'string', description: 'probe 返回的画质 id，例如 137；默认挑 1080p' },
    mode: { type: 'string', enum: ['video', 'audio'], description: 'video 下视频（默认）| audio 只抽音频' },
  },
  required: ['action'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    title: { type: 'string' },
    qualities: { type: 'string' },
    jobId: { type: 'string' },
  },
  required: ['ok', 'message'],
}

// ---- 配置 ---------------------------------------------------------------

let config = { ...DEFAULT_CONFIG }
let configLoaded = false

async function loadConfig() {
  if (configLoaded) return config
  configLoaded = true
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (parsed !== null && typeof parsed === 'object') {
      config = { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch {
    /* 第一次运行没有配置文件，用默认值 */
  }
  if (typeof config.downloadDir !== 'string' || config.downloadDir.trim() === '') {
    config.downloadDir = DEFAULT_CONFIG.downloadDir
  }
  return config
}

async function saveConfig(patch) {
  await loadConfig()
  const next = { ...config }
  if (patch !== null && typeof patch === 'object') {
    if (typeof patch.proxy === 'string') next.proxy = patch.proxy.trim()
    if (typeof patch.downloadDir === 'string' && patch.downloadDir.trim() !== '') next.downloadDir = patch.downloadDir.trim()
    if (typeof patch.audioFormat === 'string' && patch.audioFormat !== '') next.audioFormat = patch.audioFormat
    if (typeof patch.cookiesFrom === 'string') next.cookiesFrom = patch.cookiesFrom.trim()
  }
  config = next
  configLoaded = true
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  return config
}

// ---- 进程小工具 ---------------------------------------------------------

function run(file, args, timeout = 20000, envOverride = null) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout,
        windowsHide: true,
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
        ...(envOverride === null ? {} : { env: envOverride }),
      },
      (error, stdout, stderr) => {
        const rawCode = error ? error.code : 0
        const code = typeof rawCode === 'number' ? rawCode : rawCode === 'ENOENT' ? 127 : 1
        resolve({
          code,
          stdout: Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout ?? ''),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? ''),
        })
      },
    )
  })
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** yt-dlp 的报错很长，取最后一条 ERROR 行最有信息量。 */
function cleanError(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return 'yt-dlp 没有返回任何信息'
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (line.startsWith('ERROR')) return line.replace(/^ERROR:\s*/, '')
  }
  return lines[lines.length - 1].trim()
}

/** 把常见失败翻译成人话。 */
function friendlyError(text) {
  const raw = cleanError(text)
  if (/Sign in to confirm|not a bot|cookies/i.test(raw)) {
    return `${raw}\n（YouTube 要确认不是机器人：把你的代理换个节点，或者在「设置 → 浏览器 Cookie」里选一个登录过 YouTube 的浏览器——选之前先把那个浏览器完全退出）`
  }
  if (/WinError 10061|Connection refused|Tunnel connection failed|ProxyError/i.test(raw)) {
    return `${raw}（代理连不上：先打开你的代理软件，或在面板「设置」里填对代理地址）`
  }
  if (/getaddrinfo|Name or service not known|Temporary failure in name resolution/i.test(raw)) {
    return `${raw}（DNS 解析失败，多半是代理没开）`
  }
  if (/Video unavailable|Private video|removed/i.test(raw)) {
    return `${raw}（这个视频下不了：可能是私享、会员限定或已删除）`
  }
  if (/Unsupported URL|No video formats found|unsupported site|Unable to extract/i.test(raw)) {
    return `${raw}\n（yt-dlp 不认识这个链接：确认它是视频/音频页面，而不是普通网页；B 站/微博这类需要登录的站，可能在「设置 → 浏览器 Cookie」里选浏览器后才行）`
  }
  return raw
}

// ---- Python 与 yt-dlp 定位 ----------------------------------------------

let pythonPath = null
let pythonProbe = null

async function findPython() {
  if (pythonPath !== null) return pythonPath
  if (pythonProbe !== null) return pythonProbe

  const candidates = []
  const appdata = process.env.APPDATA
  if (appdata !== undefined && appdata !== '') {
    const uvRoot = path.join(appdata, 'uv', 'python')
    try {
      const entries = await readdir(uvRoot, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
      for (const dir of dirs) candidates.push(path.join(uvRoot, dir, 'python.exe'))
    } catch {
      /* 没装 uv 的 Python 就跳过 */
    }
  }
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'python.exe'))
  candidates.push('python')
  candidates.push('python3')

  for (const candidate of candidates) {
    if (candidate !== 'python' && candidate !== 'python3' && !existsSync(candidate)) continue
    const result = await run(candidate, ['-c', 'import sys; print(sys.version_info[0])'], 15000)
    if (result.code === 0 && result.stdout.trim().startsWith('3')) {
      pythonPath = candidate
      return candidate
    }
  }
  pythonProbe = null
  throw new Error('找不到可用的 Python 3：请先安装 Python 3.9+（或用 uv 装的 Python），再运行 node scripts/setup-ytdlp.mjs')
}

let ytdlpVersion = null
let ytdlpCheckedAt = 0

async function checkYtdlp(force = false) {
  const now = Date.now()
  if (!force && ytdlpVersion !== null && now - ytdlpCheckedAt < 60000) return ytdlpVersion
  const py = await findPython()
  const result = await run(py, ['-m', 'yt_dlp', '--version'], 30000, ytdlpEnv())
  const version = result.stdout.trim()
  if (result.code !== 0 || version === '') {
    throw new Error(`yt-dlp 不可用：${friendlyError(result.stderr || result.stdout)}`)
  }
  ytdlpVersion = version
  ytdlpCheckedAt = now
  return version
}

// ---- 代理 ---------------------------------------------------------------

let proxyCache = null
let proxyCacheAt = 0

/** 读 Windows 系统代理（注册表）。返回 { enabled, server }。 */
async function readSystemProxy() {
  const result = await run('reg.exe', [
    'query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  ])
  if (result.code !== 0) return { enabled: false, server: '' }
  const text = result.stdout
  const enableMatch = text.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i)
  const serverMatch = text.match(/ProxyServer\s+REG_SZ\s+(\S+)/i)
  const enabled = enableMatch !== null && parseInt(enableMatch[1], 16) === 1
  const server = serverMatch !== null ? serverMatch[1] : ''
  return { enabled: enabled && server !== '', server }
}

/** 解析代理：手动 > 系统代理 > 直连。 */
async function resolveProxy(force = false) {
  await loadConfig()
  const now = Date.now()
  if (!force && proxyCache !== null && now - proxyCacheAt < 30000) return proxyCache

  let result = { url: '', source: 'none', display: '' }
  if (config.proxy !== '') {
    result = { url: normalizeProxy(config.proxy), source: 'manual', display: config.proxy }
  } else {
    const system = await readSystemProxy()
    if (system.enabled) {
      result = { url: normalizeProxy(system.server), source: 'system', display: system.server }
    }
  }
  proxyCache = result
  proxyCacheAt = now
  return result
}

function normalizeProxy(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  if (/^[a-z]+:\/\//i.test(raw)) return raw
  return 'http://' + raw
}

/** 代理端口是否真的有人监听——用来区分「代理开着」和「代理软件没开」。 */
function portAlive(proxyUrl) {
  return new Promise((resolve) => {
    let host = '127.0.0.1'
    let port = 7890
    try {
      const parsed = new URL(proxyUrl)
      host = parsed.hostname
      port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
    } catch {
      resolve(false)
      return
    }
    const socket = net.connect({ host, port })
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(value)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1500, () => done(false))
  })
}

// ---- ffmpeg -------------------------------------------------------------

let ffmpegDir = null

async function findFfmpeg() {
  if (ffmpegDir !== null) return ffmpegDir
  const candidates = [
    path.join(os.homedir(), '.pyffmpeg', 'bin'),
    path.join(PLUGIN_DIR, 'vendor', 'bin'),
  ]
  for (const dir of candidates) {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    if (existsSync(path.join(dir, exe))) {
      ffmpegDir = dir
      return dir
    }
  }
  ffmpegDir = ''
  return ''
}

// ---- yt-dlp 命令 --------------------------------------------------------

/** yt-dlp 装在插件目录的 vendor/ 里，靠 PYTHONPATH 找到。 */
function ytdlpEnv() {
  return {
    ...process.env,
    PYTHONPATH: VENDOR_DIR,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONWARNINGS: 'ignore',
  }
}

async function ytdlpBaseArgs() {
  await loadConfig()
  const proxy = await resolveProxy()
  const args = ['-m', 'yt_dlp', '--no-colors', '--no-warnings', '--newline']
  if (proxy.url !== '') args.push('--proxy', proxy.url)
  if (config.cookiesFrom !== '') args.push('--cookies-from-browser', config.cookiesFrom)
  return args
}

// ---- 解析视频 -----------------------------------------------------------

function codecRank(vcodec) {
  const codec = String(vcodec ?? '')
  if (/^avc1/i.test(codec)) return 0 // H.264 兼容性最好
  if (/^vp0?9/i.test(codec)) return 1
  if (/^av01/i.test(codec)) return 2
  return 3
}

function codecName(vcodec) {
  const codec = String(vcodec ?? '')
  if (/^avc1/i.test(codec)) return 'H.264'
  if (/^vp0?9/i.test(codec)) return 'VP9'
  if (/^av01/i.test(codec)) return 'AV1'
  if (/^hev1|^hvc1/i.test(codec)) return 'HEVC'
  return codec === '' ? '未知' : codec.split('.')[0].toUpperCase()
}

function audioCodecName(acodec) {
  const codec = String(acodec ?? '')
  if (/^mp4a/i.test(codec)) return 'AAC'
  if (/^opus/i.test(codec)) return 'Opus'
  if (/^vorbis/i.test(codec)) return 'Vorbis'
  return codec === '' ? '未知' : codec.split('.')[0].toUpperCase()
}

function sizeOf(format) {
  if (format === null || format === undefined) return 0
  if (typeof format.filesize === 'number' && format.filesize > 0) return format.filesize
  if (typeof format.filesize_approx === 'number' && format.filesize_approx > 0) return format.filesize_approx
  return 0
}

/** 从 formats 里挑最好的音频轨：优先 m4a（合并进 mp4 最稳），再看码率。 */
function pickBestAudio(formats) {
  const audios = formats.filter((f) => {
    const hasVideo = f.vcodec !== undefined && f.vcodec !== null && f.vcodec !== 'none'
    const hasAudio = f.acodec !== undefined && f.acodec !== null && f.acodec !== 'none'
    return hasAudio && !hasVideo
  })
  if (audios.length === 0) return null
  const score = (f) => {
    const m4a = f.ext === 'm4a' ? 0 : f.ext === 'mp4' ? 1 : 2
    const abr = typeof f.abr === 'number' ? f.abr : 0
    return m4a * 1000 - abr
  }
  const sorted = audios.slice().sort((a, b) => score(a) - score(b))
  return sorted[0]
}

/**
 * 把 yt-dlp 的格式表整理成给人看的画质选项。
 *
 * 各站点给的格式差别很大，按优先级退：
 *   1. 只有画面的轨（最理想，配一条音频合并，能拿到最高画质）；
 *   2. 画面+声音一体的轨（很多小站点/直链只给这种），直接下；
 *   3. 什么都解析不出来（比如直链文件），留一个「最佳」兜底。
 */
function buildQualities(info) {
  const formats = Array.isArray(info.formats) ? info.formats : []
  const bestAudio = pickBestAudio(formats)
  const audioSize = sizeOf(bestAudio)

  const hasVideo = (f) => f.vcodec !== undefined && f.vcodec !== null && f.vcodec !== 'none'
  const hasAudio = (f) => f.acodec !== undefined && f.acodec !== null && f.acodec !== 'none'
  const resolved = (f) => typeof f.height === 'number' && f.height > 0

  const videoOnly = formats.filter((f) => hasVideo(f) && !hasAudio(f) && resolved(f))
  const merged = formats.filter((f) => hasVideo(f) && hasAudio(f) && resolved(f))
  const source = videoOnly.length > 0 ? videoOnly : merged
  const needsAudio = videoOnly.length > 0

  const byHeight = new Map()
  for (const format of source) {
    const height = format.height
    if (!byHeight.has(height)) byHeight.set(height, [])
    byHeight.get(height).push(format)
  }

  const qualities = []
  for (const [height, group] of byHeight.entries()) {
    const sorted = group.slice().sort((a, b) => {
      const rank = codecRank(a.vcodec) - codecRank(b.vcodec)
      if (rank !== 0) return rank
      const fpsA = typeof a.fps === 'number' ? a.fps : 0
      const fpsB = typeof b.fps === 'number' ? b.fps : 0
      if (fpsB !== fpsA) return fpsB - fpsA
      return sizeOf(b) - sizeOf(a)
    })
    const chosen = sorted[0]
    const fps = typeof chosen.fps === 'number' ? chosen.fps : 0
    qualities.push({
      id: String(chosen.format_id),
      height,
      fps,
      label: height >= 2160 ? '4K' : height >= 1440 ? '2K' : String(height) + 'p',
      sublabel: height + 'p' + (fps > 30 ? ' · ' + fps + 'fps' : ''),
      ext: chosen.ext === 'webm' ? 'webm' : 'mp4',
      codec: codecName(chosen.vcodec),
      size: sizeOf(chosen) + (needsAudio ? audioSize : 0),
      vcodec: String(chosen.vcodec ?? ''),
      /** 下载时要不要再配一条音频轨。 */
      merge: needsAudio,
    })
  }
  qualities.sort((a, b) => b.height - a.height)

  // 兜底：解析不出分辨率（直链 mp4、m3u8、音频站等）
  if (qualities.length === 0) {
    qualities.push({
      id: 'best',
      height: 0,
      fps: 0,
      label: '最佳',
      sublabel: '自动选最好的那条',
      ext: 'mp4',
      codec: '',
      size: sizeOf(bestAudio),
      vcodec: '',
      merge: false,
    })
  }

  // 音频：没有独立音轨时也能「从视频里抽」，所以永远给一个选项。
  const audio = bestAudio === null
    ? {
        id: 'bestaudio',
        codec: '自动',
        abr: 0,
        size: 0,
      }
    : {
        id: String(bestAudio.format_id),
        codec: audioCodecName(bestAudio.acodec),
        abr: typeof bestAudio.abr === 'number' ? bestAudio.abr : 0,
        size: sizeOf(bestAudio),
      }

  return { qualities, audio, hasAudio: true }
}

/**
 * 解析任意链接。yt-dlp 认识 1000+ 站点，认不出来的会报 Unsupported URL。
 * 遇到播放列表只取第一条（--no-playlist 已经不展开，这里再兜一层）。
 */
async function probeMedia(url) {
  const python = await findPython()
  const target = normalizeUrl(url)
  const args = [...(await ytdlpBaseArgs()), '-J', '--no-playlist', '--skip-download', target]
  const result = await run(python, args, 180000, ytdlpEnv())
  if (result.code !== 0) throw new Error(cleanError(result.stderr || result.stdout))

  const text = result.stdout
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('yt-dlp 没有返回可解析的数据')
  let info = JSON.parse(text.slice(start, end + 1))

  if (info._type === 'playlist') {
    const entries = Array.isArray(info.entries) ? info.entries.filter((entry) => entry !== null) : []
    if (entries.length === 0) throw new Error('这是一个空的播放列表/频道')
    info = entries[0]
  }

  const built = buildQualities(info)
  const thumbnail = typeof info.thumbnail === 'string'
    ? info.thumbnail
    : Array.isArray(info.thumbnails) && info.thumbnails.length > 0
      ? String(info.thumbnails[info.thumbnails.length - 1].url ?? '')
      : ''

  return {
    video: {
      id: String(info.id ?? ''),
      url: String(info.webpage_url ?? info.original_url ?? target),
      title: String(info.title ?? info.fulltitle ?? '（无标题）'),
      channel: String(info.channel ?? info.uploader ?? info.creator ?? ''),
      duration: typeof info.duration === 'number' ? info.duration : 0,
      thumbnail,
      viewCount: typeof info.view_count === 'number' ? info.view_count : 0,
      uploadDate: String(info.upload_date ?? ''),
      isLive: info.is_live === true,
      /** 站点名（YouTube / bilibili / twitter …），用来在界面上提示来源。 */
      site: String(info.extractor_key ?? info.extractor ?? ''),
    },
    qualities: built.qualities,
    audio: built.audio,
    hasAudio: built.hasAudio,
  }
}

// ---- 下载队列 -----------------------------------------------------------

/** @type {Map<string, any>} */
const jobs = new Map()
let jobSeq = 0

function jobSnapshot(job) {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    thumbnail: job.thumbnail,
    channel: job.channel,
    duration: job.duration,
    mode: job.mode,
    formatId: job.formatId,
    qualityLabel: job.qualityLabel,
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    sizeText: job.sizeText,
    filePath: job.filePath,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

function touch(job, patch) {
  Object.assign(job, patch)
  job.updatedAt = new Date().toISOString()
}

const PROGRESS_RE =
  /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(\S+)(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/

/** 「3.27MiB」「~1.99MiB」→ 字节；解析不了给 0。 */
function parseSizeText(text) {
  const match = String(text ?? '').match(/~?([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/i)
  if (match === null) return 0
  const units = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }
  const scale = units[match[2].toLowerCase()] ?? 0
  const value = parseFloat(match[1])
  return isFinite(value) ? value * scale : 0
}

/**
 * 视频要分两轨（画面 + 音轨）顺序下载再合并，进度是两条独立曲线。
 * 只跟踪最后一条会看到 100% → 0% 的倒退，所以按轨道取平均。
 */
function trackAverage(job) {
  if (!Array.isArray(job.tracks) || job.tracks.length === 0) return 0
  // 视频模式默认两轨（画面 + 音轨），音频模式一轨；第一条轨跑满也只算一半，
  // 免得进度先冲到 100% 再被第二条轨拉回去。
  const expected = Math.max(job.tracks.length, job.mode === 'audio' ? 1 : 2)
  const sum = job.tracks.reduce((total, track) => total + (Number(track.percent) || 0), 0)
  return Math.min(99, sum / expected)
}

function handleLine(job, line) {
  const text = line.trim()
  if (text === '') return

  const destination = text.match(/^\[download\]\s+Destination:\s+(.+)$/)
  if (destination !== null) {
    job.filePath = destination[1].trim()
    job.tracks.push({ total: 0, percent: 0 })
    return
  }

  const progress = text.match(PROGRESS_RE)
  if (progress !== null) {
    let track = job.tracks[job.tracks.length - 1]
    if (track === undefined) {
      track = { total: 0, percent: 0 }
      job.tracks.push(track)
    }
    track.percent = Math.min(100, Number(progress[1]))
    const total = parseSizeText(progress[2])
    if (total > 0) track.total = total

    touch(job, {
      status: 'downloading',
      percent: trackAverage(job),
      sizeText: progress[2],
      speed: progress[3] && progress[3] !== 'Unknown' ? progress[3] : '',
      eta: progress[4] && progress[4] !== 'Unknown' ? progress[4] : '',
    })
    return
  }

  const merge = text.match(/^\[Merger\]\s+Merging formats into\s+"(.+)"$/)
  if (merge !== null) {
    job.filePath = merge[1].trim()
    return
  }
  const extract = text.match(/^\[ExtractAudio\]\s+Destination:\s+(.+)$/)
  if (extract !== null) {
    job.filePath = extract[1].trim()
    return
  }
  const fixup = text.match(/^(?:\[FixupM4a\]|\[MoveFiles\])\s+.*?"?(.+)"?$/)
  if (fixup !== null && job.filePath === '') {
    job.filePath = fixup[1].trim().replace(/^"|"$/g, '')
  }
}

async function spawnDownload(job) {
  const python = await findPython()
  const base = await ytdlpBaseArgs()
  const ffmpeg = await findFfmpeg()

  const args = [
    ...base,
    '--no-playlist',
    '--playlist-items',
    '1',
    '--progress',
    '-P',
    config.downloadDir,
    '-o',
    '%(title).120B [%(id)s].%(ext)s',
  ]

  if (job.mode === 'audio') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', config.audioFormat || 'mp3', '--audio-quality', '0')
  } else if (job.formatId === '' || job.formatId === 'best') {
    // 站点只给一条「最佳」时直接交给 yt-dlp 自己挑
    args.push('-f', 'best', '--merge-output-format', 'mp4')
  } else if (job.merge === true) {
    const selector = `${job.formatId}+bestaudio[ext=m4a]/${job.formatId}+bestaudio/${job.formatId}+best`
    args.push('-f', selector, '--merge-output-format', job.ext === 'webm' ? 'mkv' : 'mp4')
  } else {
    // 画面+声音一体的单轨格式，别再拼音频
    args.push('-f', job.formatId, '--merge-output-format', job.ext === 'webm' ? 'mkv' : 'mp4')
  }
  if (ffmpeg !== '') args.push('--ffmpeg-location', ffmpeg)
  args.push(job.url)

  await mkdir(config.downloadDir, { recursive: true })

  const child = spawn(python, args, {
    cwd: PLUGIN_DIR,
    env: ytdlpEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  job.child = child

  let buffer = ''
  let stderrText = ''
  const onData = (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(job, line)
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    stderrText += text
    const lines = stderrText.split(/\r?\n/)
    stderrText = lines.pop() ?? ''
    for (const line of lines) handleLine(job, line)
  })

  return new Promise((resolve) => {
    child.on('error', (error) => {
      touch(job, { status: 'error', error: messageOf(error) })
      resolve()
    })
    child.on('close', (code) => {
      job.child = null
      if (job.status === 'canceled') {
        resolve()
        return
      }
      if (code === 0) {
        touch(job, { status: 'done', percent: 100, speed: '', eta: '' })
      } else {
        touch(job, {
          status: 'error',
          error: friendlyError(stderrText + '\n' + buffer) || `yt-dlp 退出码 ${code}`,
        })
      }
      resolve()
    })
  })
}

async function createJob(input) {
  await loadConfig()
  const url = normalizeUrl(input?.url)
  if (!isDownloadableUrl(url)) throw new Error('这不是一个 http(s) 链接')

  const mode = input?.mode === 'audio' ? 'audio' : 'video'
  jobSeq += 1
  const job = {
    id: 'job' + jobSeq,
    url,
    title: String(input?.title ?? url),
    thumbnail: String(input?.thumbnail ?? ''),
    channel: String(input?.channel ?? ''),
    duration: typeof input?.duration === 'number' ? input.duration : 0,
    mode,
    formatId: String(input?.formatId ?? ''),
    merge: input?.merge === true,
    qualityLabel: String(input?.qualityLabel ?? ''),
    ext: input?.ext === 'webm' ? 'webm' : 'mp4',
    status: 'queued',
    percent: 0,
    speed: '',
    eta: '',
    sizeText: '',
    filePath: '',
    error: '',
    tracks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    child: null,
  }
  if (mode === 'video' && job.formatId === '') throw new Error('还没选画质')
  jobs.set(job.id, job)
  spawnDownload(job).catch((error) => {
    touch(job, { status: 'error', error: messageOf(error) })
  })
  return job
}

// ---- HTTP ---------------------------------------------------------------

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text, 'utf8')),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('请求体过大'))
        if (typeof req.destroy === 'function') req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolve(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function readState() {
  await loadConfig()
  const proxy = await resolveProxy()
  const alive = proxy.url === '' ? true : await portAlive(proxy.url)

  let version = ''
  let ytdlpError = ''
  try {
    version = await checkYtdlp()
  } catch (error) {
    ytdlpError = messageOf(error)
  }

  const ffmpeg = await findFfmpeg()
  const list = Array.from(jobs.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(jobSnapshot)

  return {
    ok: true,
    ytdlp: { ready: version !== '', version, error: ytdlpError },
    ffmpeg: { ready: ffmpeg !== '', path: ffmpeg },
    proxy: {
      url: proxy.url,
      display: proxy.display,
      source: proxy.source,
      alive,
    },
    downloadDir: config.downloadDir,
    cookiesFrom: config.cookiesFrom,
    jobs: list,
  }
}

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.flv': 'video/x-flv',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
}

function contentTypeOf(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 把下载好的文件直接流给浏览器——手机通过局域网打开这个面板时，
 * 点一下就能存进手机自己的下载目录，而不是只躺在电脑硬盘里。
 * 带 Range 支持，手机播放器也能直接拖进度条。
 */
async function streamJobFile(req, res, job) {
  const filePath = typeof job?.filePath === 'string' ? job.filePath : ''
  if (filePath === '' || !existsSync(filePath)) {
    return sendJson(res, 404, { ok: false, error: '文件不在了，可能被移走或删掉了' })
  }

  const info = await stat(filePath)
  const total = info.size
  const filename = path.basename(filePath)
  const headers = {
    'content-type': contentTypeOf(filePath),
    'content-disposition': `attachment; filename="download${path.extname(filePath)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }

  const range = typeof req.headers?.range === 'string' ? req.headers.range : ''
  const match = range.startsWith('bytes=') ? range.match(/bytes=(\d*)-(\d*)/) : null
  if (match !== null) {
    let start = match[1] === '' ? 0 : parseInt(match[1], 10)
    let end = match[2] === '' ? total - 1 : parseInt(match[2], 10)
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= total) end = total - 1
    if (start > end || start >= total) {
      res.writeHead(416, { 'content-range': `bytes */${total}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${total}`,
      'content-length': String(end - start + 1),
    })
    createReadStream(filePath, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, { ...headers, 'content-length': String(total) })
  createReadStream(filePath).pipe(res)
}

/** 打开下载的文件 / 所在文件夹。 */
async function openPath(target, reveal) {
  const raw = String(target ?? '').trim()
  if (raw === '') throw new Error('没有文件可打开')
  const absolute = path.resolve(raw)
  if (!existsSync(absolute)) throw new Error('文件不在了：' + absolute)

  if (reveal) {
    const folder = path.dirname(absolute)
    await run('explorer.exe', ['/select,', absolute], 8000)
    return folder
  }
  await run('cmd.exe', ['/c', 'start', '', absolute], 8000)
  return absolute
}

// ---- 插件入口 -----------------------------------------------------------

export const name = 'dsh-yt-downloader'
export const inject = ['tools', 'webServer']

function textBlock(text) {
  return [{ type: 'text', text }]
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return value.toFixed(value >= 100 || unit === 0 ? 0 : 1) + ' ' + units[unit]
}

export function apply(ctx) {
  // ---- 1. 同源接口 ------------------------------------------------------
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const route = url.pathname.slice(API_PREFIX.length) || '/'
            const method = req.method ?? 'GET'

            if (route === '/state' && (method === 'GET' || method === 'HEAD')) {
              await loadConfig()
              return sendJson(res, 200, await readState())
            }

            if (route === '/probe' && method === 'POST') {
              let body = null
              try {
                body = await readBody(req)
              } catch {
                return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              }
              const link = normalizeUrl(body?.url)
              if (!isDownloadableUrl(link)) return sendJson(res, 400, { ok: false, error: '这不是一个 http(s) 链接' })
              await loadConfig()
              const proxy = await resolveProxy()
              if (proxy.url !== '') {
                const alive = await portAlive(proxy.url)
                if (!alive) {
                  return sendJson(res, 502, {
                    ok: false,
                    error: `代理 ${proxy.display} 没有在监听：先打开你的代理软件，或在「设置」里换一个代理地址`,
                    code: 'PROXY_DOWN',
                  })
                }
              }
              try {
                const data = await probeMedia(link)
                return sendJson(res, 200, { ok: true, ...data })
              } catch (error) {
                return sendJson(res, 502, { ok: false, error: friendlyError(messageOf(error)) })
              }
            }

            if (route === '/download' && method === 'POST') {
              let body = null
              try {
                body = await readBody(req)
              } catch {
                return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              }
              try {
                const job = await createJob(body)
                return sendJson(res, 200, { ok: true, job: jobSnapshot(job) })
              } catch (error) {
                return sendJson(res, 400, { ok: false, error: friendlyError(messageOf(error)) })
              }
            }

            if (route === '/jobs' && (method === 'GET' || method === 'HEAD')) {
              const list = Array.from(jobs.values())
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .map(jobSnapshot)
              return sendJson(res, 200, { ok: true, jobs: list })
            }

            if (route === '/cancel' && method === 'POST') {
              const body = await readBody(req).catch(() => ({}))
              const job = jobs.get(String(body?.id ?? ''))
              if (job === undefined) return sendJson(res, 404, { ok: false, error: '没有这个任务' })
              if (job.status === 'downloading' || job.status === 'queued') {
                touch(job, { status: 'canceled', speed: '', eta: '' })
                if (job.child !== null) {
                  try {
                    job.child.kill()
                  } catch {
                    /* 进程可能已经退了 */
                  }
                }
              }
              return sendJson(res, 200, { ok: true, job: jobSnapshot(job) })
            }

            if (route === '/remove' && method === 'POST') {
              const body = await readBody(req).catch(() => ({}))
              const id = String(body?.id ?? '')
              jobs.delete(id)
              return sendJson(res, 200, { ok: true })
            }

            if (route === '/open' && method === 'POST') {
              const body = await readBody(req).catch(() => ({}))
              try {
                const opened = await openPath(body?.path, body?.reveal === true)
                return sendJson(res, 200, { ok: true, path: opened })
              } catch (error) {
                return sendJson(res, 400, { ok: false, error: messageOf(error) })
              }
            }

            if (route === '/file' && (method === 'GET' || method === 'HEAD')) {
              const id = url.searchParams.get('id') ?? ''
              const job = jobs.get(id)
              if (job === undefined) return sendJson(res, 404, { ok: false, error: '没有这个任务' })
              if (method === 'HEAD') {
                const filePath = typeof job.filePath === 'string' ? job.filePath : ''
                if (filePath === '' || !existsSync(filePath)) {
                  return sendJson(res, 404, { ok: false, error: '文件不在了' })
                }
                const size = (await stat(filePath)).size
                res.writeHead(200, {
                  'content-type': contentTypeOf(filePath),
                  'accept-ranges': 'bytes',
                  'content-length': String(size),
                  'cache-control': 'no-store',
                })
                res.end()
                return
              }
              return streamJobFile(req, res, job)
            }

            if (route === '/settings' && method === 'POST') {
              const body = await readBody(req).catch(() => ({}))
              try {
                const saved = await saveConfig(body)
                proxyCache = null
                return sendJson(res, 200, { ok: true, config: saved })
              } catch (error) {
                return sendJson(res, 400, { ok: false, error: messageOf(error) })
              }
            }

            return sendJson(res, 404, { ok: false, error: 'not found' })
          } catch (error) {
            try {
              sendJson(res, 500, { ok: false, error: messageOf(error) })
            } catch {
              /* 响应已断开 */
            }
          }
        },
      }),
    'dsh-yt-downloader: api',
  )

  // ---- 2. 工具：聊天里也能下 -------------------------------------------
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'youtube_download',
        description: TOOL_DESCRIPTION,
        parameters: PARAMETERS,
        output: {
          schema: OUTPUT_SCHEMA,
          render: (_args, value) => textBlock(typeof value?.message === 'string' ? value.message : ''),
        },
        presentCall: (args) => ({
          card: 'generic',
          title: `YouTube · ${args?.action === 'probe' ? '解析' : args?.action === 'status' ? '队列' : '下载'}`,
          kind: 'other',
        }),
        execute: async (args) => {
          const action = typeof args?.action === 'string' ? args.action : 'probe'
          try {
            if (action === 'status') {
              await loadConfig()
              const list = Array.from(jobs.values())
              const running = list.filter((j) => j.status === 'downloading').length
              return {
                ok: true,
                message:
                  list.length === 0
                    ? '下载队列是空的。'
                    : `队列里 ${list.length} 条，正在下载 ${running} 条：\n` +
                      list
                        .slice(0, 8)
                        .map((j) => `- ${j.title}（${j.mode === 'audio' ? '音频' : j.qualityLabel || '视频'}）${j.status} ${j.percent.toFixed(0)}%`)
                        .join('\n'),
              }
            }

            const url = normalizeUrl(args?.url)
            if (!isDownloadableUrl(url)) return { ok: false, message: '这不是一个 http(s) 链接' }

            const info = await probeMedia(url)

            if (action === 'probe') {
              const lines = info.qualities.map((q) => `${q.label}（${q.sublabel} · ${q.codec}${q.size > 0 ? ' · ' + formatSize(q.size) : ''}）id=${q.id}`)
              return {
                ok: true,
                title: info.video.title,
                qualities: lines.join('\n'),
                message:
                  `${info.video.title}\n${info.video.site ? info.video.site + ' · ' : ''}时长 ${info.video.duration}s · ${info.video.channel}\n可用画质：\n${lines.join('\n')}` +
                  `\n音频：${info.audio.codec}${info.audio.abr > 0 ? ' ' + info.audio.abr + 'k' : ''}`,
              }
            }

            if (action === 'download') {
              const mode = args?.mode === 'audio' ? 'audio' : 'video'
              let chosen = info.qualities.find((q) => q.id === String(args?.format ?? ''))
              if (chosen === undefined && mode === 'video') {
                chosen =
                  info.qualities.find((q) => q.height === 1080 && q.codec === 'H.264') ??
                  info.qualities.find((q) => q.height === 1080) ??
                  info.qualities[0]
              }
              if (mode === 'video' && chosen === undefined) {
                return { ok: false, message: '这个链接没有可下载的画面轨' }
              }
              const job = await createJob({
                url,
                mode,
                formatId: chosen !== undefined ? chosen.id : '',
                merge: chosen !== undefined ? chosen.merge === true : false,
                qualityLabel: chosen !== undefined ? chosen.label : '音频',
                title: info.video.title,
                thumbnail: info.video.thumbnail,
                channel: info.video.channel,
                duration: info.video.duration,
                ext: chosen !== undefined ? chosen.ext : 'mp4',
              })
              return {
                ok: true,
                jobId: job.id,
                title: info.video.title,
                message: `开始下载《${info.video.title}》${mode === 'audio' ? '音频' : ' · ' + chosen.label}，随时在侧边栏「视频下载器」看进度。`,
              }
            }

            return { ok: false, message: `未知 action：${action}` }
          } catch (error) {
            return { ok: false, message: friendlyError(messageOf(error)) }
          }
        },
      }),
    'dsh-yt-downloader: tool',
  )
}
