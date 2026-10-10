"""Build src/data/gear-tables.js (per level/kind/rarity stats and enhancement curves) from an unpacked client.

Usage: py -3.12 -I tools/pak/build_gear_tables.py <extraction root> [out.js]
The extraction is untrusted data, so run with -I and pass the path as an argument.
"""
from __future__ import annotations

import collections
import json
import re
import statistics
import struct
import sys
from datetime import date
from pathlib import Path

LEVELS = (50, 60, 70)
RANKS = {2: "rare", 3: "epic", 4: "unique", 5: "legend"}
MAX_ENHANCE = 15

# Client state enum ids that matter for a power estimate.
STAT_NAMES = {
    0: "str", 1: "agi", 2: "int", 3: "vit",
    4: "patkMin", 5: "patkMax", 6: "matkMin", 7: "matkMax",
    12: "crit", 29: "fd",
    16: "fireAtk", 17: "iceAtk", 18: "lightAtk", 19: "darkAtk",
    79: "critDmg",
}

# Kind code = low byte of itemtable _TypeParam2. Armor codes run helmet, top, bottom,
# gloves, boots per base class; the sub weapon is the weapon kind without a crit stat.
ARMOR_RUNS = {  # first code of the run -> base job id
    0x15: 1, 0x1A: 2, 0x1F: 3, 0x24: 4, 0x29: 5, 0x53: 6, 0x80: 7,
}
ARMOR_SLOTS = ["helmet", "top", "bottom", "gloves", "boots"]
WEAPON_KINDS = {  # code -> (base job id, slot)
    0x01: (1, "mainWeapon"), 0x02: (1, "mainWeapon"), 0x03: (1, "mainWeapon"), 0x0F: (1, "subWeapon"),
    0x04: (2, "mainWeapon"), 0x05: (2, "mainWeapon"), 0x06: (2, "mainWeapon"), 0x10: (2, "subWeapon"),
    0x0A: (3, "mainWeapon"), 0x0B: (3, "mainWeapon"), 0x0C: (3, "mainWeapon"), 0x12: (3, "subWeapon"),
    0x07: (4, "mainWeapon"), 0x08: (4, "mainWeapon"), 0x09: (4, "mainWeapon"), 0x11: (4, "subWeapon"),
    0x0D: (5, "mainWeapon"), 0x0E: (5, "mainWeapon"), 0x13: (5, "subWeapon"),
    0x50: (6, "mainWeapon"), 0x51: (6, "mainWeapon"), 0x52: (6, "subWeapon"),
    0x7D: (7, "mainWeapon"), 0x7E: (7, "mainWeapon"), 0x7F: (7, "subWeapon"),
}
ACCESSORY_KINDS = {0x2E: "earring", 0x2F: "necklace", 0x14: "ring"}
BASE_JOBS = {1: "Warrior", 2: "Archer", 3: "Sorceress", 4: "Cleric", 5: "Academic", 6: "Kali", 7: "Assassin"}

# Mirrors CLASS_FAMILIES in src/constants.js.
CLASS_BASE_JOB = {
    "Gladiator": 1, "Moon Lord": 1, "Barbarian": 1, "Destroyer": 1, "Dark Avenger": 1,
    "Sniper": 2, "Artillery": 2, "Tempest": 2, "Wind Walker": 2,
    "Saleana": 3, "Elestra": 3, "Smasher": 3, "Majesty": 3,
    "Guardian": 4, "Crusader": 4, "Saint": 4, "Inquisitor": 4,
    "Shooting Star": 5, "Gear Master": 5, "Adept": 5, "Physician": 5,
    "Dark Summoner": 6, "Soul Eater": 6, "Blade Dancer": 6, "Spirit Dancer": 6,
    "Ripper": 7, "Raven": 7, "Light Fury": 7, "Abyss Walker": 7,
}


def parse_dnt(path: Path) -> list[dict]:
    data = path.read_bytes()
    off = 4
    col_count = struct.unpack_from("<H", data, off)[0]
    off += 2
    row_count = struct.unpack_from("<I", data, off)[0]
    off += 4
    fields = []
    for _ in range(col_count):
        n = struct.unpack_from("<H", data, off)[0]
        off += 2
        fields.append((data[off:off + n].decode("ascii"), data[off + n]))
        off += n + 1
    rows = []
    for _ in range(row_count):
        row = {"RowId": struct.unpack_from("<I", data, off)[0]}
        off += 4
        for name, t in fields:
            if t == 1:
                n = struct.unpack_from("<H", data, off)[0]
                off += 2
                row[name] = data[off:off + n].decode("utf-8", "replace")
                off += n
            elif t in (2, 3):
                row[name] = struct.unpack_from("<i", data, off)[0]
                off += 4
            elif t in (4, 5):
                row[name] = struct.unpack_from("<f", data, off)[0]
                off += 4
            elif t == 6:
                row[name] = struct.unpack_from("<Q", data, off)[0]
                off += 8
            else:
                raise SystemExit(f"unknown DNT field type {t} in {path.name}")
        rows.append(row)
    return rows


