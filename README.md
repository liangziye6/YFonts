# YFonts

YFonts is a local-first desktop font manager for organizing, previewing, and
using large personal font collections.

![YFonts icon](src/assets/yfonts-icon.png)

## Features

- Scan folders containing TTF, OTF, TTC, WOFF, and WOFF2 files.
- Render real local font previews with Chinese and English sample text.
- Browse font families, weights, variable axes, categories, and license status.
- Search, filter, favorite, hide, remove, and restore fonts.
- Build project font packs with drag-and-drop organization.
- Open the source location of a font from the desktop application.
- Check GitHub Releases for application updates from Library Settings.
- Use light and dark themes with an integrated desktop title bar.
- Keep library indexes, project packs, and personal paths on the local device.

## Download

Windows and macOS builds are published on the
[Releases page](https://github.com/liangziye6/YFonts/releases).

The installer contains the application only. It does not include the
developer's fonts, local paths, favorites, or project packs.

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

## Development

Requirements:

- Node.js
- Rust
- Tauri system dependencies

```powershell
npm install
npm run dev
```

Run the desktop application:

```bash
npm run desktop:dev
```

Build the installer for the current platform:

```bash
npm run desktop:build
```

Build platform-specific packages:

```bash
# Run on macOS. Produces .app and .dmg bundles.
npm run desktop:build:mac

# Run on macOS for local testing with ad-hoc signing and DMG verification.
npm run desktop:build:mac:local

# Run on macOS for an Apple Silicon + Intel local test DMG.
npm run desktop:build:mac:universal:local

# Run on Windows. Produces an NSIS .exe installer.
npm run desktop:build:windows
```

Windows and macOS packages are built from the same repository. The native
bundle must be compiled on its target operating system.

Public macOS distribution requires a paid Apple Developer account, a
`Developer ID Application` certificate, and Apple notarization. The local
ad-hoc build is suitable for development and testing, but other users may need
to allow it manually in Privacy & Security.

The release workflow expects these GitHub Actions secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `KEYCHAIN_PASSWORD`: temporary CI keychain password
- `APPLE_SIGNING_IDENTITY`: full Developer ID Application identity
- `APPLE_ID`: Apple Developer account email
- `APPLE_PASSWORD`: app-specific password
- `APPLE_TEAM_ID`: Apple Developer Team ID

## Architecture

- `src/`: React and TypeScript application interface.
- `src-tauri/`: Tauri and Rust desktop commands.
- `docs/`: local library and cross-platform architecture notes.
- `scripts/`: font indexing and release verification helpers.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/LOCAL_LIBRARY.md](docs/LOCAL_LIBRARY.md) for more detail.

## Privacy

YFonts is designed around local font libraries. Production builds do not
bundle `public/font-index.json` or any user-specific font paths. Per-user
library state is stored in the operating system's application data directory.

## Developer

Developed by **LYZ**.
