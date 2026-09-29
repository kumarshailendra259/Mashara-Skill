// Centralized Financial Year (FY) config + helpers — single source of truth.
// Indian FY: 1-Apr YYYY → 31-Mar (YYYY+1). To add FY 2030-31 later, bump
// FY_MAX_START_YEAR to 2030 — nothing else needs to change.
export const FY_MIN_START_YEAR = 2023; // first selectable FY → "2023-24"
export const FY_MAX_START_YEAR = 2029; // last selectable FY  → "2029-30"

export const FY_ALL = "all";

const label = (y) => `FY ${y}-${String(y + 1).slice(2)}`;
const value = (y) => `${y}-${String(y + 1).slice(2)}`;

// [{ value, label, start, end }] — includes the "All FY" sentinel first.
export function fyOptions() {
  const opts = [{ value: FY_ALL, label: "All Financial Years", start: null, end: null }];
  for (let y = FY_MIN_START_YEAR; y <= FY_MAX_START_YEAR; y += 1) {
    opts.push({ value: value(y), label: label(y), start: `${y}-04-01`, end: `${y + 1}-03-31` });
  }
  return opts;
}

export function currentFY() {
  const d = new Date();
  let sy = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  sy = Math.max(FY_MIN_START_YEAR, Math.min(FY_MAX_START_YEAR, sy));
  return value(sy);
}

export function fyShortLabel(v) {
  if (!v || v === FY_ALL) return "All FY";
  return `FY ${v}`;
}
