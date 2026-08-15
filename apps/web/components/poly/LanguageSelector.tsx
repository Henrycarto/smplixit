"use client";

import type { LanguageInfo } from "@smplixit/shared-types";
import { useEffect, useMemo, useState } from "react";

import { poly } from "@/lib/api";
import { cn } from "@/components/ui/cn";

interface LanguageSelectorProps {
  value: string | null;
  onChange: (code: string | null, language: LanguageInfo | null) => void;
  disabled?: boolean;
  /** Preferred language from the FHIR chart, surfaced at the top of the list. */
  chartLanguage?: string | null;
}

/**
 * Language picker.
 *
 * Two groups, and the split is the important part. Tier 1 returns a document in
 * seconds. Tier 2 routes to interpreter services. A nurse needs to know which
 * one they are choosing before they choose it, not after they wait for a
 * response that never comes.
 *
 * A native select, not a custom dropdown. It handles 66 options, type-ahead,
 * and every assistive technology without any work, and a hospital workstation
 * running a locked-down browser build renders it correctly every time.
 */
export function LanguageSelector({
  value,
  onChange,
  disabled,
  chartLanguage,
}: LanguageSelectorProps) {
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    poly
      .languages()
      .then((response) => {
        if (!cancelled) setLanguages(response.languages);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { machine, review } = useMemo(
    () => ({
      machine: languages.filter((language) => language.machine_translatable),
      review: languages.filter((language) => !language.machine_translatable),
    }),
    [languages],
  );

  const selected = languages.find((language) => language.code === value) ?? null;
  const chartMatch = chartLanguage
    ? (languages.find((language) => language.code === chartLanguage.toLowerCase()) ?? null)
    : null;

  if (error) {
    return (
      <div className="border border-caution/50 bg-caution-muted px-2 py-1 text-2xs text-caution-text">
        Translation service unavailable
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="language" className="label-micro shrink-0">
        Language
      </label>

      <select
        id="language"
        value={value ?? ""}
        disabled={disabled || languages.length === 0}
        onChange={(event) => {
          const code = event.target.value || null;
          onChange(code, languages.find((language) => language.code === code) ?? null);
        }}
        className={cn(
          "h-7 min-w-[200px] rounded-none border border-panel-strong bg-panel px-2",
          "text-xs text-slate-ink",
          "disabled:bg-panel-muted disabled:text-slate",
        )}
      >
        <option value="">English (no translation)</option>

        {chartMatch ? (
          <optgroup label="From patient chart">
            <option value={chartMatch.code}>
              {chartMatch.name} ({chartMatch.native_name})
            </option>
          </optgroup>
        ) : null}

        <optgroup label={`Machine translated (${machine.length})`}>
          {machine.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name} ({language.native_name})
            </option>
          ))}
        </optgroup>

        <optgroup label={`Interpreter services required (${review.length})`}>
          {review.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name} ({language.native_name})
            </option>
          ))}
        </optgroup>
      </select>

      {selected && !selected.machine_translatable ? (
        <span className="border border-caution/50 bg-caution-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-label text-caution-text">
          Interpreter
        </span>
      ) : null}

      {chartLanguage && !chartMatch ? (
        <span
          className="text-2xs text-slate"
          title={`The chart records '${chartLanguage}', which is not a supported target.`}
        >
          chart: {chartLanguage}
        </span>
      ) : null}
    </div>
  );
}
