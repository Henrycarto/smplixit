"use client";

import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

/**
 * Square corners, flat fills, hairline borders.
 *
 * No pill radius and no shadow. On a clinical console a button is a control,
 * and controls read as controls when they look like they were stamped out of
 * the same grid as the fields next to them.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover disabled:bg-accent/40 disabled:border-transparent",
  secondary:
    "bg-panel text-slate-ink border border-panel-strong hover:bg-panel-muted disabled:text-slate",
  ghost:
    "bg-transparent text-slate border border-transparent hover:bg-shell-hover hover:text-white",
  danger:
    "bg-danger text-white border border-danger hover:bg-danger-hover hover:border-danger-hover",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", asChild = false, ...props },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-none font-medium",
        "transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});