def locate(root: Path, name: str) -> Path:
    found = [p for p in root.rglob(name) if p.stat().st_size]
    if not found:
        raise SystemExit(f"{name} not found under {root}")
    return max(found, key=lambda p: (p.stat().st_size, str(p)))


MSG = re.compile(r'<message mid="(\d+)"><!\[CDATA\[(.*?)\]\]></message>', re.S)


def load_uistrings(root: Path) -> dict[int, str]:
    path = locate(root, "uistring.xml")
    return {int(m): t for m, t in MSG.findall(path.read_text(encoding="utf-8", errors="replace"))}


def item_name(ui: dict[int, str], row: dict) -> str:
    tmpl = ui.get(row["_NameID"], f"<{row['_NameID']}>")
    for i, pid in enumerate(re.findall(r"\{(\d+)\}", row.get("_NameIDParam") or "")):
        tmpl = tmpl.replace("{%d}" % i, ui.get(int(pid), f"<{pid}>"))
    return re.sub(r"\s+", " ", tmpl).strip()


def stat_dict(pairs) -> dict[str, float]:
    out: dict[str, float] = {}
    for sid, val in pairs:
        name = STAT_NAMES.get(sid)
        if name is None:
            continue
        try:
            v = float(val)
        except (TypeError, ValueError):
            continue
        if v:
            out[name] = round(out.get(name, 0) + v, 2)
    return out


def item_base(row: dict) -> dict[str, float]:
    return stat_dict((row[f"_State{i}"], row[f"_State{i}_Min"]) for i in range(1, 11) if row[f"_State{i}"] >= 0)


def enchant_curve(levels: dict[int, dict]) -> list[dict[str, float]]:
    curve = []
    for lvl in range(1, MAX_ENHANCE + 1):
        r = levels.get(lvl)
        if r is None:
            break
        curve.append(stat_dict((r[f"_State{i}"], r[f"_State{i}Value"]) for i in range(1, 11) if r[f"_State{i}"] >= 0))
    return curve


def mean_stats(rows: list[dict[str, float]]) -> dict[str, float]:
    if not rows:
        return {}
    keys = {k for r in rows for k in r}
    return {k: round(statistics.fmean(r.get(k, 0) for r in rows), 2) for k in sorted(keys)}


def potential_stats(rows: list[dict]) -> tuple[dict[str, float], dict[str, float], int]:
    """Return (innate stats, mean rolled-suffix delta, suffix option count).

    No-prefix ratio-1.0 rows are innate (averaged when several); prefix rows are the random suffix.
    """
    def stats(r):
        return stat_dict((r[f"_State{i}"], r[f"_State{i}Value"]) for i in range(1, 17) if r[f"_State{i}"] >= 0)

    innate_rows = [s for s in (stats(r) for r in rows if not r["_PrefixNameID"] and r["_PotentialRatio"] >= 1.0) if s]
    innate = mean_stats(innate_rows)
    suffix_rows = []
    for r in rows:
        if not r["_PrefixNameID"]:
            continue
        s = stats(r)
        delta = {k: round(v - innate.get(k, 0), 2) for k, v in s.items() if abs(v - innate.get(k, 0)) > 1e-6}
        if delta:
            suffix_rows.append(delta)
    return innate, mean_stats(suffix_rows), len(suffix_rows)


def kind_info(code: int):
    if code in WEAPON_KINDS:
        job, slot = WEAPON_KINDS[code]
        return slot, job, "weapon"
    if code in ACCESSORY_KINDS:
        return ACCESSORY_KINDS[code], None, "accessory"
    for start, job in ARMOR_RUNS.items():
        if start <= code < start + 5:
            return ARMOR_SLOTS[code - start], job, "armor"
    return None


