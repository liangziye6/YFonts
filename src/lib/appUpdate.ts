import packageMetadata from "../../package.json";
import { invokeTauri, isTauriRuntime } from "./tauri";

const latestReleaseUrl = "https://api.github.com/repos/liangziye6/YFonts/releases/latest";
const updateCacheKey = "yfonts:update-check";
const updateCacheLifetime = 6 * 60 * 60 * 1000;

export const appVersion = packageMetadata.version;

export type AppRelease = {
  version: string;
  name: string;
  releaseUrl: string;
  downloadUrl?: string;
  publishedAt?: string;
  notes?: string;
};

type GitHubReleaseResponse = {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: unknown;
};

type GitHubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type CachedUpdateCheck = {
  checkedAt: number;
  release: AppRelease;
};

export async function checkForAppUpdate(force = false) {
  if (!force) {
    const cached = loadCachedUpdateCheck();
    if (cached && Date.now() - cached.checkedAt < updateCacheLifetime) {
      return cached.release;
    }
  }

  const response = await fetch(latestReleaseUrl, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}`);
  }

  const release = parseGitHubRelease((await response.json()) as GitHubReleaseResponse);
  saveCachedUpdateCheck({
    checkedAt: Date.now(),
    release
  });
  return release;
}

export function isNewerAppVersion(candidate: string, current = appVersion) {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);

  for (let index = 0; index < Math.max(candidateParts.length, currentParts.length); index += 1) {
    const candidatePart = candidateParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (candidatePart !== currentPart) return candidatePart > currentPart;
  }

  return false;
}

export async function openExternalUrl(url: string) {
  if (isTauriRuntime()) {
    await invokeTauri("open_external_url", { url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function parseGitHubRelease(value: GitHubReleaseResponse): AppRelease {
  const version = typeof value.tag_name === "string" ? value.tag_name.replace(/^v/i, "") : "";
  const releaseUrl = typeof value.html_url === "string" ? value.html_url : "";
  if (!version || !releaseUrl) {
    throw new Error("Invalid GitHub release response");
  }

  const assets = Array.isArray(value.assets) ? (value.assets as GitHubReleaseAsset[]) : [];
  const installer = assets.find(
    (asset) =>
      typeof asset.name === "string" &&
      /YFonts_.*_x64-setup\.exe$/i.test(asset.name) &&
      typeof asset.browser_download_url === "string"
  );

  return {
    version,
    name: typeof value.name === "string" && value.name.trim() ? value.name : `YFonts ${version}`,
    releaseUrl,
    downloadUrl:
      installer && typeof installer.browser_download_url === "string"
        ? installer.browser_download_url
        : undefined,
    publishedAt: typeof value.published_at === "string" ? value.published_at : undefined,
    notes: typeof value.body === "string" ? value.body : undefined
  };
}

function parseVersion(value: string) {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function loadCachedUpdateCheck(): CachedUpdateCheck | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(updateCacheKey) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

    const cached = value as Partial<CachedUpdateCheck>;
    if (typeof cached.checkedAt !== "number" || !cached.release) return undefined;
    return {
      checkedAt: cached.checkedAt,
      release: cached.release
    };
  } catch {
    return undefined;
  }
}

function saveCachedUpdateCheck(value: CachedUpdateCheck) {
  try {
    window.localStorage.setItem(updateCacheKey, JSON.stringify(value));
  } catch {
    // Update checks remain available even when browser storage is unavailable.
  }
}
