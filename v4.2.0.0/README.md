# 安全传输（SecureTransfer）

局域网点对点加密通信 / 文件传输桌面软件（Windows，Electron）。

- 版本：**4.2.0.0**（四位版本号，前缀一律小写 `v`）
- appId：`com.securetransfer.app` · productName：`安全传输`
- 技术栈：Electron 41 + React 18 + TypeScript + Vite，electron-builder 打包（NSIS 安装器 + portable 便携版）

## 核心功能

- **X25519 握手**：首次下发豪密底本（Base32 随机置换表），每会话不同的乱码表。
- **全通道 AES-256-GCM 加密**：帧计数防重放，TOFU 指纹校验；文字消息先走豪密再进 GCM 通道（与文件同通道）。
- **文件传输**：64KB 分块、SHA-256 双端校验、无损落地到 `下载\安全传输`。
- **连接保活**：10s keepalive / 15s PING / 45s 判死，指数退避 3–30s 自动重连。
- **离线暂存**：文字离线存 outbox.json，上线自动重投，按消息 ID 去重。
- **局域网设备发现**：UDP 组播 + 子网定向广播（discovery-service）。
- 在线/离线状态、已读/发送成功标签、失败大红框提示；拖入 / 文件选择器 / 路径输入三种选文件方式。

## 运行模式

| 能力 | 安装版 | 便携版 |
|---|---|---|
| 托盘（关闭最小化到托盘） | 可选，默认关闭 | 无 |
| 开机自启动 | 可选，默认关闭 | 无 |
| 注册表写入 | 仅自启动 Run 键（开启时） | 绝不写 |
| 关闭主窗口 | 按设置退出或驻留托盘 | 完全退出，无后台进程 |
| 数据位置 | `%APPDATA%\安全传输`、`下载\安全传输` | 便携版 exe 所在目录 `Data\`、`下载\` |

便携版由 electron-builder `portable` 目标生成（启动器注入 `PORTABLE_EXECUTABLE_DIR` 环境变量，主进程据此识别），删除便携版所在文件夹即等于卸载，零残留。

## 构建

前置：Node.js ≥ 18（建议 20+）、npm ≥ 9，Windows 10/11 x64。

```powershell
npm install            # 首次
npm run dist:win       # 构建主进程/预加载/渲染层 + electron-builder（NSIS + portable）
```

产物在 `release\`：

- `安全传输-安装程序-v4.2.0.0.exe` — NSIS 安装器（perMachine，默认装到 `C:\Program Files\安全传输`，桌面与开始菜单快捷方式；支持 `/S` 静默安装；含降级拦截、覆盖安装、彻底卸载）
- `安全传输-便携版-v4.2.0.0.exe` — 单文件便携版，解压（复制）即用，关窗即退

其他常用命令：

```powershell
npm run dev            # 开发模式（Vite HMR + Electron）
npm run build          # 仅编译三个进程
npm run pack           # 只打包目录不生成安装器
```

构建缓存建议放到 D 盘避免占用 C 盘：

```powershell
$env:ELECTRON_BUILDER_CACHE = 'D:\.securetransfer-build\ecache'
```

## 关键文件

```
src/main/               主进程
  index.ts              窗口/托盘/便携版识别/自启/版本号
  ipc-handlers.ts       IPC 桥
  discovery/            局域网设备发现
  secure/               channel（加密通道）、haomi（豪密）、session（会话）、store（数据目录）
src/preload/index.ts    预加载（contextBridge 暴露 window.api）
src/renderer/           React 界面（App.tsx、components/ChatView、IncomingAlert、SettingsView）
build/installer.nsh     NSIS 自定义：孤儿卸载键自愈、四位版本号降级拦截、彻底卸载
build/afterPack.js      打包后处理
resources/              图标
```

## 安装器行为说明

- 启动时读取卸载注册表键做降级拦截（比较逻辑按数字段逐段比较，段数不等按 0 处理，兼容三位/四位版本号）。
- 若卸载键指向的程序已不存在（孤儿键，如历史 `7dd215b8-…` 残留），安装器自动删除该键并视为全新安装，不会误判降级。
- 卸载时清除：安装目录、桌面/开始菜单快捷方式、卸载注册表键、`%APPDATA%\安全传输`、`%LOCALAPPDATA%\安全传输`、`下载\安全传输`。
- 静默参数：`安全传输-安装程序-v4.2.0.0.exe /S` 安装；`"C:\Program Files\安全传输\Uninstall 安全传输.exe" /S` 卸载。

## License

MIT
