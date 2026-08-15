import { cn } from "./cn";

export type StatusTone = "pass" | "warn" | "fail" | "neutral" | "info";

const TONES: Record<StatusTone, string> = {
  pass: "border-accent/40 bg-accent-muted text-accent-text",
  warn: "border-caution/40 bg-caution-muted text-caution-text",
  fail: "border-danger/40 bg-danger-muted text-danger-text",
  info: "border-panel-strong bg-panel-muted text-slate-dark",
  neutral: "border-shell-border bg-shell-raised text-slate",
};

interface StatusPillProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/**
 * Rectangular status marker.
 *
 * Not a pill despite the name, which is a holdover. Square corners and a
 * 1px border, sized to sit inline in a table row without changing its height.
 */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap border px-1.5 py-0.5",
        "text-2xs font-semibold uppercase tracking-label",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Map a job status onto a tone. Kept here so every screen agrees. */
export function statusTone(status: string): StatusTone {
  switch (status) {
    case "completed":
    case "releasable":
      return "pass";
    case "needs_review":
    case "human_translation_required":
      return "warn";
    case "failed":
      return "fail";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Released";
    case "needs_review":
      return "Held for review";
    case "failed":
      return "Failed";
    case "releasable":
      return "Releasable";
    case "human_translation_required":
      return "Interpreter";
    default:
      return status.replace(/_/g, " ");
  }
}
