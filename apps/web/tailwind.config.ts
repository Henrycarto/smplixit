import type { Config } from "tailwindcss";

/**
 * Design system.
 *
 * The reference point is a clinical workstation, not a marketing site. Every
 * token below exists to serve information density:
 *
 *  - Borders separate regions, not shadows. Shadows imply floating cards, and
 *    a floating card wastes the pixels around it.
 *  - Radii top out at 3px. Rounded pills read as consumer software.
 *  - The type scale starts at 11px because a discharge summary and its rewrite
 *    have to sit side by side on a 1440px workstation display without scrolling.
 *  - Teal is rationed. It marks the literacy score, primary actions, and active
 *    state. Nothing else. A color that appears everywhere signals nothing.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        shell: {
          DEFAULT: "#0F1923", // app chrome
          raised: "#16232F", // rails, headers, inset panels
          border: "#1F2E3D", // separators on dark
          hover: "#1B2A38",
        },
        panel: {
          DEFAULT: "#FFFFFF", // content surfaces
          muted: "#F6F8FA", // table stripes, read-only fields
          border: "#DDE3E9",
          strong: "#C4CDD6",
        },
        accent: {
          DEFAULT: "#0D9488", // clinical teal
          hover: "#0F766E",
          muted: "#CCFBF1",
          text: "#0B7A70",
        },
        slate: {
          DEFAULT: "#94A3B8", // all supporting text and labels
          dark: "#64748B",
          ink: "#1E293B", // body copy on white
        },
        danger: {
          DEFAULT: "#EF4444", // Guard findings
          hover: "#DC2626",
          muted: "#FEE2E2",
          text: "#B91C1C",
        },
        caution: {
          DEFAULT: "#D97706", // warning severity, distinct from critical
          muted: "#FEF3C7",
          text: "#92400E",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }], // 11px, table meta
        xs: ["0.75rem", { lineHeight: "1.125rem" }], // 12px, labels
        sm: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px, dense body
        base: ["0.875rem", { lineHeight: "1.375rem" }], // 14px, reading panes
      },
      letterSpacing: {
        tight: "-0.02em", // headings, per the design system
        label: "0.06em", // uppercase micro labels
      },
      borderRadius: {
        none: "0",
        DEFAULT: "2px",
        md: "3px",
      },
      spacing: {
        header: "48px",
        rail: "216px",
      },
      transitionDuration: {
        DEFAULT: "120ms",
      },
    },
  },
  plugins: [],
};

export default config;
