"use client";

import Ferrofluid from "./Ferrofluid";

/** Full-screen ferrofluid backdrop for the whole app (landing + protocol). */
export function Background() {
  return (
    <div className="fixed inset-0 -z-10 bg-black" aria-hidden>
      <Ferrofluid
        className="h-full w-full"
        dpr={1.5}
        mixBlendMode={undefined}
        colors={["#ffffff", "#cfcfcf", "#6f6f6f"]}
        speed={0.32}
        scale={1.5}
        turbulence={1.1}
        rimWidth={0.22}
        sharpness={2.6}
        shimmer={1.3}
        glow={1.7}
        flowDirection="down"
        opacity={0.85}
        mouseInteraction
        mouseStrength={0.8}
      />
      {/* light readability scrim + vignette (keep the fluid visible) */}
      <div className="pointer-events-none absolute inset-0 bg-black/25" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 42%, transparent 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </div>
  );
}
