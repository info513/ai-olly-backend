"use client";

import * as React from "react";
import { Eraser } from "lucide-react";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  clear: () => void;
  toBlob: () => Promise<Blob | null>;
}

/**
 * Lightweight canvas signature pad. Captures strokes and exports a compact PNG.
 * No external deps. The PNG is uploaded privately by the caller — this component
 * never persists anything itself.
 */
export const SignaturePad = React.forwardRef<SignaturePadHandle, { onChange?: (hasInk: boolean) => void; disabled?: boolean }>(
  function SignaturePad({ onChange, disabled }, ref) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const drawing = React.useRef(false);
    const inked = React.useRef(false);

    const ctx = () => canvasRef.current?.getContext("2d") ?? null;

    React.useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      const g = c.getContext("2d");
      if (g) { g.scale(dpr, dpr); g.lineWidth = 2.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#111827"; }
    }, []);

    const pos = (e: React.PointerEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const down = (e: React.PointerEvent) => {
      if (disabled) return;
      drawing.current = true;
      canvasRef.current?.setPointerCapture(e.pointerId);
      const g = ctx(); if (!g) return;
      const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y);
    };
    const move = (e: React.PointerEvent) => {
      if (!drawing.current || disabled) return;
      const g = ctx(); if (!g) return;
      const p = pos(e); g.lineTo(p.x, p.y); g.stroke();
      if (!inked.current) { inked.current = true; onChange?.(true); }
    };
    const up = () => { drawing.current = false; };

    React.useImperativeHandle(ref, () => ({
      isEmpty: () => !inked.current,
      clear: () => {
        const c = canvasRef.current, g = ctx();
        if (c && g) g.clearRect(0, 0, c.width, c.height);
        inked.current = false; onChange?.(false);
      },
      toBlob: () => new Promise((resolve) => {
        const c = canvasRef.current;
        if (!c || !inked.current) return resolve(null);
        c.toBlob((b) => resolve(b), "image/png");
      }),
    }));

    return (
      <div className="rounded-md border border-border-strong bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          className="h-40 w-full touch-none rounded-md"
          style={{ cursor: disabled ? "not-allowed" : "crosshair" }}
        />
      </div>
    );
  }
);

export function SignatureClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary">
      <Eraser className="h-3.5 w-3.5" /> Clear
    </button>
  );
}
