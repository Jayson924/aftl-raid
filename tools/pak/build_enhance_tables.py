"""Build src/data/enhance-tables.js (enhancement rates, gold and materials per gear slot) from an unpacked client.

Usage: py -3.12 -I tools/pak/build_enhance_tables.py <extraction root> [out.js]
The extraction is untrusted data, so run with -I and pass the path as an argument.
"""
from __future__ import annotations

import collections
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_gear_tables import (  # noqa: E402
    LEVELS, MAX_ENHANCE, item_name, kind_info, load_uistrings, locate, parse_dnt,
)

# Unique and legend share one curve per slot; lower ranks are not enhanced to +15.
RANKS = (4, 5)
SLOT_LABELS = {
    "mainWeapon": "Main Weapon", "subWeapon": "Secondary Weapon",
    "helmet": "Helmet", "top": "Top", "bottom": "Bottom", "gloves": "Gloves", "boots": "Boots",
    "earring": "Earring", "necklace": "Necklace", "ring": "Ring",
}


def step(r: dict, diamond_id: int) -> dict:
    """One attempt at +N. gold is in copper (10000 = 1g); break is the share of failures."""
    counts = {r[f"_NeedItemID{k}"]: r[f"_NeedItemCount{k}"] for k in range(1, 6) if r[f"_NeedItemID{k}"]}
    return {
        "success": round(r["_EnchantRatio"] * 100, 2),
        "break": round(r["_BreakRatio"] * 100, 2),
        "minDown": r["_MinDown"],
        "maxDown": r["_MaxDown"],
        "copper": r["_NeedCoin"],
        "essence": sum(n for i, n in counts.items() if i != diamond_id),
        "diamond": counts.get(diamond_id, 0),
        "jelly": r["_ProtectItemCount"],
    }


def main() -> None:
    root = Path(sys.argv[1])
    default_out = Path(__file__).resolve().parents[2] / "src" / "data" / "enhance-tables.js"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else default_out

    ui = load_uistrings(root)
    items = parse_dnt(locate(root, "itemtable_equipment.dnt"))
    names_by_id = {}
    for table in ("itemtable.dnt", "itemtable_enchant.dnt"):
        for r in parse_dnt(locate(root, table)):
            names_by_id[r["RowId"]] = item_name(ui, r)
    enchants: dict[int, dict[int, dict]] = collections.defaultdict(dict)
    for r in parse_dnt(locate(root, "enchanttable.dnt")):
        enchants[r["_EnchantID"]][r["_EnchantLevel"]] = r

    # Only current-cap rows carry the kind code, so older rows borrow it by noun (as in build_gear_tables).
    def noun_of(r: dict) -> str:
        params = re.findall(r"\{(\d+)\}", r.get("_NameIDParam") or "")
        return ui.get(int(params[-1]), "") if params else item_name(ui, r)

    candidates = [r for r in items if r["_LevelLimit"] in LEVELS and r["_Rank"] in RANKS and r["_NeedJobClass"] != "8"]
    noun_to_code: dict[str, int] = {}
    for r in candidates:
        code = r["_TypeParam2"] & 0xFF
        if kind_info(code):
            noun_to_code.setdefault(noun_of(r), code)

    curves: list[list[dict]] = []
    curve_index: dict[str, int] = {}
    per_slot: dict[tuple[int, str], collections.Counter] = collections.defaultdict(collections.Counter)
    diamonds: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in candidates:
        code = r["_TypeParam2"] & 0xFF
        info = kind_info(code) or kind_info(noun_to_code.get(noun_of(r), 0))
        levels = enchants.get(r["_EnchantID"], {})
        if not info or len(levels) < MAX_ENHANCE:
            continue
        # The diamond is the second material from +7 on; the first is always the essence.
        diamond_id = levels[MAX_ENHANCE].get("_NeedItemID2", 0)
        curve = [step(levels[n], diamond_id) for n in range(1, MAX_ENHANCE + 1)]
        key = json.dumps(curve, sort_keys=True)
        if key not in curve_index:
            curve_index[key] = len(curves)
            curves.append(curve)
        per_slot[(r["_LevelLimit"], info[0])][curve_index[key]] += 1
        if diamond_id:
            diamonds[r["_LevelLimit"]][diamond_id] += 1

    slots: dict[str, dict] = {}
    used: dict[int, int] = {}
    variants = []
    # Equipment-window order: weapons, then head to feet.
    order = list(SLOT_LABELS)
    for (level, slot), counter in sorted(per_slot.items(), key=lambda kv: (kv[0][0], order.index(kv[0][1]))):
        idx, n = counter.most_common(1)[0]
        used.setdefault(idx, len(used))
        slots[f"{level}:{slot}"] = {"label": SLOT_LABELS.get(slot, slot), "curve": used[idx]}
        if len(counter) > 1:
            variants.append((level, slot, n, sum(counter.values())))

    out = {
        "meta": {
            "source": root.name,
            "generated": date.today().isoformat(),
            "levels": list(LEVELS),
            "maxEnhance": MAX_ENHANCE,
            "note": "Slots keyed level:slot. curve[N-1] is the attempt at +N; copper / 10000 = gold; break is % of failures.",
        },
        "diamonds": {str(lv): names_by_id.get(c.most_common(1)[0][0], "Diamond") for lv, c in sorted(diamonds.items())},
        "slots": slots,
        "curves": [curves[i] for i, _ in sorted(used.items(), key=lambda kv: kv[1])],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "// Generated by tools/pak/build_enhance_tables.py - do not edit by hand." + chr(10)
        + "// Enhancement success, break, level drops, gold and materials per gear slot, from the game client." + chr(10)
    )
    out_path.write_text(header + "export default " + json.dumps(out, separators=(",", ":")) + ";" + chr(10), encoding="utf-8")
    print(f"wrote {out_path} ({out_path.stat().st_size // 1024} KB): {len(slots)} slots, {len(out['curves'])} curves")
    for v in variants:
        print("   slot with several curves (most common used):", v)


if __name__ == "__main__":
    main()
