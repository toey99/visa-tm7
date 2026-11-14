"use client";

// =============================================================
// ClosingNote — the day's closing note drawn as a lined notepad page
// =============================================================
// Yellow paper when the agent still has money with us (balance ≥ 0),
// purple paper when the agent has to transfer more (balance < 0) — the same
// colour code as the hand-written notes. Captured with captureNode → PNG.

import { forwardRef } from "react";

type Props = { text: string; negative: boolean };

const ClosingNote = forwardRef<HTMLDivElement, Props>(function ClosingNote({ text, negative }, ref) {
  const paper = negative ? "#efe6ff" : "#fff6a8";
  const line = negative ? "rgba(124, 58, 237, 0.18)" : "rgba(202, 138, 4, 0.22)";
  const ink = "#1f2937";
  const LH = 44;   // px per ruled line
  const lines = text.split("\n");
  return (
    <div
      ref={ref}
      style={{
        width: 720,
        padding: `${LH * 0.5}px 28px ${LH}px`,
        background: `repeating-linear-gradient(to bottom, ${paper} 0px, ${paper} ${LH - 1}px, ${line} ${LH - 1}px, ${line} ${LH}px)`,
        backgroundColor: paper,
        color: ink,
        fontFamily: "'Noto Sans Thai', 'Sarabun', 'Segoe UI', system-ui, sans-serif",
        fontSize: 27,
        lineHeight: `${LH}px`,
        fontWeight: 500,
        letterSpacing: 0.2,
        wordBreak: "break-word",
      }}
    >
      {lines.map((l, i) => (
        <div key={i} style={{ minHeight: LH, whiteSpace: "pre-wrap" }}>{l || " "}</div>
      ))}
    </div>
  );
});

export default ClosingNote;
