import React from "react";
import { inr } from "@/lib/i18n";

/**
 * Modern SaaS KPI card.
 * Backward compatible: existing callers pass only {label, value, accent, testId}.
 * Optional: icon (lucide component), tone ("investment"|"positive"|"negative"|"neutral"),
 * sub (small trend/comparison text), raw (render value as-is instead of inr()).
 */
export default function KpiCard({ label, value, accent, testId, icon: Icon, tone, sub, raw }) {
  const t = tone || (accent === "positive" ? "positive" : accent === "negative" ? "negative" : "neutral");
  const valueColor =
    accent === "positive" ? "value-positive" : accent === "negative" ? "value-negative" : "text-[var(--text)]";
  const iconBox = {
    investment: "bg-[var(--investment-soft)] text-[var(--investment)]",
    positive: "bg-[var(--success-soft)] text-[var(--success)]",
    negative: "bg-[var(--danger-soft)] text-[var(--danger)]",
    neutral: "bg-[var(--brand-soft)] text-[var(--brand)]",
  }[t];

  return (
    <div className="swiss-card p-5 flex items-start justify-between gap-3 hover:border-slate-300" data-testid={testId}>
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="overline">{label}</div>
        <div className={`font-heading font-bold text-2xl md:text-3xl num tracking-tight ${valueColor}`}>
          {raw ? value : inr(value)}
        </div>
        {sub ? <div className="text-xs text-[var(--muted)] font-medium truncate">{sub}</div> : null}
      </div>
      {Icon && (
        <div className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${iconBox}`}>
          <Icon size={18} strokeWidth={2} />
        </div>
      )}
    </div>
  );
}
