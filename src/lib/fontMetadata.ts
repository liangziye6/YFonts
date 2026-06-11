import { t } from "./i18n";
import type { LicenseKind } from "../types";

export const licenseMetadataOptions: Array<{ value: LicenseKind; label: string }> = [
  { value: "free-commercial", label: t.localCommercial },
  { value: "ofl", label: "OFL" },
  { value: "apache", label: "Apache" },
  { value: "cc0", label: "CC0" },
  { value: "personal", label: t.personalOnly },
  { value: "unknown", label: t.licenseReview }
];

export function getLicenseMetadataLabel(license: LicenseKind) {
  return licenseMetadataOptions.find((option) => option.value === license)?.label ?? t.licenseReview;
}
