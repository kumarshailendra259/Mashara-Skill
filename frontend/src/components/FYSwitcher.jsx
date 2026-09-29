import React from "react";
import { useFY } from "@/context/FYContext";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarRange } from "lucide-react";

/**
 * Global Financial Year selector. Placed in the top header (applies app-wide)
 * and can be embedded inline on finance pages via variant="inline".
 */
export default function FYSwitcher({ variant = "header" }) {
  const { fy, setFy, options } = useFY();

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-1.5" data-testid="fy-switcher-inline">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--muted)]">Financial Year</span>
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="rounded-none h-9 w-[170px]" data-testid="fy-select-inline">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-none">
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} data-testid={`fy-option-${o.value}`}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <Select value={fy} onValueChange={setFy}>
      <SelectTrigger
        className="rounded-none h-9 gap-1.5 w-[128px] border-[var(--brand)]/40 font-semibold"
        data-testid="fy-switcher"
      >
        <CalendarRange size={14} className="text-[var(--brand)] shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-none max-h-96" align="end">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} data-testid={`fy-option-${o.value}`}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
