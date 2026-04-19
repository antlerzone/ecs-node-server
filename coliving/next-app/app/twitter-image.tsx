import { ImageResponse } from "next/og"

export const alt = "Coliving Management — room & coliving SaaS for Malaysia and Singapore"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

/** Twitter/X large card image — aligned with root `opengraph-image`. */
export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 72,
          background: "linear-gradient(145deg, #3d2a22 0%, #a26f5c 42%, #e8dcd7 100%)",
        }}
      >
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: "#ffffff",
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            maxWidth: 900,
            textShadow: "0 4px 24px rgba(0,0,0,0.25)",
          }}
        >
          Coliving Management
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 28,
            fontWeight: 600,
            color: "rgba(255,255,255,0.92)",
            maxWidth: 820,
            lineHeight: 1.35,
          }}
        >
          Room & coliving operations — Malaysia & Singapore
        </div>
        <div
          style={{
            marginTop: 48,
            fontSize: 20,
            fontWeight: 500,
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          www.colivingjb.com
        </div>
      </div>
    ),
    { ...size }
  )
}
