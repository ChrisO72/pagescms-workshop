"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type OttoState = "ready" | "working";

type OttoPortrait = {
  frames: [string, string, string, string];
  label: string;
};

const portraits: Record<OttoState, OttoPortrait> = {
  ready: {
    frames: [
      "/images/otto/ready-1.png",
      "/images/otto/ready-2.png",
      "/images/otto/ready-3.png",
      "/images/otto/ready-4.png",
    ],
    label: "Otto is ready",
  },
  working: {
    frames: [
      "/images/otto/working-1.png",
      "/images/otto/working-2.png",
      "/images/otto/working-3.png",
      "/images/otto/working-4.png",
    ],
    label: "Otto is working",
  },
};

export function getOttoState(active: boolean): OttoState {
  return active ? "working" : "ready";
}

export function OttoPortrait({
  state = "ready",
  size = "avatar",
  className,
}: {
  state?: OttoState;
  size?: "avatar" | "call" | "hero";
  className?: string;
}) {
  const portrait = portraits[state];
  const pixels = size === "hero" ? 176 : size === "call" ? 144 : 48;
  const [selection, setSelection] = useState({ state, frame: 0 });

  useEffect(() => {
    setSelection({
      state,
      frame: Math.floor(Math.random() * portrait.frames.length),
    });
  }, [portrait.frames.length, state]);

  const selectedFrame = selection.state === state ? selection.frame : 0;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border bg-muted",
        size === "hero"
          ? "size-44 rounded-3xl shadow-sm"
          : size === "call"
            ? "size-24 rounded-full shadow-xl ring-4 ring-background sm:size-32 lg:size-36"
            : "size-11 rounded-full shadow-sm",
        className,
      )}
      title={portrait.label}
      role="img"
      aria-label={`${portrait.label} (placeholder artwork)`}
    >
      <Image
        src={portrait.frames[selectedFrame]}
        alt=""
        aria-hidden="true"
        width={pixels}
        height={pixels}
        className="absolute inset-0 size-full object-cover"
        priority={size === "hero"}
      />
      {state === "working" && size !== "hero" ? (
        <span className="absolute inset-0 rounded-full ring-2 ring-inset ring-primary/60" />
      ) : null}
    </div>
  );
}

export function OttoStatus({ state, className }: { state: OttoState; className?: string }) {
  const portrait = portraits[state];
  return (
    <div className={cn("pointer-events-none flex flex-col items-center", className)} aria-live="polite">
      <OttoPortrait state={state} size="call" />
      <div className="-mt-3 flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur-sm sm:text-sm">
        <span className={cn("size-2 rounded-full bg-primary", state === "working" && "animate-pulse")} />
        <span>{portrait.label}</span>
      </div>
    </div>
  );
}