def main() -> None:
    root = Path(sys.argv[1])
    default_out = Path(__file__).resolve().parents[2] / "src" / "data" / "gear-tables.js"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else default_out

    ui = load_uistrings(root)
    items = parse_dnt(locate(root, "itemtable_equipment.dnt"))
    enchants: dict[int, dict[int, dict]] = collections.defaultdict(dict)
    for r in parse_dnt(locate(root, "enchanttable.dnt")):
        enchants[r["_EnchantID"]][r["_EnchantLevel"]] = r
    potentials: dict[int, list[dict]] = collections.defaultdict(list)
    for r in parse_dnt(locate(root, "potentialtable.dnt")):
        potentials[r["_PotentialID"]].append(r)

    def noun_of(r: dict) -> str:
        params = re.findall(r"\{(\d+)\}", r.get("_NameIDParam") or "")
        return ui.get(int(params[-1]), "") if params else item_name(ui, r)

    # Only current-cap rows carry the kind code; older rows are classified by their base noun.
    kinds: dict[int, dict] = {}
    noun_to_code: dict[str, int] = {}
    # Lancea (job 8) is not in the app and her "Gloves" collide with the warrior noun.
    candidates = [r for r in items if r["_LevelLimit"] in LEVELS and r["_Rank"] in RANKS and r["_NeedJobClass"] != "8"]
    for r in candidates:
        code = r["_TypeParam2"] & 0xFF
        info = kind_info(code)
        if info is None:
            continue
        slot, job, group = info
        noun = noun_of(r)
        kinds.setdefault(code, {"noun": noun, "slot": slot, "job": job, "group": group})
        noun_to_code.setdefault(noun, code)

    groups: dict[tuple[int, int, int], list[dict]] = collections.defaultdict(list)
    for r in candidates:
        code = r["_TypeParam2"] & 0xFF
        if kind_info(code) is None:
            code = noun_to_code.get(noun_of(r), 0)
            if not code:
                continue
        groups[(r["_LevelLimit"], code, r["_Rank"])].append(r)

    curves: list[list[dict]] = []
    curve_index: dict[str, int] = {}
    entries: dict[str, dict] = {}
    ambiguous = []
    for (level, code, rank), rows in sorted(groups.items()):
        bases = collections.Counter(json.dumps(item_base(r), sort_keys=True) for r in rows)
        base_json, base_count = bases.most_common(1)[0]
        curve_counter: collections.Counter = collections.Counter()
        for r in rows:
            c = enchant_curve(enchants.get(r["_EnchantID"], {}))
            if c:
                curve_counter[json.dumps(c, sort_keys=True)] += 1
        curve_ref = None
        if curve_counter:
            curve_json, _ = curve_counter.most_common(1)[0]
            if curve_json not in curve_index:
                curve_index[curve_json] = len(curves)
                curves.append(json.loads(curve_json))
            curve_ref = curve_index[curve_json]
        pot_counter = collections.Counter(r["_TypeParam1"] for r in rows if r["_TypeParam1"] in potentials)
        innate, suffix, suffix_n = {}, {}, 0
        if pot_counter:
            pot_id, _ = pot_counter.most_common(1)[0]
            innate, suffix, suffix_n = potential_stats(potentials[pot_id])
        names = sorted({item_name(ui, r) for r in rows})
        entries[f"{level}:{code}:{RANKS[rank]}"] = {
            "base": json.loads(base_json),
            "curve": curve_ref,
            "innate": innate,
            "suffix": suffix,
            "suffixOptions": suffix_n,
            "items": len(rows),
            "baseVariants": len(bases),
            "curveVariants": len(curve_counter),
            "names": names[:6],
        }
        if len(bases) > 1 and base_count < len(rows) * 0.6:
            ambiguous.append((level, kinds[code]["noun"], RANKS[rank], len(bases), len(rows)))

    out = {
        "meta": {
            "source": root.name,
            "generated": date.today().isoformat(),
            "levels": list(LEVELS),
            "ranks": list(RANKS.values()),
            "maxEnhance": MAX_ENHANCE,
            "note": "Entries keyed level:kindCode:rarity. Curve values are cumulative totals at +N (index N-1).",
        },
        "baseJobs": BASE_JOBS,
        "classBaseJob": CLASS_BASE_JOB,
        "kinds": {str(code): v for code, v in sorted(kinds.items())},
        "curves": curves,
        "entries": entries,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(out, separators=(",", ":"))
    header = (
        "// Generated by tools/pak/build_gear_tables.py - do not edit by hand." + chr(10)
        + "// Per (level, kind, rarity) equipment stats derived from the game client tables." + chr(10)
    )
    out_path.write_text(header + "export default " + body + ";" + chr(10), encoding="utf-8")
    print(f"wrote {out_path} ({out_path.stat().st_size // 1024} KB): {len(entries)} entries, {len(curves)} curves, {len(kinds)} kinds")
    if ambiguous:
        print("groups where the chosen base covers <60% of items (most common variant used):")
        for a in ambiguous:
            print("   ", a)


if __name__ == "__main__":
    main()
