import { ImageResponse } from "next/og";

import { SITE } from "@/lib/site";

/**
 * Link preview card.
 *
 * The metadata declares `summary_large_image`, so a shared link needs an image
 * or the card renders as a bare text stub. This draws one in the product's own
 * tokens rather than pulling in a screenshot that would go stale.
 *
 * The figures are the worked example the landing page already carries, so the
 * card and the page a click later state the same numbers. Concrete figures
 * survive thumbnail size in a way a tagline does not.
 */

// `next/og` ships a Node build that resolves its WASM binary through
// `fileURLToPath`, which throws on a Windows path containing spaces and takes
// the whole build with it. The edge build has no such lookup, and an image
// route is the case the edge runtime is meant for.
export const runtime = "edge";

export const alt = `${SITE.name}, ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SHELL = "#0F1923";
const BORDER = "#1F2E3D";
const ACCENT = "#0D9488";
const SLATE = "#94A3B8";
const SLATE_DARK = "#64748B";

const FROM = 16.4;
const TO = 5.2;

export default function OpengraphImage() {
  const reduction = ((FROM - TO) / FROM) * 100;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: SHELL,
          borderTop: `6px solid ${ACCENT}`,
          padding: "56px 72px 60px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: SLATE_DARK,
            }}
          >
            {SITE.tagline}
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 86,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "#FFFFFF",
            }}
          >
            {SITE.name}
          </div>
          <div
            style={{
              marginTop: 18,
              maxWidth: 940,
              fontSize: 27,
              lineHeight: 1.4,
              color: SLATE,
            }}
          >
            {SITE.description}
          </div>
        </div>

        {/* The badge motif, flattened to what survives a thumbnail. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
            <Figure label="Source" value={FROM} color={SLATE_DARK} />
            <div style={{ display: "flex", fontSize: 40, color: SLATE_DARK, paddingBottom: 6 }}>
              &rarr;
            </div>
            <Figure label="Patient" value={TO} color={ACCENT} />
            <div
              style={{
                display: "flex",
                marginLeft: "auto",
                paddingBottom: 10,
                fontSize: 24,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: SLATE_DARK,
              }}
            >
              {reduction.toFixed(0)}% reduction
            </div>
          </div>

          <div style={{ display: "flex", marginTop: 22, height: 8, backgroundColor: BORDER }}>
            <div style={{ display: "flex", width: `${reduction}%`, backgroundColor: ACCENT }} />
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function Figure({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 20,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: SLATE_DARK,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
        <div style={{ fontSize: 22, letterSpacing: "0.1em", textTransform: "uppercase", color: SLATE }}>
          Grade
        </div>
        <div style={{ fontSize: 66, fontWeight: 600, letterSpacing: "-0.02em", color }}>
          {value.toFixed(1)}
        </div>
      </div>
    </div>
  );
}
