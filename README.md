# dsh-yt-downloader · 视频下载器

侧边栏常驻的下载面板：**粘一条链接 → 选画质（144p–4K）→ 下载视频，或只抽音频。**

不只 YouTube —— 背后是 [yt-dlp](https://github.com/yt-dlp/yt-dlp)，它认识 **1000+ 站点**和直链：

```
YouTube · B站 · X/Twitter · Instagram · TikTok · 微博 · 抖音
Vimeo · Twitch · 声田/网易云的单曲页 · 直播回放 · 直链 .mp4/.mp3/.m3u8 …
```

## 怎么用

1. 左边栏点 **视频下载器**（在「命运牌桌」下面）。
2. 把链接粘进输入框，按 **解析**（或回车）。
3. 显示封面、标题、来源站点、时长后，挑一个画质点 **下载**。
4. 队列里实时显示进度、速度、剩余时间；下完能直接「打开文件」或「打开文件夹」。

- **视频**：按分辨率给档，优先 **H.264**（兼容性最好）；站点只提供「画面+声音一体」的格式时就直接下那一条；连分辨率都没有的直链，给一个「最佳」。
- **仅音频**：取最好的音轨转 MP3。
- 播放列表/频道链接只取第一条，不会一口气拉整个列表。

## 代理

YouTube、X 这些站点国内直连不通。插件默认**跟随 Windows 系统代理**（读注册表 `Internet Settings`），
面板「设置」里也能手写一个（比如 `127.0.0.1:7897`，留空 = 自动）。

设置页会显示代理是否真的在线——**代理软件没开**的时候，解析会直接提示「代理没在监听」，
而不是闷头等超时。

## 链接被站点拦住怎么办

有些站会要求登录（YouTube 的「确认不是机器人」、B站 的会员/地区限制、微博的登录墙）。两条路：

1. **换节点**：代理软件里换个线路，再解析。
2. **借浏览器的登录态**：`设置 → 浏览器 Cookie` 选一个登录过该站的浏览器（Chrome / Edge / Firefox）。
   - 选之前**先把那个浏览器完全退出**（cookie 数据库被占用时 yt-dlp 读不到）。
   - 新版 Chrome/Edge 用 App-Bound 加密，个别版本仍可能解不开；Firefox 最稳。
   - 选完保存，回头再解析就行。

如果站点根本不支持，会明确说 `yt-dlp 不认识这个链接`，而不是转圈。

## 存哪

默认 `C:\Users\<你>\Downloads`，「设置」里可以改。文件名格式：

```
<标题> [<id>].<ext>
```

## 安装 / 卸载

```powershell
# 1. 克隆（vendor/ 里的 yt-dlp 不进仓库，克隆后要单独装一次）
git clone https://github.com/chen-bi/dsh-yt-downloader.git
cd dsh-yt-downloader

# 2. 装 yt-dlp 到 vendor/
node scripts/setup-ytdlp.mjs
```

```powershell
# 3. 装插件（在 DSH 里让助手装）：plugin_manager → install_bundle，target 指向本目录
# 4. 卸
plugin_manager → remove_bundle → dsh-yt-downloader
```

装完刷一次页面（新客户端包要重新加载）。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host：`/api/ytdl/*`、`youtube_download` 工具、yt-dlp 调用、画质整理、进度解析、代理探测 |
| `client.js` | 浏览器半侧：侧边栏图标 + 下载面板（解析/画质/进度/设置） |
| `vendor/` | 自带的 yt-dlp（`python -m yt_dlp`，不污染全局环境） |
| `smoke.mjs` | 自检：`node smoke.mjs [--probe]` |
| `client-smoke.mjs` | 客户端工厂自检：`node client-smoke.mjs` |
| `download-test.mjs` | 真下载实测（临时目录，跑完自动清理） |

## 依赖

- **Python 3**：用 uv 装的那个（`%APPDATA%\uv\python\…`），找不到时退到 PATH 里的 `python`。
- **yt-dlp**：在 `vendor/` 里，随插件走（2026.10.26）。
- **ffmpeg**：合并画面+音轨、转 MP3 用。自动找 `~\.pyffmpeg\bin\ffmpeg.exe`。

## 接口（给脚本/调试用）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/ytdl/state` | 引擎状态、代理、下载目录、队列 |
| POST | `/api/ytdl/probe` | `{url}` → 标题/封面/站点 + 画质列表 |
| POST | `/api/ytdl/download` | `{url, mode, formatId, merge, …}` → 建任务 |
| GET | `/api/ytdl/jobs` | 队列与进度 |
| POST | `/api/ytdl/cancel` | `{id}` 取消 |
| POST | `/api/ytdl/remove` | `{id}` 从队列移除 |
| POST | `/api/ytdl/open` | `{path, reveal}` 打开文件 / 定位文件夹 |
| POST | `/api/ytdl/settings` | `{proxy, downloadDir, cookiesFrom}` 保存设置 |

## 说明

- 只接受 `http(s)` 链接；`file://`、本地路径、其他协议一律拒绝。
- 下载任务在内存里，DSH 重启后队列清空（已下完的文件当然还在）。
- 能不能下取决于站点和 yt-dlp 的支持程度：受限内容（付费/会员/DRM）下不了。
- 自己看/存着没问题；二次分发别人的内容请遵守平台条款和版权。
