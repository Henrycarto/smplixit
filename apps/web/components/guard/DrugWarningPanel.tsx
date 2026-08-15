"use client";

import type { Finding, Severity, ValidateResponse } from "@smplixit/shared-types";
import { useState } from "react";

import { Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";

interface DrugWarningPanelProps {
  validation: ValidateResponse | null;
  loading?: boolean;
}

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

const SEVERITY_STYLE: Record<Severity, { row: string; label: string; text: string }> = {
  critical: {
    row: "border-l-2 border-l-danger bg-danger-muted/40",
    label: "bg-danger text-white",
    text: "text-danger-text",
  },
  warning: {
    row: "border-l-2 border-l-caution bg-caution-muted/40",
    label: "bg-caution text-white",
    text: "text-caution-text",
  },
  info: {
    row: "border-l-2 border-l-panel-strong",
    label: "bg-panel-strong text-slate-ink",
    text: "text-slate-dark",
  },
};

/**
 * The findings list.
 *
 * Critical findings are the point of the panel, so they are never collapsed,
 * never paginated behind a "show more", and carry a left rule in danger red
 * that survives being seen out of the corner of an eye. Advisory findings are
 * listed below them without competing for attention.
 */
export function DrugWarningPanel({ validation, loading }: DrugWarningPanelProps) {
  const [showMedications, setShowMedications] = useState(false);

  if (loading) {
    return (
      <Panel title="Drug safety" meta="checking">
        <div className="space-y-2 px-3 py-2.5">
          {["70%", "84%", "62%"].map((width, index) => (
            <div key={index} className="h-3 animate-pulse bg-panel-muted" style={{ width }} />
          ))}
        </div>
      </Panel>
    );
  }

  if (!validation) {
    return (
      <Panel title="Drug safety">
        <p className="px-3 py-2.5 text-sm text-slate">
          Run a rewrite to cross-reference medications against openFDA.
        </p>
      </Panel>
    );
  }

  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: validation.findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.findings.length > 0);

  return (
    <Panel
      title="Drug safety"
      meta={
        <>
          {!validation.fda_available ? (
            <span className="text-caution-text">openFDA unreachable</span>
          ) : null}
          <span className="tabular">
            {validation.drugs_in_source} to {validation.drugs_in_output} drugs
          </span>
          <span className="tabular">{validation.duration_ms} ms</span>
        </>
      }
      bodyClassName="flex min-h-0 flex-col"
    >
      {!validation.fda_available ? (
        <p className="shrink-0 border-b border-caution/40 bg-caution-muted px-3 py-1.5 text-xs text-caution-text">
          openFDA could not be reached. Findings below are downgraded from critical to advisory
          because no drug could be verified. They were not suppressed.
        </p>
      ) : null}

      <div className="panel-scroll min-h-0 flex-1 overflow-auto">
        {grouped.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-accent-text">
            Every medication, dose, route, frequency, and warning in the source is present and
            unchanged in the rewrite.
          </p>
        ) : (
          <ul>
            {grouped.flatMap((group) =>
              group.findings.map((finding, index) => (
                <FindingRow key={`${group.severity}-${index}`} finding={finding} />
              )),
            )}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-panel-border">
        <button
          type="button"
          onClick={() => setShowMedications((open) => !open)}
          className="flex w-full items-center justify-between bg-panel-muted px-3 py-1.5 text-left transition-colors hover:bg-panel-border/40"
        >
          <span className="label-micro">
            Medications detected ({validation.output_medications.length})
          </span>
          <span className="text-2xs text-slate-dark">{showMedications ? "hide" : "show"}</span>
        </button>

        {showMedications ? (
          <div className="panel-scroll max-h-48 overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-panel-border">
                  <Th>Medication</Th>
                  <Th>Dose</Th>
                  <Th>Route</Th>
                  <Th>Frequency</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {validation.output_medications.map((medication, index) => (
                  <tr key={`${medication.name}-${index}`} className="border-b border-panel-border">
                    <Td>
                      <span className="font-medium text-slate-ink">{medication.surface_form}</span>
                      {medication.has_boxed_warning ? (
                        <span className="ml-1.5 border border-danger px-1 text-2xs font-semibold uppercase text-danger-text">
                          Boxed
                        </span>
                      ) : null}
                    </Td>
                    <Td>{medication.dose ?? "--"}</Td>
                    <Td>{medication.route ?? "--"}</Td>
                    <Td>{medication.frequency ?? "--"}</Td>
                    <Td>
                      <span className={medication.fda_verified ? "text-accent-text" : "text-slate"}>
                        {medication.fda_verified ? "openFDA" : medication.detection}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const style = SEVERITY_STYLE[finding.severity];

  return (
    <li className={cn("border-b border-panel-border px-3 py-2", style.row)}>
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 px-1 py-0.5 text-2xs font-semibold uppercase tracking-label",
            style.label,
          )}
        >
          {finding.severity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-slate-ink">{finding.message}</p>

          {finding.source_value || finding.output_value ? (
            <div className="tabular mt-1 flex flex-wrap items-center gap-2 font-mono text-2xs">
              <span className="border border-panel-border bg-panel px-1.5 py-0.5 text-slate-dark">
                source: {finding.source_value ?? "absent"}
              </span>
              <span className="text-slate">to</span>
              <span
                className={cn(
                  "border bg-panel px-1.5 py-0.5",
                  finding.severity === "critical"
                    ? "border-danger text-danger-text"
                    : "border-panel-border text-slate-dark",
                )}
              >
                output: {finding.output_value ?? "absent"}
              </span>
            </div>
          ) : null}

          {finding.remediation ? (
            <p className={cn("mt-1 text-xs leading-snug", style.text)}>{finding.remediation}</p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-1 text-2xs font-semibold uppercase tracking-label text-slate-dark">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1 text-xs text-slate-dark">{children}</td>;
}
