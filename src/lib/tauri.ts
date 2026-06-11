export function isTauriRuntime() {
  const hostname = window.location.hostname.toLowerCase();

  return Boolean(
    window.__TAURI_INTERNALS__ ||
      window.__TAURI__ ||
      hostname === "tauri.localhost" ||
      window.location.protocol === "tauri:" ||
      window.location.protocol === "asset:"
  );
}

export async function invokeTauri<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<T>(command, args);
  } catch (error) {
    if (window.__TAURI_INTERNALS__?.invoke) {
      return (await window.__TAURI_INTERNALS__.invoke(command, args)) as T;
    }

    throw error;
  }
}

export async function convertLocalFileSrc(path: string) {
  if (window.__TAURI_INTERNALS__?.convertFileSrc) {
    return window.__TAURI_INTERNALS__.convertFileSrc(path);
  }

  const core = await import("@tauri-apps/api/core");
  return core.convertFileSrc(path);
}
