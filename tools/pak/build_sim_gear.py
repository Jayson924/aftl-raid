"""Add Lv60/70 epic and unique client gear the simulator tables lack.
Usage: py -3.12 -I tools/pak/build_sim_gear.py <extraction root>; then build_sim_icons.py and npm run sim:options."""
from __future__ import annotations

import collections
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_gear_tables import load_uistrings, locate, parse_dnt, item_name  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SIM = REPO / "netlify/data/sim"
OUT = REPO / "netlify/data/sim/gear-client.json"

# What the user asked for: Lv60 epics from these sets, every Lv70 epic, Lv60/70 uniques.
LV60_EPIC_SETS = ("Dangerous Desire's", "Twisted Obsession's", "Honourable Tribe's", "Great Ancestor's",
                  "Bloody Fighter's", "Golden Feather", "Royal Crest", "Wings of Freedom")
RANK_LABEL = {3: "Epic", 4: "Unique"}

STAT = {0: "STR", 1: "AGI", 2: "INT", 3: "VIT", 4: "PATK min", 5: "PATK max", 6: "MATK min", 7: "MATK max",
        8: "DEF", 9: "MDEF", 10: "Paralyze", 11: "Paralyze resist", 12: "Crit", 13: "Crit resist", 14: "Stun",
        15: "Stun resist", 25: "HP", 26: "MP", 27: "MP regen", 29: "Final damage", 79: "Crit damage"}
# Stored as fractions in the client; the simulator uses percents.
PERCENT = {16: "Fire attack %", 17: "Water attack %", 18: "Light attack %", 19: "Dark attack %",
           20: "Fire resist %", 21: "Water resist %", 22: "Light resist %", 23: "Dark resist %",
           50: "STR %", 51: "AGI %", 52: "INT %", 53: "VIT %", 54: "PATK min %", 55: "PATK max %",
           56: "MATK min %", 57: "MATK max %", 58: "DEF %", 59: "MDEF %", 62: "Crit %", 74: "Move speed %",
           75: "HP %", 76: "MP %", 77: "Final damage %"}

# Kind = low byte of _TypeParam2; epic rows often leave it 0, so take it from a row with the same noun.
ARMOR_RUNS = (0x15, 0x1A, 0x1F, 0x24, 0x29, 0x53, 0x80)
ARMOR_SLOTS = ("Helmet", "Upper", "Lower", "Gloves", "Shoes")
SUB_WEAPONS = {0x0F, 0x10, 0x11, 0x12, 0x13, 0x52, 0x7F}
MAIN_WEAPONS = set(range(0x01, 0x0F)) | {0x50, 0x51, 0x7D, 0x7E}
ACCESSORIES = {0x2F: "Necklace", 0x2E: "Earring", 0x14: "Ring"}

# Client job ids -> the simulator's job keys (first jobs and base classes).
JOB_KEY = {1: "Warrior", 2: "Archer", 3: "Sorceress", 4: "Cleric", 5: "Academic", 6: "Kali", 7: "Assassin",
           11: "Swordmaster", 12: "Mercenary", 75: "Avenger", 14: "Bowmaster", 15: "Acrobat", 16: "Hunter",
           17: "Elemental Lord", 18: "Force User", 20: "Paladin", 22: "Priest", 46: "Engineer", 49: "Alchemist",
           54: "Screamer", 57: "Dancer", 62: "Chaser", 67: "Bringer"}


def slot_of(code: int) -> str | None:
    for start in ARMOR_RUNS:
        if start <= code < start + 5:
            return ARMOR_SLOTS[code - start]
    if code in SUB_WEAPONS:
        return "Secondary weapon"
    if code in MAIN_WEAPONS:
        return "Main weapon"
    return None


def stats(row: dict, count: int, key: str, missing: collections.Counter) -> dict[str, float]:
    out: dict[str, float] = {}
    for i in range(1, count + 1):
        state = row.get(f"_State{i}")
        state = 0 if state is None and row.get(f"_State{i}{key}") not in (None, "", "0", 0) else state
        try:
            value = float(row.get(f"_State{i}{key}") or 0)
        except ValueError:
            continue
        if state is None or state < 0 or not value:
            continue
        if state in STAT:
            name, value = STAT[state], math.floor(value + 1e-9)
        elif state in PERCENT:
            name, value = PERCENT[state], round(value * 100, 2)
        else:
            missing[state] += 1
            continue
        if value:
            out[name] = out.get(name, 0) + value
    return out


