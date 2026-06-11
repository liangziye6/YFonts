type TauriInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

type TauriInternals = {
  invoke?: TauriInvoke;
  convertFileSrc?: (path: string, protocol?: string) => string;
};

interface Window {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: TauriInternals;
  __YFONTS_DRAG_FONT_IDS__?: string[];
  __YFONTS_DID_CUSTOM_DRAG__?: boolean;
  __YFONTS_LAST_DRAG_DIAGNOSTIC__?: {
    stage: string;
    fontIds: string[];
    packId?: string;
    x?: number;
    y?: number;
    reason?: string;
  };
}
