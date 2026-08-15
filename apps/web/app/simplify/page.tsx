"use client";

import type {
  LanguageInfo,
  ScoreResponse,
  SimplifyResponse,
  TranslateResponse,
  ValidateResponse,
} from "@smplixit/shared-types";
import { useCallback, useState } from "react";

import { BeforeAfterPanel } from "@/components/core/BeforeAfterPanel";
import { DischargeInput } from "@/components/core/DischargeInput";
import { SimplifiedOutput } from "@/components/core/SimplifiedOutput";
import { DrugWarningPanel } from "@/components/guard/DrugWarningPanel";
import { SafetyScoreIndicator } from "@/components/guard/SafetyScoreIndicator";
import { LanguageSelector } from "@/components/poly/LanguageSelector";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { ApiRequestError, core, guard, poly } from "@/lib/api";
import { SAMPLE_DISCHARGE_SUMMARY } from "@/lib/sample";

const TARGET_GRADES = [4, 5, 6, 7, 8];

/**
 * The workspace.
 *
 * Two columns, source on the left and patient instructions on the right, with
 * the reading level strip across the top and the safety findings docked to the
 * right rail. The before and after occupies the full height of the viewport
 * because the before and after is the product.
 */
export default function SimplifyPage() {
  const [sourceText, setSourceText] = useState("");
  const [targetGrade, setTargetGrade] = useState(6);
  const [sourceScore, setSourceScore] = useState<ScoreResponse | null>(null);

  const [result, setResult] = useState<SimplifyResponse | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [translation, setTranslation] = useState<TranslateResponse | null>(null);

  const [language, setLanguage] = useState<string | null>(null);
  const [languageInfo, setLanguageInfo] = useState<LanguageInfo | null>(null);

  const [running, setRunning] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = sourceText.trim().length >= 40 && !running;

  const runSimplify = useCallback(async () => {
    setRunning(true);
    setError(null);
    setValidation(null);
    setTranslation(null);

    try {
      const response = await core.simplify({
        discharge_summary: sourceText,
        target_grade: targetGrade,
        run_guard: true,
      });
      setResult(response);

      // Core already asked Guard for a verdict and embedded the summary. Fetch
      // the full finding list separately so the panel can show what changed
      // rather than only how many things did.
      try {
        const detail = await guard.validate({
          original_text: response.original_text,
          simplified_text: response.simplified_text,
          job_id: response.job_id,
        });
        setValidation(detail);
      } catch {
        // Guard detail is supplementary. The verdict Core embedded still drives
        // the release decision, so a failure here does not fail the rewrite.
        setValidation(null);
      }
    } catch (cause) {
      const message =
        cause instanceof ApiRequestError
          ? [cause.message, cause.detail].filter(Boolean).join(". ")
          : cause instanceof Error
            ? cause.message
            : "The rewrite failed.";
      setError(message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sourceText, targetGrade]);

  const runTranslate = useCallback(
    async (code: string, info: LanguageInfo | null) => {
      if (!result) return;
      setTranslating(true);
      try {
        const response = await poly.translate({
          text: result.simplified_text,
          target_lang: code,
          job_id: result.job_id,
          // Freeze every medication Guard found. This is the contract between
          // the two services: Guard knows the drug names, Poly protects them.
          preserve_terms: (validation?.output_medications ?? []).map((m) => m.surface_form),
        });
        setTranslation(response);
      } catch (cause) {
        setTranslation(null);
        setError(cause instanceof Error ? cause.message : "Translation failed.");
      } finally {
        setTranslating(false);
      }
      void info;
    },
    [result, validation],
  );

  return (
    <main className="flex h-full min-h-0 flex-col">
      <ControlBar
        targetGrade={targetGrade}
        onTargetGrade={setTargetGrade}
        language={language}
        onLanguage={(code, info) => {
          setLanguage(code);
          setLanguageInfo(info);
          setTranslation(null);
          if (code && result) void runTranslate(code, info);
        }}
        onRun={runSimplify}
        onLoadSample={() => {
          setSourceText(SAMPLE_DISCHARGE_SUMMARY);
          setResult(null);
          setValidation(null);
          setTranslation(null);
          setError(null);
        }}
        onClear={() => {
          setSourceText("");
          setResult(null);
          setValidation(null);
          setTranslation(null);
          setSourceScore(null);
          setError(null);
        }}
        canRun={canRun}
        running={running}
        hasResult={Boolean(result)}
        translating={translating}
      />

      <div className="shrink-0 px-3 pt-3">
        <BeforeAfterPanel
          result={result}
          sourceScore={sourceScore}
          targetGrade={targetGrade}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_360px]">
        <DischargeInput
          value={sourceText}
          onChange={(value) => {
            setSourceText(value);
            if (result) setResult(null);
          }}
          onScored={setSourceScore}
          targetGrade={targetGrade}
          disabled={running}
        />

        <SimplifiedOutput
          result={result}
          translatedText={translation?.translated_text ?? null}
          rtl={languageInfo?.rtl ?? false}
          loading={running}
          error={error}
        />

        <aside className="flex min-h-0 flex-col gap-3">
          <SafetyScoreIndicator
            guard={result?.guard ?? null}
            unavailable={Boolean(result) && !result?.guard}
          />

          {translation && translation.status !== "releasable" ? (
            <TranslationNotice translation={translation} />
          ) : null}

          <DrugWarningPanel validation={validation} loading={running} />
        </aside>
      </div>
    </main>
  );
}

function ControlBar({
  targetGrade,
  onTargetGrade,
  language,
  onLanguage,
  onRun,
  onLoadSample,
  onClear,
  canRun,
  running,
  hasResult,
  translating,
}: {
  targetGrade: number;
  onTargetGrade: (grade: number) => void;
  language: string | null;
  onLanguage: (code: string | null, info: LanguageInfo | null) => void;
  onRun: () => void;
  onLoadSample: () => void;
  onClear: () => void;
  canRun: boolean;
  running: boolean;
  hasResult: boolean;
  translating: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-shell-border bg-shell-raised px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="label-micro">Target grade</span>
        <div className="flex border border-shell-border">
          {TARGET_GRADES.map((grade) => (
            <button
              key={grade}
              type="button"
              onClick={() => onTargetGrade(grade)}
              disabled={running}
              className={cn(
                "tabular h-7 w-8 border-r border-shell-border text-xs last:border-r-0",
                "transition-colors disabled:opacity-50",
                grade === targetGrade
                  ? "bg-accent font-semibold text-white"
                  : "bg-shell text-slate hover:bg-shell-hover hover:text-white",
              )}
            >
              {grade}
            </button>
          ))}
        </div>
      </div>

      <div className={cn(!hasResult && "pointer-events-none opacity-40")}>
        <LanguageSelector
          value={language}
          onChange={onLanguage}
          disabled={!hasResult || running || translating}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onLoadSample} disabled={running}>
          Load sample
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={running}>
          Clear
        </Button>
        <Button size="sm" onClick={onRun} disabled={!canRun}>
          {running ? "Rewriting" : "Rewrite to grade " + targetGrade}
        </Button>
      </div>
    </div>
  );
}

function TranslationNotice({ translation }: { translation: TranslateResponse }) {
  const isInterpreter = translation.status === "human_translation_required";

  return (
    <div
      className={cn(
        "border px-3 py-2",
        isInterpreter ? "border-caution/50 bg-caution-muted" : "border-danger bg-danger-muted",
      )}
    >
      <span
        className={cn(
          "text-2xs font-semibold uppercase tracking-label",
          isInterpreter ? "text-caution-text" : "text-danger-text",
        )}
      >
        {isInterpreter ? "Interpreter services required" : "Translation held"}
      </span>
      {translation.review_reasons.map((reason, index) => (
        <p
          key={index}
          className={cn(
            "mt-1 text-xs leading-snug",
            isInterpreter ? "text-caution-text" : "text-danger-text",
          )}
        >
          {reason}
        </p>
      ))}
      {translation.lost_terms.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {translation.lost_terms.map((term) => (
            <span
              key={term}
              className="border border-danger bg-panel px-1.5 py-0.5 font-mono text-2xs text-danger-text"
            >
              {term}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
