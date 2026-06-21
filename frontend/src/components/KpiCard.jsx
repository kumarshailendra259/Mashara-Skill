import React from "react";
import { inr } from "@/lib/i18n";

export default function KpiCard({ label, value, accent, testId }) {
  const colorClass =
    accent === "positive" ? "value-positive" : accent === "negative" ? "value-negative" : "text-[var(--text)]";
  return (
    <div className="swiss-card p-5 flex flex-col gap-2" data-testid={testId}>
      <div className="overline">{label}</div>
      <div className={`font-heading font-black text-2xl md:text-3xl num tracking-tight ${colorClass}`}>
        {inr(value)}
      </div>
    </div>
  );
}
