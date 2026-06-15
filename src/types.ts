export type FontSource = "local" | "google-fonts" | "fontsource" | "manual";

export type FontLanguage = "chinese" | "english" | "mixed";

export type LicenseKind =
  | "ofl"
  | "free-commercial"
  | "apache"
  | "cc0"
  | "personal"
  | "unknown";

export type FontStatus = "indexed" | "downloaded" | "installed";

export type FontVariant = {
  id: string;
  styleName: string;
  weight: number;
  format: string;
  extension: string;
  size: number;
  sizeLabel: string;
  path?: string;
  relativePath?: string;
  libraryRoot?: string;
  fontUrl?: string;
  downloadUrl?: string;
  fontFormat?: string;
  isPreviewable: boolean;
  isItalic: boolean;
};

export type FontAsset = {
  id: string;
  family: string;
  styleName: string;
  category: string;
  moodTags: string[];
  source: FontSource;
  language: FontLanguage;
  license: LicenseKind;
  licenseLabel: string;
  status: FontStatus;
  formats: string[];
  path?: string;
  libraryRoot?: string;
  sizeLabel: string;
  languageSupport: string[];
  sampleText: string;
  cssFamily: string;
  previewFamily?: string;
  fontUrl?: string;
  fontFormat?: string;
  weights: number[];
  activeVariantId?: string;
  variants: FontVariant[];
  totalFiles: number;
  canPreview: boolean;
  licenseUrl?: string;
  remoteId?: string;
  remoteDetailsLoaded?: boolean;
  variableAxes?: Array<{
    tag: string;
    label: string;
    min: number;
    max: number;
    value: number;
  }>;
  foundry: string;
  addedAt: string;
  isFavorite: boolean;
};

export type ProjectPack = {
  id: string;
  name: string;
  description: string;
  fontIds: string[];
  parentId?: string;
};
