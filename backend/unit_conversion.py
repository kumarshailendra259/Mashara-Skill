"""Centralized Unit Conversion Engine (single source of truth).

Converts any entered (quantity, unit) into an item's base unit so that stock,
consumption, wastage and financial amounts are always computed on compatible
units. The frontend mirror lives at frontend/src/lib/units.js — keep both in
sync. The BACKEND is always the final authority.

Rules
-----
* Weight / Volume / Count units convert via a fixed global table (dimension
  aware): e.g. 500 gram -> 0.5 kg regardless of item config.
* Packaging units (bag/box/packet/...) are item specific and convert to the
  item's base unit via the item's `conversion_factor` (1 purchase_unit =
  conversion_factor base units).
"""

WEIGHT = "weight"
VOLUME = "volume"
COUNT = "count"
PACK = "pack"

# unit -> (dimension, factor to the dimension's canonical base unit)
#   weight canonical = kg | volume canonical = litre | count canonical = piece
GLOBAL_UNITS = {
    # weight
    "kg": (WEIGHT, 1.0),
    "gram": (WEIGHT, 0.001),
    "g": (WEIGHT, 0.001),
    "mg": (WEIGHT, 0.000001),
    "quintal": (WEIGHT, 100.0),
    "ton": (WEIGHT, 1000.0),
    # volume
    "litre": (VOLUME, 1.0),
    "liter": (VOLUME, 1.0),
    "l": (VOLUME, 1.0),
    "ml": (VOLUME, 0.001),
    # count
    "piece": (COUNT, 1.0),
    "pcs": (COUNT, 1.0),
    "dozen": (COUNT, 12.0),
    "pair": (COUNT, 2.0),
}

# Packaging units carry item-specific weights/counts, so their base factor comes
# from the Item Master `conversion_factor`, never from a global table.
PACKAGING_UNITS = {"packet", "bag", "box", "carton", "bottle", "sack", "bundle", "cylinder"}

# Aliases normalised to the canonical spelling used across the app.
_ALIASES = {"g": "gram", "liter": "litre", "l": "litre", "pcs": "piece"}


class UnitError(ValueError):
    """Raised when a unit cannot be converted to an item's base unit."""


def _norm(unit):
    u = (unit or "").strip().lower()
    return _ALIASES.get(u, u)


def dimension_of(unit):
    u = _norm(unit)
    if u in GLOBAL_UNITS:
        return GLOBAL_UNITS[u][0]
    if u in PACKAGING_UNITS:
        return PACK
    return None


def to_base_factor(item: dict, unit: str) -> float:
    """Factor to convert `unit` -> item.base_unit. Raises UnitError if incompatible."""
    base = _norm(item.get("base_unit"))
    purch = _norm(item.get("purchase_unit"))
    u = _norm(unit)
    conv = float(item.get("conversion_factor") or 1) or 1.0
    if not u:
        raise UnitError(f"No unit given for item '{item.get('name')}'")
    if u == base:
        return 1.0
    # Packaging / purchase unit -> base via the item's own conversion factor.
    if u == purch:
        return conv
    # Same physical dimension (weight/volume/count) -> use the global ratio.
    du, dbase = dimension_of(u), dimension_of(base)
    if du and dbase and du == dbase and du in (WEIGHT, VOLUME, COUNT):
        return GLOBAL_UNITS[u][1] / GLOBAL_UNITS[base][1]
    raise UnitError(
        f"Unit '{unit}' is not compatible with item '{item.get('name')}' (base unit: {item.get('base_unit')})"
    )


def to_base_qty(item: dict, qty, unit: str) -> float:
    """Convert an entered qty+unit into the item's base unit."""
    return float(qty) * to_base_factor(item, unit)


def is_compatible(item: dict, unit: str) -> bool:
    try:
        to_base_factor(item, unit)
        return True
    except UnitError:
        return False


def compatible_units(item: dict):
    """All units a user may legitimately enter for this item."""
    base = _norm(item.get("base_unit"))
    purch = _norm(item.get("purchase_unit"))
    dbase = dimension_of(base)
    out = []
    if dbase in (WEIGHT, VOLUME, COUNT):
        for u, (d, _f) in GLOBAL_UNITS.items():
            if d == dbase and u not in _ALIASES and u not in out:
                out.append(u)
    for u in (base, purch):
        if u and u not in out:
            out.append(u)
    return out
