import { ImageResponse } from "next/og";

/**
 * Favicon.
 *
 * A tab is 16px of signal. The mark is the accent square with the wordmark's
 * initial, which is the only thing that reads at that size, and it is the one
 * place outside the badge and primary actions where teal fills a surface.
 */

// See the note in `opengraph-image.tsx`: the Node build of `next/og` cannot
// resolve its WASM binary on a Windows path with spaces in it.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0D9488",
          color: "#FFFFFF",
          fontSize: 22,
          fontWeight: 600,
          fontFamily: "sans-serif",
        }}
      >
        S
      </div>
    ),
    size,
  );
}
