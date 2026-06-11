# 本地字体库接入

YFonts 不绑定固定电脑路径。每个使用者都需要把自己的字体库目录传给索引脚本，索引会写入 `public/font-index.json`，开发服务器再从这个索引里的 `root` 判断哪些本地字体允许预览和打开位置。

## 生成本地索引

```powershell
npm run index:fonts -- "D:\Fonts"
```

也可以使用环境变量：

```powershell
$env:YFONTS_FONT_LIBRARY="D:\Fonts"
npm run index:fonts
```

macOS 示例：

```bash
YFONTS_FONT_LIBRARY="$HOME/Fonts" npm run index:fonts
```

## 开发预览

```powershell
npm run dev
```

开发服务器会读取 `public/font-index.json` 的 `root`，只允许这个目录下的 `.ttf`、`.otf`、`.ttc`、`.woff`、`.woff2` 参与本地预览和“打开位置”。

如果需要允许多个字体库根目录，可以设置：

```powershell
$env:YFONTS_FONT_ROOTS="D:\Fonts;E:\BrandFonts"
npm run dev
```

macOS/Linux 使用冒号分隔：

```bash
YFONTS_FONT_ROOTS="$HOME/Fonts:/Volumes/Assets/Fonts" npm run dev
```

## 迁移原则

- 不把个人路径提交进脚本或配置。
- `public/font-index.json` 是本机生成文件，不进 Git。
- 浏览器导入模式可以临时预览用户选择的文件夹；完整的扫描、打开位置和安装能力由开发服务器或 Tauri 桌面层提供。
