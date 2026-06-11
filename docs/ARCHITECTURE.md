# YFonts 跨平台方案

YFonts 采用“本地优先、跨平台适配”的桌面架构。前端负责字体浏览、筛选、预览、项目字体包和在线发现体验；Tauri/Rust 层负责读取本地目录、解析字体文件、缓存索引、下载文件和处理系统级能力。

## 平台媒介

首发媒介建议是桌面端：

- Windows：当前开发平台，优先跑通本地字体包扫描和管理。
- macOS：第二平台，保持同一套前端和核心逻辑，只替换系统路径、安装目录和权限处理。
- Web：只作为界面预览和后续在线字体目录展示，不承担完整本地管理能力。

## 分层边界

- `src/`：React 工作台，包含字体库、筛选、预览、详情、项目字体包等界面。
- `src/lib/platform.ts`：平台差异说明和默认字体目录，避免在组件里硬编码 Windows 路径。
- `src-tauri/src/`：桌面命令层。当前先放了 `scan_font_folder`，后续继续扩展元数据解析、下载和安装。
- `docs/`：产品和架构决策，迁移到 macOS 时以这里为检查清单。

## 本地字体核心流程

1. 用户选择一个或多个字体目录。
2. Tauri 命令递归扫描 `.ttf`、`.otf`、`.ttc`、`.woff`、`.woff2`。
3. 后续用 Rust 字体解析库提取 family、subfamily、weight、copyright、license、字符覆盖范围。
4. 索引写入 SQLite，前端只消费结构化数据。
5. 字体预览使用临时 `@font-face` 或本地缓存路径，不依赖系统是否已经安装。

## macOS 过渡要点

- 默认目录改为 `/Library/Fonts`、`~/Library/Fonts`、`/System/Library/Fonts`。
- 安装字体优先写入 `~/Library/Fonts`，不要默认请求系统目录权限。
- 所有路径统一通过 Rust `PathBuf` 处理，前端只展示字符串。
- 文件监听后续使用跨平台方案，避免 Windows/macOS 分别写两套监听逻辑。
- 应用数据目录使用 Tauri app data API，避免写死 `%APPDATA%` 或 `~/Library/Application Support`。
- 构建链在 macOS 需要 Rust、Xcode Command Line Tools、Tauri CLI 和 Node。

## 在线免费商用字体

在线字体发现不做“不可验证的全网抓取”，而是接入可验证来源：

- Google Fonts：获取字体家族、分类、样式、子集、趋势和文件地址。
- Fontsource：补充开源字体包和自托管信息。
- 手动来源：允许用户保存来源链接、授权截图或授权文件。

授权状态分为 `OFL`、`Apache`、`CC0`、`免费商用`、`仅个人`、`待确认`。只有来源和授权证据都可追踪时，才进入“免费商用”列表。

## 下一步实现顺序

1. 接入 Tauri 文件夹选择。
2. 将 `scan_font_folder` 返回结果接到前端字体列表。
3. 引入字体元数据解析和 SQLite。
4. 支持真实本地字体预览。
5. 接入 Google Fonts 与 Fontsource Provider。