def noun_of(ui: dict[int, str], row: dict) -> str:
    params = re.findall(r"\{(\d+)\}", row.get("_NameIDParam") or "")
    return ui.get(int(params[-1]), "") if params else item_name(ui, row)


def short(stat: str) -> str:
    return stat.replace(" %", "").replace("Water ", "Ice ")


def compact(stats: dict) -> dict:
    """Equal min/max pairs as one stat, and equal PATK/MATK as "ATK", for shorter labels."""
    out = dict(stats)
    for base in ("PATK", "MATK", "PATK %", "MATK %"):
        lo, hi = base.replace(" %", " min %") if "%" in base else f"{base} min", base.replace(" %", " max %") if "%" in base else f"{base} max"
        if lo in out and out.get(lo) == out.get(hi):
            out[base] = out.pop(lo)
            out.pop(hi)
    for p, m, both in (("PATK", "MATK", "ATK"), ("PATK %", "MATK %", "ATK %")):
        if p in out and out.get(p) == out.get(m):
            out[both] = out.pop(p)
            out.pop(m)
    return out


def roll_labels(rolls: list[dict]) -> list[str]:
    """Name each roll by what sets it apart; the label is the calculator's variant key."""
    if len(rolls) == 1:
        return ["Standard"]
    rolls = [compact(r) for r in rolls]
    shared = {k for k in rolls[0] if all(r.get(k) == rolls[0][k] for r in rolls)}
    by_name = [" · ".join(short(k) for k in r if k not in shared) for r in rolls]
    labels = by_name if len(set(by_name)) == len(by_name) else [
        " · ".join(f"{short(k)} {v:g}" for k, v in r.items() if k not in shared) for r in rolls]
    seen = collections.Counter()
    out = []
    for label in labels:
        seen[label] += 1
        out.append(label if seen[label] == 1 else f"{label} ({seen[label]})")
    return out


