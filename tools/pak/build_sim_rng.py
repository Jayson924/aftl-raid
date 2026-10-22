"""Roll tables for the simulator's RNG Table: costume engravings and gear potentials, with their odds.
Usage: py -3.12 -I tools/pak/build_sim_rng.py <extraction root>
Engravings: itemtable_imprintequip + chaoscuberesulttable_imprintequip; potentials: potentialtable_potentialjewel per item."""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_gear_tables import item_name, load_uistrings, locate, parse_dnt  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "src/data/sim-rng.json"
POTENTIALS = REPO / "netlify/data/sim/potentials.json"

GRADES = {1: "B", 2: "A", 3: "S", 4: "L"}
SLOTS = {1: "Main weapon", 2: "Secondary weapon", 3: "Helmet", 4: "Upper", 5: "Lower", 6: "Gloves", 7: "Shoes",
         8: "Ring", 9: "Necklace", 10: "Earring", 11: "Wings", 12: "Tail", 13: "Decal"}
SCROLLS = {1: "Weapon", 2: "Armor", 3: "Accessory", 4: "Wings, tail, decal"}
# Cube recipes 2001-2004 roll an engraving without Dragon Scripture; 1001-1004 use it, with the same weights.
RECIPES = (2001, 2002, 2003, 2004)
STATS = {0: "STR", 1: "AGI", 2: "INT", 3: "VIT", 8: "DEF", 9: "MDEF", 10: "Paralyze", 11: "Paralyze resist", 12: "Crit",
         13: "Crit resist", 14: "Stun", 15: "Stun resist", 16: "Fire attack %", 17: "Water attack %", 18: "Light attack %",
         19: "Dark attack %", 20: "Fire resist %", 21: "Water resist %", 22: "Light resist %", 23: "Dark resist %",
         25: "HP", 26: "MP", 27: "MP regen", 29: "Final damage", 50: "STR %", 51: "AGI %", 52: "INT %", 53: "VIT %",
         54: "PATK %", 56: "MATK %", 58: "DEF %", 59: "MDEF %", 60: "Paralyze %", 61: "Paralyze resist %", 62: "Crit %",
         63: "Crit resist %", 64: "Stun %", 65: "Stun resist %", 75: "HP %", 76: "MP %", 77: "MP regen %", 79: "Final damage %",
         101: "PATK %", 102: "MATK %"}
PERCENT = lambda s: 16 <= s <= 23 or s >= 50  # noqa: E731
# Engraving extras in the game's selector order (charmitemtable options 1-26 low, 27-52 high); these roll double.
EXTRAS = (50, 51, 52, 53, 101, 102, 58, 59, 60, 61, 62, 63, 64, 65, 75, 76, 77, 79, 16, 17, 18, 19, 20, 21, 22, 23)
DOUBLED = {60, 61, 62, 63, 64, 65, 75, 76, 77, 79}
EXTRA_ROLLS = {"B": (0.1, 0.15), "A": (0.2, 0.3), "S": (0.4, 0.6), "L": (0.7, 1.0)}
RANKS = {2: "rare", 3: "epic", 4: "unique", 5: "legend"}
JEWELRY = {"Ring", "Necklace", "Earrings"}


def engravings(root: Path) -> dict:
    templates = {r["RowId"]: r for r in parse_dnt(locate(root, "itemtable_imprintequip.dnt"))}
    cube = defaultdict(list)
    for r in parse_dnt(locate(root, "chaoscuberesulttable_imprintequip.dnt")):
        cube[r["_Chaosmatchingnum"]].append(r)
    grade_weight, scrolls, values = defaultdict(int), [], defaultdict(lambda: defaultdict(set))
    for recipe in RECIPES:
        rows, total = cube[recipe], sum(r["_Prob"] for r in cube[recipe])
        slot_weight = defaultdict(int)
        for r in rows:
            t = templates[r["_ItemID"]]
            grade, slot = GRADES[t["_TypeParam1"] % 1000], SLOTS[t["_TypeParam2"]]
            grade_weight[grade] += r["_Prob"]
            slot_weight[slot] += r["_Prob"]
            states = [(t[f"_State{i}"], round(float(t[f"_State{i}_Min"]) * 100, 4)) for i in range(1, 11)
                      if t[f"_State{i}"] is not None and t[f"_State{i}"] >= 0 and t[f"_State{i}_Min"]]
            main = states[0][1]
            secondary = next((v for _, v in states if v != main), None)
            values[SCROLLS[recipe % 1000]][grade].add((main, secondary))
        scrolls.append({"scroll": SCROLLS[recipe % 1000],
                        "slots": [{"slot": s, "pct": round(100 * w / total, 2)} for s, w in slot_weight.items()]})
    all_weight = sum(grade_weight.values())
    return {
        "grade_pct": {g: round(100 * grade_weight[g] / all_weight, 2) for g in ("B", "A", "S", "L")},
        "scrolls": scrolls,
        "main": {kind: {g: [{"value": m, "secondary": s} for m, s in sorted(v)] for g, v in by_grade.items()}
                 for kind, by_grade in values.items()},
        "extras": [{"stat": STATS[s], "values": {g: [round(lo * (2 if s in DOUBLED else 1), 3), round(hi * (2 if s in DOUBLED else 1), 3)]
                                                 for g, (lo, hi) in EXTRA_ROLLS.items()}} for s in EXTRAS],
    }


