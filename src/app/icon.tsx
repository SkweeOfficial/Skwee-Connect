import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the SKWEE brand mark —
// cocoa (--primary) rounded square + a bold cream "S". The full
// SKWEE wordmark (see `public/skwee-logo.png`, used in the sidebar
// and login/signup) is a wide horizontal lockup that doesn't read at
// 32×32, so the favicon uses a simple letterform instead. Next.js
// renders this at build time and auto-injects <link rel="icon">.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
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
          background: "#8c6948", // --primary (SKWEE cocoa)
          borderRadius: 6,
        }}
      >
        <span
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#fbf8f2", // cream-50
            fontFamily: "sans-serif",
            lineHeight: 1,
          }}
        >
          S
        </span>
      </div>
    ),
    { ...size },
  );
}
