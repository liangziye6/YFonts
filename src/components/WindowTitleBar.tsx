import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import appIcon from "../assets/yfonts-icon.png";
import { t } from "../lib/i18n";
import { isTauriRuntime } from "../lib/tauri";

type WindowTitleBarProps = {
  themeMode: "light" | "dark";
};

export function WindowTitleBar({ themeMode }: WindowTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const isDesktop = isTauriRuntime();

  useEffect(() => {
    if (!isDesktop) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      const updateMaximizedState = async () => {
        const maximized = await appWindow.isMaximized();
        if (!disposed) setIsMaximized(maximized);
      };

      await appWindow.setTheme(themeMode);
      await updateMaximizedState();
      unlisten = await appWindow.onResized(() => {
        void updateMaximizedState();
      });
    })().catch(() => {
      // Browser preview keeps the title bar visual without desktop window controls.
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDesktop, themeMode]);

  async function minimizeWindow() {
    if (!isDesktop) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }

  async function toggleMaximizeWindow() {
    if (!isDesktop) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  }

  async function closeWindow() {
    if (!isDesktop) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  return (
    <header className="window-titlebar">
      <div
        className="window-titlebar-drag-region"
        data-tauri-drag-region
        onDoubleClick={() => void toggleMaximizeWindow()}
      >
        <span className="window-titlebar-mark" data-tauri-drag-region>
          <img src={appIcon} alt="" data-tauri-drag-region />
        </span>
        <strong data-tauri-drag-region>YFonts</strong>
        <span className="window-titlebar-developer" data-tauri-drag-region>
          by LYZ
        </span>
      </div>

      <div className="window-titlebar-controls">
        <button
          type="button"
          onClick={() => void minimizeWindow()}
          title={t.minimizeWindow}
          aria-label={t.minimizeWindow}
        >
          <Minus size={15} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          onClick={() => void toggleMaximizeWindow()}
          title={isMaximized ? t.restoreWindow : t.maximizeWindow}
          aria-label={isMaximized ? t.restoreWindow : t.maximizeWindow}
        >
          {isMaximized ? (
            <Copy size={13} strokeWidth={1.6} />
          ) : (
            <Square size={12} strokeWidth={1.6} />
          )}
        </button>
        <button
          className="window-close-button"
          type="button"
          onClick={() => void closeWindow()}
          title={t.closeWindow}
          aria-label={t.closeWindow}
        >
          <X size={16} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}