def roll_lines(row: dict) -> list:
    seen, lines = set(), []
    for i in range(1, 17):
        state, value = row.get(f"_State{i}"), float(row.get(f"_State{i}Value") or 0)
        # Max attack (55, 57) repeats min attack, shown once as PATK/MATK %.
        if state in (None, -1, 55, 57) or not value or state in seen:
            continue
        seen.add(state)
        lines.append([STATS.get(state, str(state)), round(value * 100, 4) if PERCENT(state) else value])
    return lines


def enchant_keys() -> dict:
    """(stat, value) -> the simulator's potential name, e.g. ("PATK %", 2.875) -> "PATK 2.88%"."""
    keys = {}
    for name in json.loads(POTENTIALS.read_text(encoding="utf-8")):
        m = re.match(r"^(.*\S)\s+(-?\d+(?:\.\d+)?)%$", name)
        keys[(f"{m[1]} %", round(float(m[2]), 2))] = name
    return keys


def potentials(root: Path, ui: dict) -> list:
    keys, missing = enchant_keys(), set()
    pools = defaultdict(list)
    for r in parse_dnt(locate(root, "potentialtable_potentialjewel.dnt")):
        pools[r["_PotentialID"]].append(r)
    used = defaultdict(lambda: {"nouns": set(), "ranks": set(), "weapon": False})
    for r in parse_dnt(locate(root, "itemtable_equipment.dnt")):
        if r["_LevelLimit"] not in (50, 60, 70) or r["_Rank"] not in RANKS or r["_TypeParam2"] not in pools:
            continue
        name = item_name(ui, r)
        if "GSP NOT USED" in name or "{" in name or "(Event)" in name:
            continue
        u = used[r["_TypeParam2"]]
        u["nouns"].add(name.split()[-1].capitalize())
        u["ranks"].add(RANKS[r["_Rank"]])
        u["weapon"] |= r["_Type"] == 0
    out, seen = [], {}
    for pid, u in used.items():
        rolls = sorted(({"lines": roll_lines(r), "pct": round(r["_PotentialRatio"], 3)} for r in pools[pid]), key=lambda x: -x["pct"])
        for roll in rolls:
            roll["keys"] = [keys.get((s, round(v + 1e-9, 2))) for s, v in roll["lines"]]
            missing |= {f"{s} {v}" for (s, v), k in zip(roll["lines"], roll["keys"]) if k is None}
        key = json.dumps([sorted(u["ranks"]), rolls])
        nouns = sorted(u["nouns"])
        kind = "Weapon" if u["weapon"] else "Jewelry" if set(nouns) <= JEWELRY else "Armor"
        if key in seen:
            seen[key]["items"] = sorted(set(seen[key]["items"]) | set(nouns))
            continue
        seen[key] = {"rarity": sorted(u["ranks"], key=list(RANKS.values()).index), "kind": kind, "items": nouns, "rolls": rolls}
        out.append(seen[key])
    if missing:
        print("lines with no simulator potential:", sorted(missing))
    order = {"legend": 0, "unique": 1, "epic": 2, "rare": 3}
    return sorted(out, key=lambda p: (order[p["rarity"][-1]], ["Weapon", "Armor", "Jewelry"].index(p["kind"]), p["items"]))


def main(root: Path) -> None:
    ui = load_uistrings(root)
    data = {"engraving": engravings(root), "potentials": potentials(root, ui)}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): {len(data['potentials'])} potential pools")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
