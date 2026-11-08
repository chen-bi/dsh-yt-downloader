/**
 * dsh-yt-downloader —— 浏览器半侧（手写的 __ModuleLoader__ bundle，无构建步骤）。
 *
 * 侧边栏常驻入口（sidebar.panellist）+ 主面板（main#ytdl）：
 *   粘一条 YouTube 链接 → 解析出封面/标题/画质 → 选画质或「仅音频」→ 下载，
 *   下面一条实时进度、速度、剩余时间；下完能直接在资源管理器里定位。
 *
 * 数据只走同源 HTTP：/api/ytdl/*（Host 半侧 index.js），和聊天里的 youtube_download 工具共用一套逻辑。
 *
 * ⚠️ 两条硬规矩（踩过，代价是整个应用打不开）：
 *   - 工厂函数里必须自带 `var module = { exports: {} }`，最后 `module.exports = …`；
 *   - 任何可能抛异常的地方都要兜住（require / apply 整体 try-catch），
 *     宁可插件自己什么都不做，也不能拖垮启动。
 *
 * 改完用 `node --check client.js` 验证语法。
 */

window.__ModuleLoader__.load({
  id: 'dsh-yt-downloader',
  factory: function (require) {
    var module = { exports: {} }

    var React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }

    var h = React ? React.createElement : null
    var useState = React ? React.useState : null
    var useEffect = React ? React.useEffect : null
    var useRef = React ? React.useRef : null

    var NS = 'dsh-yt-downloader'
    var API = '/api/ytdl'

    var boundTranslate = null
    var localeService = null
    var layoutService = null

    // ---- 文案 -------------------------------------------------------------

    var ZH = {
      title: '视频下载器',
      subtitle: '粘链接 · 选画质 · 存到本地',
      back: '回到对话',
      settings: '设置',
      urlPlaceholder: '粘贴任意视频链接…',
      paste: '粘贴',
      parse: '解析',
      parsing: '解析中…',
      pasteFailed: '读不到剪贴板，按 Ctrl+V 直接粘在框里',
      needUrl: '先粘一条链接',
      videoTab: '视频',
      audioTab: '仅音频',
      qualityTitle: '画质',
      audioTitle: '音频',
      audioHint: '最好的音轨，转成 {fmt}',
      download: '下载',
      downloading: '下载中',
      prefer: '推荐',
      size: '约 {size}',
      queueTitle: '下载队列',
      queueEmpty: '还没有下载任务',
      queueEmptyHint: '解析一条链接，选好画质就会排在这里。',
      statusQueued: '排队中',
      statusDownloading: '下载中',
      statusDone: '已完成',
      statusError: '失败',
      statusCanceled: '已取消',
      cancel: '取消',
      openFile: '打开文件',
      openFolder: '打开文件夹',
      saveToDevice: '存到本机',
      remove: '移除',
      clearDone: '清空已完成',
      unknownError: '未知错误',
      settingsTitle: '设置',
      proxyLabel: '代理',
      proxyAuto: '自动（跟随 Windows 系统代理）',
      proxyManual: '手动指定',
      proxyPlaceholder: '例如 127.0.0.1:7897，留空 = 自动',
      proxyAlive: '代理在线',
      proxyDead: '代理未连上',
      proxyOff: '直连',
      cookieLabel: '浏览器 Cookie',
      cookieNone: '不用',
      cookieHint: 'YouTube 要求「确认不是机器人」时，选一个登录过 YouTube 的浏览器；选之前先把那个浏览器完全退出。',
      dirLabel: '保存到',
      dirPlaceholder: '例如 C:\\Users\\me\\Downloads',
      save: '保存',
      saved: '已保存',
      engineLabel: '下载引擎',
      engineOk: 'yt-dlp {version}',
      engineBad: '不可用：{error}',
      ffmpegLabel: '音视频合并',
      ffmpegOk: 'ffmpeg 就绪',
      ffmpegBad: '没找到 ffmpeg（只能下带音轨的单文件画质）',
      emptyTitle: '把链接丢进来吧',
      emptyBody: 'YouTube、B站、X、Instagram、直播回放、直链 mp4……只要 yt-dlp 认得出，都能下。选好画质点下载，文件会存到你指定的文件夹。',
      emptyTip: '打不开的站点，先在「设置」里确认代理和浏览器 Cookie 是通的。',
      siteLabel: '来源',
      duration: '{t}',
      views: '{n} 次观看',
      live: '直播',
      pickQuality: '先选一个画质',
      errPrefix: '出错了：',
      close: '收起',
    }

    var EN = {
      title: 'Video Downloader',
      subtitle: 'Paste a link, pick a quality, keep the file',
      back: 'Back to chat',
      settings: 'Settings',
      urlPlaceholder: 'Paste any video link…',
      paste: 'Paste',
      parse: 'Fetch',
      parsing: 'Fetching…',
      pasteFailed: 'Clipboard is blocked — press Ctrl+V in the box',
      needUrl: 'Paste a link first',
      videoTab: 'Video',
      audioTab: 'Audio only',
      qualityTitle: 'Quality',
      audioTitle: 'Audio',
      audioHint: 'Best audio track, converted to {fmt}',
      download: 'Download',
      downloading: 'Downloading',
      prefer: 'Best',
      size: '~{size}',
      queueTitle: 'Downloads',
      queueEmpty: 'No downloads yet',
      queueEmptyHint: 'Fetch a link and pick a quality to start.',
      statusQueued: 'Queued',
      statusDownloading: 'Downloading',
      statusDone: 'Done',
      statusError: 'Failed',
      statusCanceled: 'Canceled',
      cancel: 'Cancel',
      openFile: 'Open file',
      openFolder: 'Show in folder',
      saveToDevice: 'Save here',
      remove: 'Remove',
      clearDone: 'Clear finished',
      unknownError: 'Unknown error',
      settingsTitle: 'Settings',
      proxyLabel: 'Proxy',
      proxyAuto: 'Automatic (follow the Windows system proxy)',
      proxyManual: 'Manual',
      proxyPlaceholder: 'e.g. 127.0.0.1:7897 — empty means auto',
      proxyAlive: 'Proxy reachable',
      proxyDead: 'Proxy unreachable',
      proxyOff: 'Direct',
      cookieLabel: 'Browser cookies',
      cookieNone: 'None',
      cookieHint: 'When YouTube asks to confirm you are not a bot, pick a browser that is signed in to YouTube — quit it completely first.',
      dirLabel: 'Save to',
      dirPlaceholder: 'e.g. C:\\Users\\me\\Downloads',
      save: 'Save',
      saved: 'Saved',
      engineLabel: 'Engine',
      engineOk: 'yt-dlp {version}',
      engineBad: 'Unavailable: {error}',
      ffmpegLabel: 'Merge',
      ffmpegOk: 'ffmpeg ready',
      ffmpegBad: 'ffmpeg missing (single-file formats only)',
      emptyTitle: 'Drop a link here',
      emptyBody: 'YouTube, Bilibili, X, Instagram, livestream replays, plain mp4 links — anything yt-dlp recognizes. Pick a quality and hit download.',
      emptyTip: 'If a site will not load, check the proxy and browser cookies under Settings first.',
      siteLabel: 'Source',
      duration: '{t}',
      views: '{n} views',
      live: 'LIVE',
      pickQuality: 'Pick a quality first',
      errPrefix: 'Failed: ',
      close: 'Close',
    }

    function t(key, vars) {
      var text = null
      try {
        if (boundTranslate !== null) text = boundTranslate(key)
      } catch (error) {
        text = null
      }
      if (typeof text !== 'string' || text === '' || text === key) text = ZH[key] !== undefined ? ZH[key] : key
      if (vars !== null && vars !== undefined && typeof vars === 'object') {
        Object.keys(vars).forEach(function (name) {
          text = text.split('{' + name + '}').join(String(vars[name]))
        })
      }
      return text
    }

    function messageOf(error) {
      if (error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '') {
        return error.message
      }
      return String(error)
    }

    function goPanel(panelId) {
      var target = layoutService
      if (target === null || target === undefined || typeof target.selectPanel !== 'function') return
      try {
        target.selectPanel(panelId)
      } catch (error) {
        console.error('[dsh-yt-downloader] selectPanel failed', error)
      }
    }

    // ---- 格式化小工具 -----------------------------------------------------

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return ''
      var units = ['B', 'KB', 'MB', 'GB']
      var value = bytes
      var unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      return (value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[unit]
    }

    function formatDuration(seconds) {
      var total = Math.round(Number(seconds) || 0)
      if (total <= 0) return ''
      var h2 = Math.floor(total / 3600)
      var m = Math.floor((total % 3600) / 60)
      var s = total % 60
      var pad = function (n) {
        return n < 10 ? '0' + n : String(n)
      }
      return h2 > 0 ? h2 + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
    }

    function formatViews(count) {
      var n = Number(count) || 0
      if (n <= 0) return ''
      if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
      if (n >= 10000) return (n / 10000).toFixed(1) + '万'
      return String(n)
    }

    function readJson(res) {
      return res
        .json()
        .catch(function () {
          return {}
        })
        .then(function (data) {
          if (!res.ok) {
            var message =
              data !== null && typeof data === 'object' && typeof data.error === 'string'
                ? data.error
                : 'HTTP ' + res.status
            var failure = new Error(message)
            failure.code = data !== null && typeof data === 'object' && typeof data.code === 'string' ? data.code : ''
            throw failure
          }
          if (data !== null && typeof data === 'object' && data.ok === false) {
            throw new Error(typeof data.error === 'string' ? data.error : '请求失败')
          }
          return data === null || typeof data !== 'object' ? {} : data
        })
    }

    function postJson(path, body) {
      return fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      }).then(readJson)
    }

    function getJson(path) {
      return fetch(API + path, { cache: 'no-store' }).then(readJson)
    }

    /** 语言切换时强制重渲染。 */
    function useLocaleTick() {
      var pair = useState(0)
      useEffect(function () {
        if (localeService === null || typeof localeService.subscribe !== 'function') return undefined
        var off = localeService.subscribe(function () {
          pair[1](function (n) {
            return n + 1
          })
        })
        return function () {
          if (typeof off === 'function') off()
        }
      }, [])
    }

    // ---- 主机状态 + 队列轮询 ----------------------------------------------

    function useHostState() {
      var pair = useState({ ready: false, state: null })
      var value = pair[0]
      var setValue = pair[1]

      useEffect(function () {
        var alive = true
        var timer = null

        function load() {
          if (!alive) return
          getJson('/state')
            .then(function (data) {
              if (!alive) return
              setValue({ ready: true, state: data })
            })
            .catch(function () {
              if (!alive) return
              setValue({ ready: true, state: null })
            })
            .then(function () {
              if (alive) timer = setTimeout(load, 15000)
            })
        }

        load()
        return function () {
          alive = false
          if (timer !== null) clearTimeout(timer)
        }
      }, [])

      return value
    }

    function useJobs() {
      var pair = useState([])
      var jobs = pair[0]
      var setJobs = pair[1]
      var tickPair = useState(0)
      var version = tickPair[0]
      var setVersion = tickPair[1]

      useEffect(function () {
        var alive = true
        var timer = null

        function schedule(delay) {
          if (!alive) return
          timer = setTimeout(step, delay)
        }

        function step() {
          if (!alive) return
          if (typeof document !== 'undefined' && document.hidden) {
            schedule(3000)
            return
          }
          getJson('/jobs')
            .then(function (data) {
              if (!alive) return
              var list = Array.isArray(data.jobs) ? data.jobs : []
              setJobs(list)
              var active = list.some(function (job) {
                return job.status === 'downloading' || job.status === 'queued'
              })
              schedule(active ? 900 : 5000)
            })
            .catch(function () {
              if (alive) schedule(4000)
            })
        }

        step()
        return function () {
          alive = false
          if (timer !== null) clearTimeout(timer)
        }
      }, [version])

      return {
        jobs: jobs,
        refresh: function () {
          setVersion(function (n) {
            return n + 1
          })
        },
      }
    }

    // ---- 图标 -------------------------------------------------------------

    function svgProps(size) {
      return {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }
    }

    function PlayGlyph(props) {
      return h('svg', svgProps(props.size || 16), h('path', { d: 'M8.5 5.6v12.8l10.2-6.4z', fill: 'currentColor', stroke: 'none' }))
    }

    function SidebarIcon(props) {
      var size = typeof props.size === 'number' && props.size > 0 ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('rect', { x: '2.6', y: '5', width: '18.8', height: '14', rx: '4.2', fill: '#4f6ef7', opacity: props.active === true ? '1' : '0.92' }),
        h('path', { d: 'M10.1 9.2v5.6l4.9-2.8z', fill: '#fff', stroke: 'none' }),
        h('path', { d: 'M12 15.1v3.2m0 0 1.7-1.7M12 18.3l-1.7-1.7', stroke: '#fff', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function LinkIcon() {
      return h(
        'svg',
        svgProps(15),
        h('path', { d: 'M10.3 6.2a4 4 0 0 1 5.6 5.6l-1.4 1.4' }),
        h('path', { d: 'M13.7 17.8a4 4 0 0 1-5.6-5.6l1.4-1.4' }),
        h('path', { d: 'M9 15l6-6' }),
      )
    }

    function DownloadIcon() {
      return h('svg', svgProps(15), h('path', { d: 'M12 3.8v10.4' }), h('path', { d: 'm7.4 10.2 4.6 4.6 4.6-4.6' }), h('path', { d: 'M4.8 18.4h14.4' }))
    }

    function FolderIcon() {
      return h('svg', svgProps(14), h('path', { d: 'M3.4 7.2h6l1.6 2h8.2v8.2a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8Z' }), h('path', { d: 'M3.4 7.2V6a1.8 1.8 0 0 1 1.8-1.8h3.4' }))
    }

    function GearIcon() {
      return h(
        'svg',
        svgProps(15),
        h('circle', { cx: '12', cy: '12', r: '3.1' }),
        h('path', {
          d: 'M19.4 14.2a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z',
        }),
      )
    }

    function CloseIcon() {
      return h('svg', svgProps(13), h('path', { d: 'm6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6' }))
    }

    function Spinner() {
      return h('span', { className: 'yt-spin', 'aria-hidden': 'true' })
    }

    // ---- 视频卡 -----------------------------------------------------------

    function Thumb(props) {
      var src = typeof props.src === 'string' ? props.src : ''
      var broken = useState(false)
      var isBroken = broken[0]
      var setBroken = broken[1]
      var tall = props.tall === true

      if (src === '' || isBroken) {
        return h('div', { className: 'yt-thumb yt-thumb-blank' + (tall ? ' yt-thumb-tall' : ''), 'aria-hidden': 'true' }, h(PlayGlyph, { size: 18 }))
      }
      return h(
        'div',
        { className: 'yt-thumb' + (tall ? ' yt-thumb-tall' : '') },
        h('img', {
          src: src,
          alt: '',
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
          onError: function () {
            setBroken(true)
          },
        }),
        props.duration ? h('span', { className: 'yt-thumb-time' }, props.duration) : null,
      )
    }

    function formatLabelFor(quality) {
      if (quality === null || quality === undefined) return ''
      return quality.label === '4K' || quality.label === '2K' ? quality.label : quality.label
    }

    function ProbeCard(props) {
      var data = props.data
      var selected = props.selected
      var onSelect = props.onSelect
      var mode = props.mode
      var onMode = props.onMode
      var onDownload = props.onDownload
      var busy = props.busy
      var downloadDir = props.downloadDir

      var video = data.video
      var qualities = Array.isArray(data.qualities) ? data.qualities : []
      var audio = data.audio
      var best = qualities.length > 0 ? qualities[0] : null
      var picked = null
      for (var i = 0; i < qualities.length; i += 1) {
        if (qualities[i].id === selected) picked = qualities[i]
      }
      var target = mode === 'audio' ? audio : picked
      var sizeText = target !== null && target !== undefined && target.size > 0 ? formatBytes(target.size) : ''

      var meta = []
      if (video.site) meta.push(video.site)
      if (video.channel) meta.push(video.channel)
      if (video.duration > 0) meta.push(formatDuration(video.duration))
      if (video.viewCount > 0) meta.push(t('views', { n: formatViews(video.viewCount) }))
      if (video.isLive) meta.push(t('live'))

      return h(
        'section',
        { className: 'yt-card yt-probe' },
        h(
          'div',
          { className: 'yt-video' },
          h(Thumb, { src: video.thumbnail, duration: video.duration > 0 ? formatDuration(video.duration) : '' }),
          h(
            'div',
            { className: 'yt-video-info' },
            h('div', { className: 'yt-video-title', title: video.title }, video.title),
            h('div', { className: 'yt-video-meta' }, meta.join(' · ')),
          ),
        ),

        h(
          'div',
          { className: 'yt-tabs' },
          h(
            'button',
            {
              type: 'button',
              className: 'yt-tab' + (mode === 'video' ? ' yt-tab-on' : ''),
              'aria-pressed': mode === 'video' ? 'true' : 'false',
              onClick: function () {
                onMode('video')
              },
            },
            t('videoTab'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'yt-tab' + (mode === 'audio' ? ' yt-tab-on' : ''),
              'aria-pressed': mode === 'audio' ? 'true' : 'false',
              onClick: function () {
                onMode('audio')
              },
            },
            t('audioTab'),
          ),
        ),

        mode === 'video'
          ? h(
              'div',
              { className: 'yt-quality' },
              h('div', { className: 'yt-quality-hd' }, t('qualityTitle')),
              qualities.length === 0
                ? h('div', { className: 'yt-note' }, '这个视频没有可下载的画面轨')
                : h(
                    'div',
                    { className: 'yt-chips', role: 'radiogroup', 'aria-label': t('qualityTitle') },
                    qualities.map(function (quality, index) {
                      var on = quality.id === selected
                      var isBest = index === 0
                      return h(
                        'button',
                        {
                          type: 'button',
                          key: quality.id,
                          role: 'radio',
                          'aria-checked': on ? 'true' : 'false',
                          className: 'yt-chip' + (on ? ' yt-chip-on' : ''),
                          onClick: function () {
                            onSelect(quality.id)
                          },
                        },
                        h('span', { className: 'yt-chip-main' }, formatLabelFor(quality)),
                        h(
                          'span',
                          { className: 'yt-chip-sub' },
                          quality.codec + (quality.size > 0 ? ' · ' + formatBytes(quality.size) : ''),
                        ),
                        isBest ? h('span', { className: 'yt-chip-tag' }, t('prefer')) : null,
                      )
                    }),
                  ),
            )
          : h(
              'div',
              { className: 'yt-quality' },
              h('div', { className: 'yt-quality-hd' }, t('audioTitle')),
              h(
                'div',
                { className: 'yt-audio-box' },
                h(
                  'div',
                  { className: 'yt-audio-main' },
                  audio !== null && audio !== undefined
                    ? h('span', null, audio.codec + (audio.abr > 0 ? ' ' + Math.round(audio.abr) + 'k' : ''))
                    : h('span', null, '最佳音轨'),
                ),
                h('div', { className: 'yt-audio-sub' }, t('audioHint', { fmt: 'MP3' })),
              ),
            ),

        h(
          'div',
          { className: 'yt-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'yt-cta',
              disabled: busy || (mode === 'video' && picked === null) || (mode === 'audio' && (audio === null || audio === undefined)),
              onClick: onDownload,
            },
            busy ? h(Spinner) : h(DownloadIcon),
            h('span', null, busy ? t('downloading') : t('download')),
            h('span', { className: 'yt-cta-tail' }, mode === 'audio' ? 'MP3' : formatLabelFor(picked)),
          ),
          sizeText !== ''
            ? h('span', { className: 'yt-size' }, t('size', { size: sizeText }))
            : null,
          downloadDir
            ? h('span', { className: 'yt-dir', title: downloadDir }, h(FolderIcon), downloadDir)
            : null,
        ),
      )
    }

    // ---- 队列行 -----------------------------------------------------------

    function JobRow(props) {
      var job = props.job
      var onCancel = props.onCancel
      var onRemove = props.onRemove
      var onOpen = props.onOpen

      var statusText =
        job.status === 'downloading'
          ? (job.mode === 'audio' ? '音频' : job.qualityLabel || '视频') + ' · ' + job.percent.toFixed(0) + '%'
          : job.status === 'done'
            ? t('statusDone')
            : job.status === 'error'
              ? t('statusError')
              : job.status === 'canceled'
                ? t('statusCanceled')
                : t('statusQueued')

      var percent = typeof job.percent === 'number' ? Math.max(0, Math.min(100, job.percent)) : 0
      var isActive = job.status === 'downloading' || job.status === 'queued'

      return h(
        'div',
        { className: 'yt-job yt-job-' + job.status },
        h(Thumb, { src: job.thumbnail, tall: true }),
        h(
          'div',
          { className: 'yt-job-body' },
          h('div', { className: 'yt-job-title', title: job.title }, job.title),
          h(
            'div',
            { className: 'yt-job-line' },
            h('span', { className: 'yt-job-status' }, statusText),
            job.speed && job.status === 'downloading' ? h('span', { className: 'yt-dot' }) : null,
            job.speed && job.status === 'downloading' ? h('span', { className: 'yt-job-dim' }, job.speed) : null,
            job.eta && job.status === 'downloading' ? h('span', { className: 'yt-job-dim' }, 'ETA ' + job.eta) : null,
            job.sizeText ? h('span', { className: 'yt-job-dim' }, job.sizeText) : null,
            job.error ? h('span', { className: 'yt-job-error', title: job.error }, job.error) : null,
          ),
          isActive
            ? h('div', { className: 'yt-bar' }, h('div', { className: 'yt-bar-fill', style: { width: percent + '%' } }))
            : null,
        ),
        h(
          'div',
          { className: 'yt-job-acts' },
          job.status === 'done' && props.remote !== true
            ? h(
                'button',
                { type: 'button', className: 'yt-mini', onClick: function () { onOpen(job, false) }, title: t('openFile') },
                t('openFile'),
              )
            : null,
          job.status === 'done' && props.remote !== true
            ? h(
                'button',
                { type: 'button', className: 'yt-mini', onClick: function () { onOpen(job, true) }, title: t('openFolder') },
                h(FolderIcon),
                t('openFolder'),
              )
            : null,
          job.status === 'done'
            ? h(
                'button',
                { type: 'button', className: 'yt-mini', onClick: function () { props.onSave(job) }, title: t('saveToDevice') },
                h(DownloadIcon),
                t('saveToDevice'),
              )
            : null,
          isActive
            ? h('button', { type: 'button', className: 'yt-mini', onClick: function () { onCancel(job.id) } }, t('cancel'))
            : h('button', { type: 'button', className: 'yt-mini yt-mini-ghost', onClick: function () { onRemove(job.id) } }, t('remove')),
        ),
      )
    }

    // ---- 设置面板 ---------------------------------------------------------

    function SettingsPanel(props) {
      var state = props.state
      var onSaved = props.onSaved
      var proxyInput = useState(state !== null && state.proxy !== null && state.proxy !== undefined && state.proxy.source === 'manual' ? state.proxy.display || '' : '')
      var proxyManual = proxyInput[0]
      var setProxyManual = proxyInput[1]
      var dirState = useState(state !== null && state !== null && state.downloadDir ? state.downloadDir : '')
      var dir = dirState[0]
      var setDir = dirState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var savedState = useState('')
      var saved = savedState[0]
      var setSaved = savedState[1]
      var cookieState = useState(state !== null && typeof state.cookiesFrom === 'string' ? state.cookiesFrom : '')
      var cookiesFrom = cookieState[0]
      var setCookiesFrom = cookieState[1]

      var proxy = state !== null && state !== null ? state.proxy : null
      var proxyDisplay = proxy !== null && proxy !== undefined ? proxy.display || '' : ''
      var proxySource = proxy !== null && proxy !== undefined ? proxy.source : 'none'
      var proxyAlive = proxy !== null && proxy !== undefined ? proxy.alive === true : false

      function save() {
        if (busy) return
        setBusy(true)
        setSaved('')
        postJson('/settings', { proxy: proxyManual, downloadDir: dir, cookiesFrom: cookiesFrom })
          .then(function () {
            setBusy(false)
            setSaved(t('saved'))
            if (typeof onSaved === 'function') onSaved()
          })
          .catch(function (error) {
            setBusy(false)
            setSaved(t('errPrefix') + messageOf(error))
          })
      }

      return h(
        'section',
        { className: 'yt-card yt-settings' },
        h('div', { className: 'yt-settings-title' }, t('settingsTitle')),

        h(
          'div',
          { className: 'yt-field' },
          h('label', { className: 'yt-label' }, t('proxyLabel')),
          h('div', { className: 'yt-proxy-row' },
            h(
              'span',
              { className: 'yt-badge ' + (proxySource === 'none' ? 'yt-badge-off' : proxyAlive ? 'yt-badge-ok' : 'yt-badge-bad') },
              proxySource === 'none' ? t('proxyOff') : proxyAlive ? t('proxyAlive') : t('proxyDead'),
            ),
            h('span', { className: 'yt-proxy-auto' }, proxySource === 'system' ? t('proxyAuto') + ' · ' + proxyDisplay : proxySource === 'none' ? t('proxyAuto') : ''),
          ),
          h('input', {
            className: 'yt-input',
            value: proxyManual,
            placeholder: t('proxyPlaceholder'),
            onChange: function (event) {
              setProxyManual(event.target.value)
            },
          }),
          h('div', { className: 'yt-hint' }, t('proxyPlaceholder')),
        ),

        h(
          'div',
          { className: 'yt-field' },
          h('label', { className: 'yt-label' }, t('dirLabel')),
          h('input', {
            className: 'yt-input',
            value: dir,
            placeholder: t('dirPlaceholder'),
            onChange: function (event) {
              setDir(event.target.value)
            },
          }),
        ),

        h(
          'div',
          { className: 'yt-field' },
          h('label', { className: 'yt-label' }, t('cookieLabel')),
          h(
            'div',
            { className: 'yt-chips yt-cookie-chips', role: 'radiogroup', 'aria-label': t('cookieLabel') },
            ['', 'chrome', 'edge', 'firefox'].map(function (value) {
              var on = value === cookiesFrom
              var label = value === '' ? t('cookieNone') : value.charAt(0).toUpperCase() + value.slice(1)
              return h(
                'button',
                {
                  type: 'button',
                  key: value === '' ? 'none' : value,
                  role: 'radio',
                  'aria-checked': on ? 'true' : 'false',
                  className: 'yt-chip' + (on ? ' yt-chip-on' : ''),
                  onClick: function () {
                    setCookiesFrom(value)
                  },
                },
                h('span', { className: 'yt-chip-main' }, label),
              )
            }),
          ),
          h('div', { className: 'yt-hint' }, t('cookieHint')),
        ),

        h(
          'div',
          { className: 'yt-diag' },
          h(
            'div',
            { className: 'yt-diag-row' },
            h('span', { className: 'yt-diag-k' }, t('engineLabel')),
            h(
              'span',
              { className: state !== null && state !== null && state.ytdlp && state.ytdlp.ready ? 'yt-diag-v yt-ok' : 'yt-diag-v yt-bad' },
              state !== null && state !== null && state.ytdlp && state.ytdlp.ready
                ? t('engineOk', { version: state.ytdlp.version })
                : t('engineBad', { error: state !== null && state !== null && state.ytdlp ? state.ytdlp.error : '未就绪' }),
            ),
          ),
          h(
            'div',
            { className: 'yt-diag-row' },
            h('span', { className: 'yt-diag-k' }, t('ffmpegLabel')),
            h(
              'span',
              { className: state !== null && state !== null && state.ffmpeg && state.ffmpeg.ready ? 'yt-diag-v yt-ok' : 'yt-diag-v yt-bad' },
              state !== null && state !== null && state.ffmpeg && state.ffmpeg.ready ? t('ffmpegOk') : t('ffmpegBad'),
            ),
          ),
        ),

        h(
          'div',
          { className: 'yt-settings-ft' },
          h(
            'button',
            { type: 'button', className: 'yt-save', disabled: busy, onClick: save },
            busy ? h(Spinner) : null,
            t('save'),
          ),
          saved !== '' ? h('span', { className: saved.startsWith(t('errPrefix')) ? 'yt-save-msg yt-bad' : 'yt-save-msg yt-ok' }, saved) : null,
        ),
      )
    }

    // ---- 主面板 -----------------------------------------------------------

    function DownloaderPanel() {
      useLocaleTick()
      var host = useHostState()
      var state = host.state

      /** 通过局域网/手机访问时，「打开文件/文件夹」在这头没意义，换成「存到本机」。 */
      var remote = false
      try {
        if (typeof location !== 'undefined') {
          var hostname = String(location.hostname || '')
          remote = hostname !== '' && hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]'
        }
      } catch (error) {
        remote = false
      }

      var urlState = useState('')
      var url = urlState[0]
      var setUrl = urlState[1]
      var probeState = useState(null)
      var probe = probeState[0]
      var setProbe = probeState[1]
      var selectedState = useState('')
      var selected = selectedState[0]
      var setSelected = selectedState[1]
      var modeState = useState('video')
      var mode = modeState[0]
      var setMode = modeState[1]
      var probingState = useState(false)
      var probing = probingState[0]
      var setProbing = probingState[1]
      var errorState = useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var settingsState = useState(false)
      var settingsOpen = settingsState[0]
      var setSettingsOpen = settingsState[1]
      var busyDownloadState = useState(false)
      var downloading = busyDownloadState[0]
      var setDownloading = busyDownloadState[1]

      var jobsFeed = useJobs()
      var jobs = jobsFeed.jobs
      var refreshJobs = jobsFeed.refresh

      /** 解析：链接 → 视频信息 + 画质列表。 */
      function doProbe() {
        var link = url.trim()
        if (link === '') {
          setError(t('needUrl'))
          return
        }
        if (probing) return
        setProbing(true)
        setError('')
        setProbe(null)
        postJson('/probe', { url: link })
          .then(function (data) {
            setProbing(false)
            setProbe(data)
            var qualities = Array.isArray(data.qualities) ? data.qualities : []
            var pick = null
            for (var i = 0; i < qualities.length; i += 1) {
              if (qualities[i].height === 1080 && qualities[i].codec === 'H.264') pick = qualities[i]
            }
            if (pick === null) {
              for (var j = 0; j < qualities.length; j += 1) {
                if (qualities[j].height === 1080) pick = qualities[j]
              }
            }
            if (pick === null && qualities.length > 0) pick = qualities[0]
            setSelected(pick !== null ? pick.id : '')
          })
          .catch(function (err) {
            setProbing(false)
            setError(messageOf(err))
          })
      }

      function doDownload() {
        if (probe === null || downloading) return
        var video = probe.video
        var quality = null
        var qualities = Array.isArray(probe.qualities) ? probe.qualities : []
        for (var i = 0; i < qualities.length; i += 1) {
          if (qualities[i].id === selected) quality = qualities[i]
        }
        if (mode === 'video' && quality === null) {
          setError(t('pickQuality'))
          return
        }
        setDownloading(true)
        setError('')
        postJson('/download', {
          url: video.url,
          mode: mode,
          formatId: quality !== null ? quality.id : '',
          merge: quality !== null && quality.merge === true,
          qualityLabel: quality !== null ? quality.label : '音频',
          ext: quality !== null ? quality.ext : 'mp4',
          title: video.title,
          thumbnail: video.thumbnail,
          channel: video.channel,
          duration: video.duration,
        })
          .then(function () {
            setDownloading(false)
            setProbe(null)
            setUrl('')
          })
          .catch(function (err) {
            setDownloading(false)
            setError(messageOf(err))
          })
      }

      function pasteFromClipboard() {
        if (navigator === undefined || navigator.clipboard === undefined || typeof navigator.clipboard.readText !== 'function') {
          setError(t('pasteFailed'))
          return
        }
        navigator.clipboard
          .readText()
          .then(function (text) {
            if (typeof text === 'string' && text.trim() !== '') setUrl(text.trim())
          })
          .catch(function () {
            setError(t('pasteFailed'))
          })
      }

      function cancelJob(id) {
        postJson('/cancel', { id: id }).catch(function () {})
      }

      function removeJob(id) {
        postJson('/remove', { id: id })
          .catch(function () {})
          .then(function () {
            refreshJobs()
          })
      }

      function openJob(job, reveal) {
        if (job === null || job === undefined || !job.filePath) return
        postJson('/open', { path: job.filePath, reveal: reveal === true }).catch(function (err) {
          setError(messageOf(err))
        })
      }

      /** 直接把文件从宿主流到当前设备（手机在局域网上打开时，存进手机自己）。 */
      function saveToDevice(job) {
        if (job === null || job === undefined || !job.id) return
        try {
          var link = document.createElement('a')
          link.href = API + '/file?id=' + encodeURIComponent(job.id)
          link.setAttribute('download', '')
          link.rel = 'noopener'
          document.body.appendChild(link)
          link.click()
          if (link.parentNode !== null) link.parentNode.removeChild(link)
        } catch (error) {
          setError(messageOf(error))
        }
      }

      function clearDone() {
        var settled = jobs.filter(function (job) {
          return job.status === 'done' || job.status === 'error' || job.status === 'canceled'
        })
        settled.forEach(function (job) {
          postJson('/remove', { id: job.id }).catch(function () {})
        })
        window.setTimeout(refreshJobs, 400)
      }

      try {
        var runningCount = jobs.filter(function (job) {
          return job.status === 'downloading'
        }).length
        var finishedCount = jobs.filter(function (job) {
          return job.status === 'done' || job.status === 'error' || job.status === 'canceled'
        }).length

        return h(
          'div',
          { className: 'yt-page' },
          h(
            'div',
            { className: 'yt-page-in' },
            h(
              'header',
              { className: 'yt-hd' },
              h('span', { className: 'yt-logo', 'aria-hidden': 'true' }, h(PlayGlyph, { size: 15 })),
              h(
                'div',
                { className: 'yt-hd-text' },
                h('div', { className: 'yt-hd-title' }, t('title')),
                h('div', { className: 'yt-hd-sub' }, t('subtitle')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'yt-ghost' + (settingsOpen ? ' yt-ghost-on' : ''),
                  onClick: function () {
                    setSettingsOpen(!settingsOpen)
                  },
                },
                h(GearIcon),
                t('settings'),
              ),
              h('button', { type: 'button', className: 'yt-ghost', onClick: function () { goPanel('conversation') } }, t('back')),
            ),

            h(
              'section',
              { className: 'yt-card yt-url-card' },
              h(
                'div',
                { className: 'yt-url-row' },
                h(
                  'div',
                  { className: 'yt-input-wrap' },
                  h('span', { className: 'yt-input-icon' }, h(LinkIcon)),
                  h('input', {
                    className: 'yt-input yt-url-input',
                    value: url,
                    placeholder: t('urlPlaceholder'),
                    spellCheck: false,
                    onChange: function (event) {
                      setUrl(event.target.value)
                    },
                    onKeyDown: function (event) {
                      if (event.key === 'Enter') doProbe()
                    },
                  }),
                ),
                h('button', { type: 'button', className: 'yt-paste', onClick: pasteFromClipboard }, t('paste')),
                h(
                  'button',
                  { type: 'button', className: 'yt-probe-btn', disabled: probing, onClick: doProbe },
                  probing ? h(Spinner) : null,
                  probing ? t('parsing') : t('parse'),
                ),
              ),
              h('div', { className: 'yt-url-hint' }, 'YouTube · B站 · X · 直链 —— yt-dlp 认得出的站点都行'),
            ),

            error !== ''
              ? h(
                  'div',
                  { className: 'yt-alert' },
                  h('span', { className: 'yt-alert-text' }, error),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'yt-alert-x',
                      onClick: function () {
                        setError('')
                      },
                      'aria-label': t('close'),
                    },
                    h(CloseIcon),
                  ),
                )
              : null,

            probing
              ? h(
                  'section',
                  { className: 'yt-card yt-skeleton' },
                  h('div', { className: 'yt-sk-thumb' }),
                  h(
                    'div',
                    { className: 'yt-sk-lines' },
                    h('div', { className: 'yt-sk-line yt-sk-w70' }),
                    h('div', { className: 'yt-sk-line yt-sk-w40' }),
                  ),
                  h('div', { className: 'yt-sk-chips' }, h('span'), h('span'), h('span'), h('span')),
                )
              : probe !== null
                ? h(ProbeCard, {
                    data: probe,
                    selected: selected,
                    onSelect: setSelected,
                    mode: mode,
                    onMode: setMode,
                    onDownload: doDownload,
                    busy: downloading,
                    downloadDir: state !== null && state !== null ? state.downloadDir : '',
                  })
                : h(
                    'section',
                    { className: 'yt-empty' },
                    h('div', { className: 'yt-empty-orb', 'aria-hidden': 'true' }, h(PlayGlyph, { size: 22 })),
                    h('div', { className: 'yt-empty-title' }, t('emptyTitle')),
                    h('div', { className: 'yt-empty-body' }, t('emptyBody')),
                    h('div', { className: 'yt-empty-tip' }, t('emptyTip')),
                  ),

            settingsOpen ? h(SettingsPanel, { state: state, onSaved: function () {} }) : null,

            h(
              'section',
              { className: 'yt-card yt-queue' },
              h(
                'div',
                { className: 'yt-queue-hd' },
                h('span', { className: 'yt-queue-title' }, t('queueTitle')),
                h(
                  'span',
                  { className: 'yt-queue-count' },
                  runningCount > 0 ? runningCount + ' 个在下载' : jobs.length > 0 ? jobs.length + ' 条' : '',
                ),
                finishedCount > 0
                  ? h('button', { type: 'button', className: 'yt-mini yt-mini-ghost', onClick: clearDone }, t('clearDone'))
                  : null,
              ),
              jobs.length === 0
                ? h(
                    'div',
                    { className: 'yt-queue-empty' },
                    h('div', { className: 'yt-queue-empty-t' }, t('queueEmpty')),
                    h('div', { className: 'yt-queue-empty-b' }, t('queueEmptyHint')),
                  )
                : h(
                    'div',
                    { className: 'yt-jobs' },
                    jobs.map(function (job) {
                      return h(JobRow, {
                        key: job.id,
                        job: job,
                        remote: remote,
                        onCancel: cancelJob,
                        onRemove: removeJob,
                        onOpen: openJob,
                        onSave: saveToDevice,
                      })
                    }),
                  ),
            ),
          ),
        )
      } catch (error) {
        console.error('[dsh-yt-downloader] panel render failed', error)
        return null
      }
    }

    // ---- 样式 -------------------------------------------------------------

    var CSS = [
      '.yt-page{display:block;min-height:100%;max-height:100%;overflow-y:auto;padding:26px 30px 56px;color:var(--dsw-alias-label-primary);}',
      '.yt-page-in{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}',

      // 头部
      '.yt-hd{display:flex;align-items:center;gap:12px;}',
      '.yt-logo{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(150deg,#5b7cfa,#2b46d9);box-shadow:0 8px 20px -10px rgba(43,70,217,.9),inset 0 1px 0 rgba(255,255,255,.28);flex:none;}',
      '.yt-logo svg{display:block;}',
      '.yt-hd-text{flex:1 1 auto;min-width:0;}',
      '.yt-hd-title{font-size:17px;font-weight:600;letter-spacing:.02em;}',
      '.yt-hd-sub{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;}',

      // 通用按钮
      '.yt-ghost{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;line-height:1;padding:8px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s,background .15s;}',
      '.yt-ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);}',
      '.yt-ghost-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);}',
      '.yt-ghost:focus-visible,.yt-mini:focus-visible,.yt-tab:focus-visible,.yt-chip:focus-visible,.yt-paste:focus-visible,.yt-probe-btn:focus-visible,.yt-cta:focus-visible,.yt-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px;}',

      // 卡片
      '.yt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);padding:16px;box-sizing:border-box;}',

      // 链接卡
      '.yt-url-row{display:flex;gap:8px;align-items:center;}',
      '.yt-input-wrap{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center;}',
      '.yt-input-icon{position:absolute;left:12px;display:flex;color:var(--dsw-alias-label-secondary);pointer-events:none;opacity:.8;}',
      '.yt-input{width:100%;box-sizing:border-box;font:inherit;font-size:13.5px;line-height:1.4;padding:11px 13px 11px 34px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .15s,box-shadow .15s;}',
      '.yt-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.7;}',
      '.yt-input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 18%,transparent);}',
      '.yt-settings .yt-input{padding:10px 12px;}',
      '.yt-paste{font:inherit;font-size:12.5px;line-height:1;padding:11px 13px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;}',
      '.yt-paste:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}',
      '.yt-probe-btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:13px;font-weight:600;line-height:1;padding:11px 20px;border-radius:11px;border:0;cursor:pointer;white-space:nowrap;color:#fff;background:linear-gradient(160deg,#5b7cfa,#2b46d9);box-shadow:0 10px 22px -14px rgba(43,70,217,.95);transition:filter .15s,transform .12s,opacity .15s;}',
      '.yt-probe-btn:hover{filter:brightness(1.06);}',
      '.yt-probe-btn:active{transform:translateY(1px);}',
      '.yt-probe-btn:disabled{opacity:.65;cursor:default;filter:none;}',
      '.yt-url-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.72;margin-top:9px;padding-left:2px;letter-spacing:.01em;}',

      // 提示条
      '.yt-alert{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#c4453a) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c4453a) 10%,transparent);font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-primary);}',
      '.yt-alert-text{flex:1 1 auto;min-width:0;word-break:break-word;}',
      '.yt-alert-x{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}',
      '.yt-alert-x:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);}',

      // 视频卡
      '.yt-probe{display:flex;flex-direction:column;gap:14px;}',
      '.yt-video{display:flex;gap:14px;align-items:flex-start;}',
      '.yt-thumb{position:relative;width:150px;flex:none;aspect-ratio:16/9;border-radius:11px;overflow:hidden;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px -18px rgba(0,0,0,.9);}',
      '.yt-thumb img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.yt-thumb-blank{color:var(--dsw-alias-label-secondary);}',
      '.yt-thumb-time{position:absolute;right:5px;bottom:5px;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,.78);color:#fff;font-variant-numeric:tabular-nums;}',
      '.yt-video-info{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px;padding-top:2px;}',
      '.yt-video-title{font-size:14.5px;font-weight:600;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
      '.yt-video-meta{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;}',

      // 页签
      '.yt-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);align-self:flex-start;}',
      '.yt-tab{font:inherit;font-size:12.5px;line-height:1;padding:7px 16px;border-radius:999px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;}',
      '.yt-tab:hover{color:var(--dsw-alias-label-primary);}',
      '.yt-tab-on,.yt-tab-on:hover{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.14);}',

      // 画质
      '.yt-quality{display:flex;flex-direction:column;gap:9px;}',
      '.yt-quality-hd{font-size:12px;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);}',
      '.yt-chips{display:flex;flex-wrap:wrap;gap:8px;}',
      '.yt-chip{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:84px;padding:8px 11px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;transition:border-color .15s,background .15s,box-shadow .15s,transform .12s;}',
      '.yt-chip:hover{border-color:var(--dsw-alias-border-l2);transform:translateY(-1px);}',
      '.yt-chip-on{border-color:color-mix(in srgb,var(--yt-accent) 62%,transparent);background:color-mix(in srgb,var(--yt-accent) 10%,var(--dsw-alias-bg-base));box-shadow:0 0 0 1px color-mix(in srgb,var(--yt-accent) 42%,transparent),0 10px 22px -18px var(--yt-accent);}',
      '.yt-chip-main{font-size:13px;font-weight:600;line-height:1.1;letter-spacing:.01em;}',
      '.yt-chip-sub{font-size:10.5px;line-height:1.1;color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.yt-chip-tag{position:absolute;top:-7px;right:8px;font-size:8.5px;line-height:1;padding:2px 5px;border-radius:999px;background:linear-gradient(150deg,#5b7cfa,#2b46d9);color:#fff;letter-spacing:.05em;}',
      '.yt-audio-box{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base);padding:11px 13px;display:flex;flex-direction:column;gap:4px;}',
      '.yt-audio-main{font-size:13.5px;font-weight:600;}',
      '.yt-audio-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.yt-note{font-size:12.5px;color:var(--dsw-alias-label-secondary);}',

      // 下载动作
      '.yt-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:14px;}',
      '.yt-cta{display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:13.5px;font-weight:600;line-height:1;padding:12px 22px;border-radius:12px;border:0;cursor:pointer;color:#fff;background:linear-gradient(160deg,#5b7cfa,#2b46d9);box-shadow:0 14px 26px -18px rgba(43,70,217,.95),inset 0 1px 0 rgba(255,255,255,.2);transition:filter .15s,transform .12s,opacity .15s;}',
      '.yt-cta:hover{filter:brightness(1.07);}',
      '.yt-cta:active{transform:translateY(1px);}',
      '.yt-cta:disabled{opacity:.5;cursor:not-allowed;filter:none;}',
      '.yt-cta-tail{font-size:11px;font-weight:500;opacity:.8;border-left:1px solid rgba(255,255,255,.35);padding-left:8px;margin-left:2px;}',
      '.yt-size{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.yt-dir{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);opacity:.85;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;}',

      // 空状态
      '.yt-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:32px 24px;border:1px dashed var(--dsw-alias-border-l1);border-radius:18px;background:radial-gradient(120% 100% at 50% -30%,rgba(91,124,250,.09),transparent 62%),var(--dsw-alias-bg-layer-1);}',
      '.yt-empty-orb{width:46px;height:46px;border-radius:15px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(150deg,#5b7cfa,#2b46d9);box-shadow:0 16px 30px -18px rgba(43,70,217,.95);margin-bottom:4px;}',
      '.yt-empty-title{font-size:15px;font-weight:600;}',
      '.yt-empty-body{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary);max-width:460px;}',
      '.yt-empty-tip{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);opacity:.72;}',

      // 骨架
      '.yt-skeleton{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}',
      '.yt-sk-thumb{width:150px;height:84px;border-radius:11px;background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent),color-mix(in srgb,var(--dsw-alias-label-primary) 11%,transparent),color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent));background-size:220% 100%;animation:yt-shimmer 1.5s linear infinite;}',
      '.yt-sk-lines{flex:1 1 auto;display:flex;flex-direction:column;gap:9px;min-width:180px;}',
      '.yt-sk-line{height:11px;border-radius:6px;background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent),color-mix(in srgb,var(--dsw-alias-label-primary) 11%,transparent),color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent));background-size:220% 100%;animation:yt-shimmer 1.5s linear infinite;}',
      '.yt-sk-w70{width:70%;}',
      '.yt-sk-w40{width:40%;}',
      '.yt-sk-chips{display:flex;gap:8px;flex:1 1 100%;}',
      '.yt-sk-chips span{flex:1 1 0;height:38px;border-radius:11px;background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent),color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent),color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent));background-size:220% 100%;animation:yt-shimmer 1.5s linear infinite;}',
      '@keyframes yt-shimmer{from{background-position:120% 0;}to{background-position:-120% 0;}}',

      // 队列
      '.yt-queue{display:flex;flex-direction:column;gap:12px;}',
      '.yt-queue-hd{display:flex;align-items:center;gap:10px;}',
      '.yt-queue-title{font-size:13px;font-weight:600;letter-spacing:.04em;}',
      '.yt-queue-count{font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.yt-queue-hd .yt-mini{margin-left:auto;}',
      '.yt-queue-empty{padding:18px 4px 10px;display:flex;flex-direction:column;gap:4px;}',
      '.yt-queue-empty-t{font-size:12.5px;color:var(--dsw-alias-label-secondary);}',
      '.yt-queue-empty-b{font-size:11.5px;color:var(--dsw-alias-label-secondary);opacity:.7;}',
      '.yt-jobs{display:flex;flex-direction:column;gap:8px;}',
      '.yt-job{display:flex;gap:11px;align-items:center;padding:10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);transition:border-color .2s;}',
      '.yt-job-downloading{border-color:color-mix(in srgb,var(--yt-accent) 34%,transparent);}',
      '.yt-job-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c4453a) 34%,transparent);}',
      '.yt-thumb-tall{width:76px;border-radius:8px;flex:none;}',
      '.yt-job-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:5px;}',
      '.yt-job-title{font-size:12.5px;font-weight:600;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.yt-job-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);min-height:14px;}',
      '.yt-job-status{font-weight:500;}',
      '.yt-job-downloading .yt-job-status{color:var(--yt-accent);}',
      '.yt-job-done .yt-job-status{color:var(--dsw-alias-state-success-primary,#35a06b);}',
      '.yt-job-error .yt-job-status{color:var(--dsw-alias-state-error-primary,#c4453a);}',
      '.yt-dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.5;}',
      '.yt-job-dim{opacity:.9;}',
      '.yt-job-error{word-break:break-word;}',
      '.yt-job-body .yt-job-error{font-size:11px;color:var(--dsw-alias-state-error-primary,#c4453a);line-height:1.4;}',
      '.yt-bar{height:4px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);overflow:hidden;}',
      '.yt-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#5b7cfa,#8f6bff);transition:width .4s ease;}',
      '.yt-job-acts{display:flex;align-items:center;gap:6px;flex:none;}',
      '.yt-mini{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:11px;line-height:1;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;}',
      '.yt-mini:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}',
      '.yt-mini-ghost{border-color:transparent;}',
      '.yt-mini-ghost:hover{border-color:var(--dsw-alias-border-l1);}',

      // 设置
      '.yt-settings{display:flex;flex-direction:column;gap:14px;}',
      '.yt-settings-title{font-size:13px;font-weight:600;letter-spacing:.06em;}',
      '.yt-field{display:flex;flex-direction:column;gap:7px;}',
      '.yt-label{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.yt-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.7;}',
      '.yt-proxy-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.yt-badge{font-size:10.5px;line-height:1;padding:3px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);}',
      '.yt-badge-ok{color:var(--dsw-alias-state-success-primary,#35a06b);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#35a06b) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#35a06b) 10%,transparent);}',
      '.yt-badge-bad{color:var(--dsw-alias-state-error-primary,#c4453a);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c4453a) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c4453a) 10%,transparent);}',
      '.yt-badge-off{color:var(--dsw-alias-label-secondary);}',
      '.yt-proxy-auto{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8;}',
      '.yt-diag{display:flex;flex-direction:column;gap:6px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:12px;}',
      '.yt-diag-row{display:flex;gap:10px;align-items:baseline;font-size:11.5px;}',
      '.yt-diag-k{min-width:62px;color:var(--dsw-alias-label-secondary);}',
      '.yt-diag-v{word-break:break-word;}',
      '.yt-ok{color:var(--dsw-alias-state-success-primary,#35a06b);}',
      '.yt-bad{color:var(--dsw-alias-state-error-primary,#c4453a);}',
      '.yt-settings-ft{display:flex;align-items:center;gap:10px;}',
      '.yt-cookie-chips .yt-chip{min-width:auto;padding:7px 13px;}',
      '.yt-save{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:600;line-height:1;padding:10px 18px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary);cursor:pointer;}',
      '.yt-save:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);}',
      '.yt-save-msg{font-size:11.5px;}',

      // 杂项
      '.yt-spin{display:inline-block;width:13px;height:13px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:yt-spin .7s linear infinite;}',
      '@keyframes yt-spin{to{transform:rotate(360deg);}}',
      '.yt-page{--yt-accent:#4f6ef7;}',
      '@media (max-width:620px){.yt-page{padding:18px 14px 40px;}.yt-url-row{flex-wrap:wrap;}.yt-input-wrap{flex-basis:100%;}.yt-video{flex-direction:column;}.yt-thumb{width:100%;}.yt-job-acts{flex-wrap:wrap;}}',
      '@media (prefers-reduced-motion:reduce){.yt-sk-thumb,.yt-sk-line,.yt-sk-chips span,.yt-spin,.yt-bar-fill{animation:none;transition:none;}}',
    ].join('')

    // ---- 注册 -------------------------------------------------------------

    function start(ctx) {
      localeService = ctx.locale || null
      try {
        boundTranslate = ctx.locale.bind(NS)
      } catch (error) {
        boundTranslate = null
      }
      try {
        layoutService = ctx.layout || ctx.get('layout') || null
      } catch (error) {
        try {
          layoutService = ctx.get('layout') || null
        } catch (inner) {
          layoutService = null
        }
      }

      ctx.effect(function () {
        try {
          ctx.locale.register(NS, 'zh', ZH)
          ctx.locale.register(NS, 'zh-CN', ZH)
          ctx.locale.register(NS, 'en', EN)
        } catch (error) {
          console.error('[dsh-yt-downloader] locale register failed', error)
        }
        return function () {}
      }, 'dsh-yt-downloader: dictionaries')

      ctx.effect(function () {
        var el = document.createElement('style')
        el.setAttribute('data-dsh-yt-downloader', '')
        el.textContent = CSS
        document.head.appendChild(el)
        return function () {
          if (el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-yt-downloader: styles')

      // 侧边栏常驻入口：id 同时也是 main 面板的 key。
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'ytdl',
            order: 30,
            label: function () {
              return t('title')
            },
          },
          SidebarIcon,
        )
      })

      // 主面板。
      ctx.slots.inject('main', function () {
        return ctx.slots.register(
          {
            name: 'main',
            key: 'ytdl',
          },
          DownloaderPanel,
        )
      })
    }

    function apply(ctx) {
      if (!React || !h) {
        console.error('[dsh-yt-downloader] react is unavailable; plugin stays inert')
        return
      }
      try {
        start(ctx)
      } catch (error) {
        console.error('[dsh-yt-downloader] apply failed', error)
      }
    }

    module.exports = {
      name: NS,
      inject: ['slots', 'locale'],
      apply: apply,
    }
    return module.exports
  },
})
