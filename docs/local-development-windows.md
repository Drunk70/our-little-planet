# Windows 本地开发

当前项目使用的 `better-sqlite3 13` 要求 Node.js 22 或更新版本。本机已用 Node.js 22.22.2 验证。

## 打开预览

在项目目录的 PowerShell 终端运行：

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3000
```

如果预览服务已经运行，直接打开以下地址即可：

- 网站：<http://127.0.0.1:3000>
- 读者解锁：<http://127.0.0.1:3000/lock>
- 写作后台：<http://127.0.0.1:3000/write>

本地示例配置的读者密码为 `0520`，作者口令为 `write-for-her`。实际值由 `.env.local` 决定。正式部署时应设置自己的密码和签名密钥。

终端前台运行的服务可以用 `Ctrl+C` 停止；修改页面代码后通常会自动更新。

## 首次安装的兼容处理

当前锁定的 `better-sqlite3 13.0.3` 包含 Windows 原生二进制，但本机的普通 `npm ci` 仍触发了 `node-gyp rebuild`，因缺少 Windows SDK 而失败。本次采用：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
```

这一命令跳过依赖安装脚本，使用包内已有的二进制。本次已验证 SQLite 查询、sharp 图片处理及原生模块解析正常。以后升级依赖时，应重新确认是否需要安装脚本。

`.env.local` 已设置随机 `AUTH_SECRET`。本机还有以下配置：

```dotenv
NEXT_TELEMETRY_DISABLED=1
FFMPEG_PATH=F:/相册/.tools/ffmpeg/ffmpeg.exe
```

关闭遥测用于避开本机 Next.js 遥测配置写入时的 `EXDEV` 错误。FFmpeg 是本机工具路径，换电脑或部署到 Linux 时需要调整。

## 数据与检查

- 示例内容已经初始化，数据库和照片位于 `data/`。
- **已有自己的内容后，不要再运行 `npm run seed`：它会清空已有数据和媒体。**
- `.env.local`、`data/`、`node_modules/` 和 `.next/` 都由 Git 忽略。
- `npx --no-install tsc --noEmit` 可检查 TypeScript。
- `npm run gen-posters` 为已有视频补封面；`node scripts/gen-thumbs.mjs` 为照片补缩略图，两者会跳过已有结果。

本次配置的 Git 远程：`origin` 指向 `Drunk70/our-little-planet`，`upstream` 指向原作者仓库。
