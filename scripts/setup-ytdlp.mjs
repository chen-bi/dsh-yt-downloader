#!/usr/bin/env node
// 把 yt-dlp 装进本插件的 vendor/ 目录（不污染全局 Python 环境）。
//
// 用法：node scripts/setup-ytdlp.mjs [--upgrade]
//
// 优先用 uv（uv pip install --target），没有 uv 就退到 python -m pip。
// vendor/ 已进 .gitignore：克隆仓库后跑一次这个脚本即可。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR_DIR = path.join(PLUGIN_DIR, 'vendor')
const UPGRADE = process.argv.includes('--upgrade')

const isWindows = process.platform === 'win32'
const exe = (name) => (isWindows ? `${name}.exe` : name)

function run(command, args, timeoutMs = 600000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd: PLUGIN_DIR, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const raw = error ? error.code : 0
        const code = typeof raw === 'number' ? raw : raw === 'ENOENT' ? 127 : 1
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })
}

/** 找 uv：PATH → ~/.local/bin → %APPDATA%\uv → ~/.cargo/bin。 */
async function findUv() {
  const candidates = [
    'uv',
    path.join(os.homedir(), '.local', 'bin', exe('uv')),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'uv', exe('uv')) : '',
    path.join(os.homedir(), '.cargo', 'bin', exe('uv')),
  ].filter((item) => item !== '')

  for (const candidate of candidates) {
    if (candidate !== 'uv' && !existsSync(candidate)) continue
    const result = await run(candidate, ['--version'], 20000)
    if (result.code === 0) return candidate
  }
  return ''
}

/** 找 Python 3：uv 装的 → ~/.local/bin → PATH。 */
async function findPython() {
  const candidates = []
  const appdata = process.env.APPDATA
  if (appdata !== undefined && appdata !== '') {
    try {
      const uvRoot = path.join(appdata, 'uv', 'python')
      const entries = await readdir(uvRoot, { withFileTypes: true })
      const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
      for (const dir of dirs) candidates.push(path.join(uvRoot, dir, exe('python')))
    } catch {
      /* 没装 uv 的 Python 就跳过 */
    }
  }
  candidates.push(path.join(os.homedir(), '.local', 'bin', exe('python')))
  candidates.push('python')
  candidates.push('python3')

  for (const candidate of candidates) {
    if (candidate !== 'python' && candidate !== 'python3' && !existsSync(candidate)) continue
    const result = await run(candidate, ['-c', 'import sys; print(sys.version_info[0])'], 20000)
    if (result.code === 0 && result.stdout.trim().startsWith('3')) return candidate
  }
  return ''
}

function printTail(result) {
  const text = `${result.stdout}\n${result.stderr}`.trim()
  if (text === '') return
  console.log(text.split(/\r?\n/).slice(-15).join('\n'))
}

async function main() {
  console.log(`插件目录：${PLUGIN_DIR}`)
  console.log(`vendor  ：${VENDOR_DIR}`)

  const uv = await findUv()
  const python = await findPython()

  if (uv !== '' && python !== '') {
    console.log(`使用 uv：${uv}`)
    const args = ['pip', 'install', '--target', VENDOR_DIR, '--python', python]
    if (UPGRADE) args.push('--upgrade')
    args.push('yt-dlp')
    const result = await run(uv, args)
    printTail(result)
    if (result.code !== 0) return 1
  } else {
    if (python === '') {
      console.error('没找到 Python 3，也没找到可用的 uv。请先装 Python 3.9+ 或 uv：https://docs.astral.sh/uv/')
      return 1
    }
    const pipCheck = await run(python, ['-m', 'pip', '--version'], 30000)
    if (pipCheck.code !== 0) {
      console.error(`找到 Python 3（${python}），但它没有 pip。建议装 uv 后重跑：https://docs.astral.sh/uv/`)
      return 1
    }
    console.log(`使用 python -m pip：${python}`)
    const args = ['-m', 'pip', 'install', '--target', VENDOR_DIR]
    if (UPGRADE) args.push('--upgrade')
    args.push('yt-dlp')
    const result = await run(python, args)
    printTail(result)
    if (result.code !== 0) return 1
  }

  const version = await run(python, ['-c', 'import sys; sys.path.insert(0, r"%s"); import yt_dlp; print(yt_dlp.version.__version__)' % VENDOR_DIR], 60000)
  if (version.code === 0) {
    console.log(`\n完成：yt-dlp ${version.stdout.trim()} 已装进 vendor/`)
    console.log('接下来在 DSH 里 plugin_manager → install_bundle 指向本目录即可。')
    return 0
  }
  console.error('\nvendor/ 装好了，但导入 yt_dlp 失败。把上面的报错发给我看看。')
  return 1
}

process.exitCode = await main()