def wanted(name: str, level: int, rank: int) -> bool:
    if rank == 3 and level == 60:
        return name.startswith(LV60_EPIC_SETS)
    return (rank == 3 and level == 70) or (rank == 4 and level in (60, 70))


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    ui = load_uistrings(root)
    items = parse_dnt(locate(root, "itemtable_equipment.dnt"))
    enchant = collections.defaultdict(dict)
    for row in parse_dnt(locate(root, "enchanttable.dnt")):
        enchant[row["_EnchantID"]][row["_EnchantLevel"]] = row
    potentials = collections.defaultdict(list)
    for row in parse_dnt(locate(root, "potentialtable.dnt")):
        potentials[row["_PotentialID"]].append(row)
    set_of = {}
    for table in ("weapontable_equipment.dnt", "partstable_equipment.dnt", "partstable_common2014.dnt",
                  "partstable_common2024.dnt", "partstable_commonweapon2021.dnt"):
        try:
            path = locate(root, table)
        except SystemExit:
            continue
        for row in parse_dnt(path):
            if row.get("_SetItemID"):
                set_of[row["RowId"]] = row["_SetItemID"]
    set_rows = {row["RowId"]: row for row in parse_dnt(locate(root, "setitemtable.dnt"))}

    noun_code = {}
    for row in items:
        code = row["_TypeParam2"] & 0xFF
        if slot_of(code) or code in ACCESSORIES:
            noun_code.setdefault(noun_of(ui, row), code)

    existing = {name for job in json.loads((SIM / "equipment.json").read_text(encoding="utf-8")).values() for name in job}
    existing |= {name for slot in json.loads((SIM / "jewelry.json").read_text(encoding="utf-8"))["items"].values() for name in slot}
    jewelry: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    jewelry_sets: dict[str, dict[str, int]] = collections.defaultdict(dict)
    missing_stats = collections.Counter()
    equipment: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    set_members: dict[str, dict[str, int]] = collections.defaultdict(dict)
    used_sets: dict[int, list[str]] = collections.defaultdict(list)
    skipped = collections.Counter()
    for row in items:
        level, rank = row.get("_LevelLimit"), row.get("_Rank")
        if rank not in RANK_LABEL or level not in (60, 70):
            continue
        name = item_name(ui, row)
        # "{2}" marks a name the client fills in at runtime; those items have no fixed name.
        if not name or name[0].isdigit() or "<" in name or "{" in name or name in existing or not wanted(name, level, rank):
            continue
        code = row["_TypeParam2"] & 0xFF
        accessory = ACCESSORIES.get(code) or ACCESSORIES.get(noun_code.get(noun_of(ui, row), 0))
        if accessory:
            # Any class (job 0); the item rolls one of its fixed rows, so each row is a variant.
            job_ids = {int(j) for j in re.findall(r"\d+", str(row.get("_NeedJobClass") or ""))}
            rolls = [p for p in potentials.get(row.get("_TypeParam1"), []) if not p.get("_PrefixNameID") and p.get("_PotentialRatio")]
            if job_ids - {0} or name in jewelry[accessory]:
                skipped["accessory: class-only" if job_ids - {0} else "accessory: duplicate"] += 1
                continue
            base = stats(row, 10, "_Min", missing_stats)
            merged_rolls = []
            for roll in rolls or [{}]:
                merged = dict(base)
                for k, v in (stats(roll, 16, "Value", missing_stats) if roll else {}).items():
                    merged[k] = merged.get(k, 0) + v
                merged_rolls.append(merged)
            if not any(merged_rolls):
                skipped["accessory: no stats"] += 1
                continue
            variants = dict(zip(roll_labels(merged_rolls), merged_rolls))
            jewelry[accessory][name] = {"level": f"Lv{level} {RANK_LABEL[rank]}", "variants": variants}
            if set_of.get(row["RowId"]) in set_rows:
                jewelry_sets[accessory][name] = set_of[row["RowId"]]
                used_sets[set_of[row["RowId"]]].append(name)
            continue
        slot = slot_of(code) or slot_of(noun_code.get(noun_of(ui, row), 0))
        jobs = [JOB_KEY[int(j)] for j in re.findall(r"\d+", str(row.get("_NeedJobClass") or "")) if int(j) in JOB_KEY]
        if not slot or not jobs:
            skipped["no slot" if not slot else "no class"] += 1
            continue
        curve = enchant.get(row.get("_EnchantID"), {})
        suffix = {}
        for pot in potentials.get(row.get("_TypeParam1"), []):
            label = ui.get(pot.get("_PrefixNameID")) if pot.get("_PrefixNameID") else None
            if label and label not in suffix:
                suffix[label] = stats(pot, 16, "Value", missing_stats)
        entry = {
            "level": f"Lv{level} {RANK_LABEL[rank]}", "slot": slot,
            "base": stats(row, 10, "_Min", missing_stats),
            "enhance": {str(lv): stats(curve[lv], 10, "Value", missing_stats) for lv in sorted(curve) if 1 <= lv <= 15},
            "suffix": suffix,
        }
        set_id = set_of.get(row["RowId"])
        for job in jobs:
            if name in equipment[job]:
                skipped["duplicate"] += 1
                continue
            equipment[job][name] = entry
            if set_id in set_rows:
                set_members[job][name] = set_id
                used_sets[set_id].append(name)

    bonus, names = {}, {}
    for set_id, members in used_sets.items():
        row = set_rows[set_id]
        tiers: dict[str, dict] = collections.defaultdict(dict)
        for i in range(1, 21):
            pieces = row.get(f"_NeedSetNum{i}")
            if not pieces:
                continue
            for k, v in stats({"_State1": row.get(f"_State{i}"), "_State1Value": row.get(f"_State{i}Value")},
                              1, "Value", missing_stats).items():
                tiers[str(pieces)][k] = tiers[str(pieces)].get(k, 0) + v
        bonus[str(set_id)] = dict(tiers)
        # The client has no set names; the members' shared leading words name it.
        words = [m.split() for m in set(members)]
        common = []
        for group in zip(*words):
            if len(set(group)) != 1:
                break
            common.append(group[0])
        names[str(set_id)] = " ".join(common) or members[0]

    out = {"equipment": {job: dict(sorted(items.items())) for job, items in sorted(equipment.items())},
           "jewelry": {slot: dict(sorted(items.items())) for slot, items in sorted(jewelry.items())},
           "sets": {"bonus": bonus, "equipment": {job: dict(sorted(m.items())) for job, m in sorted(set_members.items())},
                    "jewelry": {slot: dict(sorted(m.items())) for slot, m in sorted(jewelry_sets.items())}, "names": names}}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    count = collections.Counter(e["level"] for job in equipment.values() for e in job.values())
    print(f"{sum(len(v) for v in equipment.values())} job/item entries, {len(bonus)} sets; {dict(count)}")
    acc = collections.Counter((slot, e["level"]) for slot, items in jewelry.items() for e in items.values())
    print(f"accessories: {dict(acc)}; {sum(len(m) for m in jewelry_sets.values())} in sets")
    print("skipped:", dict(skipped), "unmapped stat ids:", dict(missing_stats))


if __name__ == "__main__":
    main()
