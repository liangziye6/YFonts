import { t } from "./i18n";

export type DesktopPlatform = "windows" | "macos" | "linux" | "web";

export type PlatformProfile = {
  label: string;
  defaultFontDirs: string[];
  installTarget: string;
  notes: string[];
};

export function detectPlatform(): DesktopPlatform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || navigator.platform || "").toLowerCase();

  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return "web";
}

export const platformProfiles: Record<DesktopPlatform, PlatformProfile> = {
  windows: {
    label: "Windows",
    defaultFontDirs: ["C:\\Windows\\Fonts", "%LOCALAPPDATA%\\Microsoft\\Windows\\Fonts"],
    installTarget: "\u7cfb\u7edf\u5b57\u4f53\u76ee\u5f55\u6216\u5f53\u524d\u7528\u6237\u5b57\u4f53\u76ee\u5f55",
    notes: [
      "\u8def\u5f84\u4e0d\u533a\u5206\u5927\u5c0f\u5199",
      "\u5b57\u4f53\u5b89\u88c5\u9700\u8981\u533a\u5206\u7cfb\u7edf\u7ea7\u548c\u7528\u6237\u7ea7\u6743\u9650"
    ]
  },
  macos: {
    label: "macOS",
    defaultFontDirs: ["/Library/Fonts", "~/Library/Fonts", "/System/Library/Fonts"],
    installTarget: "~/Library/Fonts",
    notes: [
      "\u8def\u5f84\u533a\u5206\u5927\u5c0f\u5199\u53d6\u51b3\u4e8e\u78c1\u76d8\u683c\u5f0f",
      "\u4f18\u5148\u5199\u5165\u7528\u6237\u5b57\u4f53\u76ee\u5f55\uff0c\u907f\u514d\u7cfb\u7edf\u76ee\u5f55\u6743\u9650\u95ee\u9898"
    ]
  },
  linux: {
    label: "Linux",
    defaultFontDirs: ["~/.local/share/fonts", "/usr/share/fonts"],
    installTarget: "~/.local/share/fonts",
    notes: [
      "\u5b89\u88c5\u540e\u901a\u5e38\u9700\u8981\u5237\u65b0 fontconfig \u7f13\u5b58",
      "\u53d1\u884c\u7248\u8def\u5f84\u53ef\u80fd\u4e0d\u540c"
    ]
  },
  web: {
    label: "Web Preview",
    defaultFontDirs: ["\u7531\u7528\u6237\u9009\u62e9\u6587\u4ef6\u5939"],
    installTarget: "\u4e0d\u53ef\u76f4\u63a5\u5b89\u88c5",
    notes: [
      "\u6d4f\u89c8\u5668\u6a21\u5f0f\u53ea\u505a\u754c\u9762\u9884\u89c8",
      "\u5b8c\u6574\u626b\u63cf\u548c\u5b89\u88c5\u80fd\u529b\u7531 Tauri \u547d\u4ee4\u63d0\u4f9b"
    ]
  }
};

export function getSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    local: t.local,
    "google-fonts": "Google Fonts",
    fontsource: "Fontsource",
    manual: t.manualImport
  };

  return labels[source] ?? source;
}
