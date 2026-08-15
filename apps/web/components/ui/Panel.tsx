import type { ReactNode } from "react";

import { cn } from "./cn";

interface PanelProps {
  /** Uppercase micro label in the header bar. */
  title: string;
  /** Right-aligned header slot: counts, badges, controls. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Dark variant for panels that sit inside the shell chrome. */
  tone?: "light" | "dark";
}

/**
 * The only container in the product.
 *
 * A fixed 28px header strip carrying a label and a meta slot, then content.
 * Uniform headers are what let a clinician find the same control in the same
 * place on every screen, which matters more than any individual layout being
 * optimal.
 */
export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName,
  tone = "light",
}: PanelProps) {
  const dark = tone === "dark";

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col border",
        dark ? "border-shell-border bg-shell-raised" : "border-panel-border bg-panel",
        className,
      )}
    >
      <header
        className={cn(
          "flex h-7 shrink-0 items-center justify-between gap-3 border-b px-3",
          dark ? "border-shell-border bg-shell" : "border-panel-border bg-panel-muted",
        )}
      >
        <h2
          className={cn(
            "text-2xs font-semibold uppercase tracking-label",
            dark ? "text-slate" : "text-slate-dark",
          )}
        >
          {title}
        </h2>
        {meta ? <div className="flex items-center gap-2 text-2xs text-slate">{meta}</div> : null}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
