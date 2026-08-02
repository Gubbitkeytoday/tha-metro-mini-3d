import { useMemo } from "react";
import { availableLanguages } from "../i18n/languages";
import { useStrings } from "../i18n/useStrings";
import { useAppStore, type LightingMode } from "../stores/useAppStore";
import { GLASS_DIVIDER } from "./glass";

/**
 * View options: what is drawn, how it is lit, what language it is in, and
 * where you are.
 *
 * These sit inside the LineSelector panel rather than in their own floating
 * card — they are view options for the same 3D layer the line toggles above
 * them control, and a second panel would crowd an already busy corner.
 */

function ModeToggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        title={hint}
        // Matches LineRow: sized by pointer type so a tablet gets fingertip
        // targets even though it is wider than the `sm` breakpoint.
        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-slate-200/60 pointer-coarse:min-h-11 ${
          on ? "text-slate-800" : "text-slate-400"
        }`}
        onClick={() => onChange(!on)}
      >
        <span
          aria-hidden
          className={`inline-flex h-3 w-6 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            on ? "bg-slate-700" : "bg-slate-300"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full bg-white transition-transform ${
              on ? "translate-x-3" : "translate-x-0"
            }`}
          />
        </span>
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

const SECTION = "mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400";

export function SceneModes() {
  const t = useStrings();
  const undergroundVisible = useAppStore((s) => s.undergroundVisible);
  const setUndergroundVisible = useAppStore((s) => s.setUndergroundVisible);
  const showStationLabels = useAppStore((s) => s.showStationLabels);
  const setShowStationLabels = useAppStore((s) => s.setShowStationLabels);
  const shadows = useAppStore((s) => s.shadows);
  const setShadows = useAppStore((s) => s.setShadows);
  const buildings = useAppStore((s) => s.buildings);
  const setBuildings = useAppStore((s) => s.setBuildings);
  const lightingMode = useAppStore((s) => s.lightingMode);
  const setLightingMode = useAppStore((s) => s.setLightingMode);
  const night = useAppStore((s) => s.night);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const routes = useAppStore((s) => s.routes);
  const locationStatus = useAppStore((s) => s.locationStatus);
  const requestLocation = useAppStore((s) => s.requestLocation);

  // Derived from the loaded network, so the picker only ever offers languages
  // the data can actually deliver. Recomputed only when the network changes.
  const languages = useMemo(() => availableLanguages(routes), [routes]);
  const selected = languages.find((l) => l.code === language);

  const lightingModes: { value: LightingMode; label: string }[] = [
    { value: "auto", label: t.auto },
    { value: "day", label: t.day },
    { value: "night", label: t.night },
  ];

  const locating = locationStatus.state === "locating" || locationStatus.state === "tracking";

  return (
    <div className={`mt-3 border-t pt-2 ${GLASS_DIVIDER}`}>
      <h2 className={SECTION}>{t.view}</h2>
      <ul className="space-y-0.5" data-tour="view">
        <ModeToggle
          label={t.stationNames}
          hint={t.stationNames}
          on={showStationLabels}
          onChange={setShowStationLabels}
        />
        <ModeToggle
          label={t.buildings}
          hint={t.buildings}
          on={buildings}
          onChange={setBuildings}
        />
        <ModeToggle
          label={t.seeThroughTunnels}
          hint={t.seeThroughTunnels}
          on={undergroundVisible}
          onChange={setUndergroundVisible}
        />
        <ModeToggle label={t.shadows} hint={t.shadows} on={shadows} onChange={setShadows} />
      </ul>

      <h2 className={`${SECTION} flex items-baseline gap-1`}>
        {t.lighting}
        {/* Under `auto` the mode alone doesn't say what you're looking at. */}
        {lightingMode === "auto" && (
          <span className="font-normal normal-case tracking-normal text-slate-400">
            · {night ? t.nowNight : t.nowDay}
          </span>
        )}
      </h2>
      <div
        role="radiogroup"
        aria-label={t.lighting}
        className="flex gap-1 rounded-lg bg-slate-200/60 p-0.5"
        data-tour="lighting"
      >
        {lightingModes.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={lightingMode === m.value}
            onClick={() => setLightingMode(m.value)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-11 ${
              lightingMode === m.value
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:bg-white/60"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <h2 className={SECTION}>{t.language}</h2>
      <select
        aria-label={t.language}
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        data-tour="language"
        className="w-full rounded-md border border-slate-300/70 bg-white/70 px-2 py-1.5 text-xs text-slate-800 pointer-coarse:min-h-11"
      >
        {languages.map((l) => (
          // Each language is listed in its OWN script, so a reader can find
          // theirs without first reading English. No percentage here: the
          // interface is fully translated in every language offered, and a
          // number next to the name read as "this language is 9% done", which
          // was both wrong and discouraging. Station-name coverage is a
          // different thing and is explained below, only when it is not 100%.
          <option key={l.code} value={l.code} lang={l.code}>
            {l.endonym}
          </option>
        ))}
      </select>
      {selected && selected.stationsNamed < selected.stationsTotal && (
        <p className="mt-1 text-[10px] leading-snug text-slate-500">
          {t.stationNameCoverage
            .replace("{named}", String(selected.stationsNamed))
            .replace("{total}", String(selected.stationsTotal))}
        </p>
      )}

      <h2 className={SECTION}>{t.myLocation}</h2>
      <button
        type="button"
        onClick={requestLocation}
        aria-pressed={locating}
        data-tour="location"
        className={`flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 ${
          locating
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-slate-200/70 text-slate-700 hover:bg-slate-300"
        }`}
      >
        {locationStatus.state === "locating"
          ? t.locating
          : locationStatus.state === "tracking"
            ? t.stopLocating
            : t.myLocation}
      </button>
      {locationStatus.state === "tracking" && (
        <p className="mt-1 text-[10px] tabular-nums text-slate-500">
          ±{Math.round(locationStatus.accuracyM)} m
        </p>
      )}
      {locationStatus.state === "error" && (
        <p className="mt-1 text-[10px] leading-snug text-red-600">{locationStatus.message}</p>
      )}
    </div>
  );
}
