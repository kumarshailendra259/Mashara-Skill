// Centralized Unit Conversion Engine (frontend mirror of backend/unit_conversion.py).
// Used for LIVE previews & line-total calculation. The BACKEND is always the
// final authority — keep this table in sync with unit_conversion.py.

export const WEIGHT = "weight";
export const VOLUME = "volume";
export const COUNT = "count";
export const PACK = "pack";

// unit -> { dim, factor to the dimension's canonical base }
export const GLOBAL_UNITS = {
  kg: { dim: WEIGHT, factor: 1 },
  gram: { dim: WEIGHT, factor: 0.001 },
  g: { dim: WEIGHT, factor: 0.001 },
  mg: { dim: WEIGHT, factor: 0.000001 },
  quintal: { dim: WEIGHT, factor: 100 },
  ton: { dim: WEIGHT, factor: 1000 },
  litre: { dim: VOLUME, factor: 1 },
  liter: { dim: VOLUME, factor: 1 },
  l: { dim: VOLUME, factor: 1 },
  ml: { dim: VOLUME, factor: 0.001 },
  piece: { dim: COUNT, factor: 1 },
  pcs: { dim: COUNT, factor: 1 },
  dozen: { dim: COUNT, factor: 12 },
  pair: { dim: COUNT, factor: 2 },
};

export const PACKAGING_UNITS = ["packet", "bag", "box", "carton", "bottle", "sack", "bundle", "cylinder"];

const ALIASES = { g: "gram", liter: "litre", l: "litre", pcs: "piece" };

const norm = (u) => {
  const x = (u || "").toString().trim().toLowerCase();
  return ALIASES[x] || x;
};

export function dimensionOf(unit) {
  const u = norm(unit);
  if (GLOBAL_UNITS[u]) return GLOBAL_UNITS[u].dim;
  if (PACKAGING_UNITS.includes(u)) return PACK;
  return null;
}

// Factor to convert `unit` -> item.base_unit. Returns null if incompatible.
export function toBaseFactor(item, unit) {
  if (!item) return null;
  const base = norm(item.base_unit);
  const purch = norm(item.purchase_unit);
  const u = norm(unit);
  const conv = Number(item.conversion_factor) > 0 ? Number(item.conversion_factor) : 1;
  if (!u) return null;
  if (u === base) return 1;
  if (u === purch) return conv;
  const du = dimensionOf(u);
  const dbase = dimensionOf(base);
  if (du && dbase && du === dbase && [WEIGHT, VOLUME, COUNT].includes(du)) {
    return GLOBAL_UNITS[u].factor / GLOBAL_UNITS[base].factor;
  }
  return null;
}

export function toBaseQty(item, qty, unit) {
  const f = toBaseFactor(item, unit);
  if (f == null) return null;
  return Number(qty || 0) * f;
}

export function isCompatible(item, unit) {
  return toBaseFactor(item, unit) != null;
}

// All units a user may enter for this item.
export function compatibleUnits(item) {
  if (!item) return [];
  const base = norm(item.base_unit);
  const purch = norm(item.purchase_unit);
  const dbase = dimensionOf(base);
  const out = [];
  if ([WEIGHT, VOLUME, COUNT].includes(dbase)) {
    Object.keys(GLOBAL_UNITS).forEach((u) => {
      if (GLOBAL_UNITS[u].dim === dbase && !ALIASES[u] && !out.includes(u)) out.push(u);
    });
  }
  [base, purch].forEach((u) => { if (u && !out.includes(u)) out.push(u); });
  return out;
}

// Reliable per-line display figures for a stored receipt line. New receipts
// carry base-normalised fields (rate_basis='base'); legacy lines fall back to
// entered qty/unit and the historically-booked amount.
export function displayLine(l) {
  if (!l) return { qty: 0, unit: "", rate: 0, amount: 0 };
  const isBase = l.rate_basis === "base" && l.qty_base != null;
  const qty = Number(
    isBase ? (l.accepted_qty_base != null ? l.accepted_qty_base : l.qty_base)
           : (l.accepted_qty != null ? l.accepted_qty : l.qty)
  ) || 0;
  const unit = (isBase ? (l.base_unit || l.unit) : (l.unit || l.base_unit)) || "";
  const rate = Number(isBase ? (l.rate_per_base != null ? l.rate_per_base : l.unit_price) : l.unit_price) || 0;
  const amount = l.accepted_cost != null ? Number(l.accepted_cost)
    : l.line_total != null ? Number(l.line_total)
    : qty * rate - (Number(l.discount) || 0) + (Number(l.tax) || 0);
  return { qty, unit, rate, amount };
}

