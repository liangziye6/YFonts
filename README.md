<p align="center">
  <img src="src/assets/yfonts-icon.png" width="128" height="128" alt="YFonts 图标">
</p>

<h1 align="center">YFonts</h1>

<p align="center">
  面向 Windows 与 macOS 的本地字体资产管理工具
</p>

<p align="center">
  <a href="https://github.com/liangziye6/YFonts/releases/tag/v1.21.0">
    <img src="https://img.shields.io/badge/版本-v1.21.0-2f6fed" alt="当前版本 v1.21.0">
  </a>
  <img src="https://img.shields.io/badge/macOS-Universal-111111?logo=apple" alt="支持 macOS">
  <img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11" alt="支持 Windows">
  <img src="https://img.shields.io/badge/数据-本地优先-16a36a" alt="本地优先">
</p>

YFonts 用于整理、预览和管理个人字体库。它可以读取本地真实字体文件，
统一管理字体家族、字重、语言、风格、来源与授权状态，并通过项目字体包组织设计项目所需的字体。

## 下载

当前版本为 **v1.21.0**，Windows 与 macOS 使用独立安装包：

| 系统 | 安装包 | 适用设备 |
| --- | --- | --- |
| macOS | [下载 Universal DMG](https://github.com/liangziye6/YFonts/releases/download/v1.21.0/YFonts_1.21.0_universal.dmg) | Apple Silicon 与 Intel Mac |
| Windows | [下载 x64 安装程序](https://github.com/liangziye6/YFonts/releases/download/v1.21.0/YFonts_1.21.0_x64-setup.exe) | Windows 10 / 11 64 位 |

[查看全部版本与更新说明](https://github.com/liangziye6/YFonts/releases)

> 安装包只包含应用程序，不包含开发者的字体、字体路径、收藏、项目包或其他个人数据。

### macOS 首次打开

当前 DMG 尚未经过 Apple Developer ID 公证。如果系统阻止首次打开，请前往
“系统设置 → 隐私与安全性”，找到 YFonts 后选择“仍要打开”。

## 主要功能

- **本地字体库**：扫描文件夹或导入单个字体文件，支持 TTF、OTF、TTC、WOFF 和 WOFF2。
- **真实字体预览**：直接使用本地字体渲染中英文预览，可切换静态字重和可变字体轴。
- **快速筛选**：按语言、授权、来源、字体风格快速筛选，无需进入多层下拉菜单。
- **字体整理**：支持搜索、收藏、隐藏、移出、恢复、重复字体整理和批量管理。
- **项目字体包**：通过拖放创建项目字体包与子分类，集中整理不同项目使用的字体。
- **授权管理**：记录免费商用、OFL、Apache、CC0、仅个人使用及待确认等授权状态。
- **在线发现**：浏览 Google Fonts 与 Fontsource 字体目录，本地字体库不依赖网络。
- **深浅外观**：支持明暗主题，并与桌面系统外观同步。
- **本地优先**：字体索引、项目包和个人路径保存在当前用户设备中。

## v1.21.0 更新重点

- 增加 macOS 原生标题栏、交通灯布局、中文应用菜单和系统快捷键。
- 优化 macOS 半透明菜单、深浅模式、侧边栏与窗口视觉。
- 将语言、授权和来源改为可直接点击的快捷筛选。
- 修复字重面板需要点击两次、拖拽时意外选中文字等交互问题。
- Windows 与 macOS 共用核心功能，同时保留各自的原生系统交互。
- 提供 Windows x64 与 macOS Universal 双平台安装包。

完整记录请查看 [CHANGELOG.md](CHANGELOG.md)。

## 平台体验

YFonts 使用同一套字体管理能力支持两个桌面系统，同时根据平台习惯调整交互：

- macOS 使用原生交通灯、系统菜单、`Command+,` 设置快捷键及系统视觉材质。
- Windows 使用原生窗口控制区、`Ctrl+,` 设置快捷键及 NSIS 安装程序。

Windows 与 macOS 不需要拆分为两个项目，平台配置和安装包由同一仓库分别构建。

## 隐私

YFonts 围绕本地字体库设计。正式安装包不会打包 `public/font-index.json`，
也不会包含任何用户专属路径或字体数据。每位用户的字体索引与设置均保存在操作系统的应用数据目录。

## 开发

<details>
<summary>查看本地开发与打包命令</summary>

### 环境要求

- Node.js
- Rust
- Tauri 对应平台依赖

```bash
npm install
npm run desktop:dev
```

构建当前平台：

```bash
npm run desktop:build
```

平台安装包：

```bash
# macOS：生成 .app 与 .dmg
npm run desktop:build:mac

# macOS：本地临时签名与 DMG 校验
npm run desktop:build:mac:local

# macOS：Apple Silicon + Intel Universal DMG
npm run desktop:build:mac:universal:local

# Windows：生成 NSIS .exe 安装程序
npm run desktop:build:windows
```

公开分发且不触发 macOS 安全提示，需要 Apple Developer 账号、
`Developer ID Application` 证书和 Apple 公证。

</details>

## 技术结构

- `src/`：React 与 TypeScript 应用界面。
- `src-tauri/`：Tauri 配置与 Rust 桌面命令。
- `docs/`：本地字体库及跨平台架构说明。
- `scripts/`：字体索引与发布构建脚本。

更多信息请查看 [架构说明](docs/ARCHITECTURE.md) 和
[本地字体库说明](docs/LOCAL_LIBRARY.md)。

## 作者

由 **LYZ** 开发与维护。
