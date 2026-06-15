import { LibraryBig } from "lucide-react";
import { t } from "../lib/i18n";

type OnlineSourceBarProps = {
  activeSource: "all" | "google-fonts" | "fontsource";
  googleFontsCount: number;
  fontsourceCount: number;
  onSelectGoogleFonts: () => void;
  onSelectFontsource: () => void;
};

export function OnlineSourceBar({
  activeSource,
  googleFontsCount,
  fontsourceCount,
  onSelectGoogleFonts,
  onSelectFontsource
}: OnlineSourceBarProps) {
  return (
    <div className="online-source-strip" aria-label={t.onlineSources}>
      <button
        className={
          activeSource === "google-fonts"
            ? "online-source-chip google active"
            : "online-source-chip google"
        }
        type="button"
        title={`Google Fonts · ${t.connectedCatalog} ${googleFontsCount} ${t.fontsUnit}`}
        onClick={onSelectGoogleFonts}
      >
        <strong className="source-lettermark" aria-hidden="true">
          G
        </strong>
        <span>
          <strong>Google Fonts</strong>
          <em>{googleFontsCount}</em>
        </span>
      </button>

      <button
        className={
          activeSource === "fontsource"
            ? "online-source-chip active"
            : "online-source-chip"
        }
        type="button"
        title={`Fontsource · ${t.connectedCatalog} ${fontsourceCount} ${t.fontsUnit}`}
        onClick={onSelectFontsource}
      >
        <LibraryBig size={15} />
        <span>
          <strong>Fontsource</strong>
          <em>{fontsourceCount}</em>
        </span>
      </button>
    </div>
  );
}
