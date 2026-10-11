"""Build the simulator's icon sprite, slot frames, icon map and costume list from an unpacked client.
Usage: py -3.12 -I tools/pak/build_sim_icons.py <extraction root> (needs Pillow)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from build_gear_tables import load_uistrings, locate, parse_dnt, item_name  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SIM = REPO / "netlify/data/sim"
SPRITE = REPO / "public/sim/item-icons.webp"
MAP = REPO / "src/data/sim-icons.json"
FRAMES_OUT = REPO / "public/sim/slot-frames.png"
COSTUMES_OUT = REPO / "src/data/sim-costumes.json"

# Octagonal equipment slot frames in uit_itemslotbutton.dds: rarity -> top-left of a 50px cell.
FRAMES = {"normal": (0, 266), "magic": (160, 210), "rare": (212, 210), "epic": (264, 314),
          "unique": (264, 262), "legend": (108, 210), "orange": (212, 262),
          # Card frames by grade C..L: Magic green, Rare blue, Epic orange, Unique purple, Legend red.
          "card-none": (264, 0), "card-c": (370, 416), "card-b": (108, 262), "card-a": (56, 262),
          "card-s": (160, 262), "card-l": (264, 156)}

ICON, PER_ROW, PER_SHEET = 50, 10, 200  # client sheets are 10x20 grids of 50px icons
SPRITE_COLS = 20
SKILL_ICON = 10_000_000  # added to an index that lives on the skillicon sheets, not itemicon
RANKS = {"Normal": 0, "Magic": 1, "Rare": 2, "Epic": 3, "Unique": 4, "Legend": 5}
BASE_JOB = {"Warrior": 1, "Archer": 2, "Sorceress": 3, "Cleric": 4, "Academic": 5, "Kali": 6, "Assassin": 7}


def parse_level(label: str) -> tuple[int, int] | None:
    parts = (label or "").split()
    if len(parts) == 2 and parts[0].startswith("Lv") and parts[1] in RANKS:
        return int(parts[0][2:]), RANKS[parts[1]]
    return None


def jobs_of(row: dict) -> set[int]:
    return {int(j) for j in str(row.get("_NeedJobClass") or "").replace(";", ",").split(",") if j.strip().isdigit()}


def pick(rows: list[dict], level: str, base_job: int | None) -> int | None:
    want = parse_level(level)
    if want:
        rows = [r for r in rows if (r.get("_LevelLimit"), r.get("_Rank")) == want] or rows
    if base_job and len({r["_IconImageIndex"] for r in rows}) > 1:
        rows = [r for r in rows if base_job in jobs_of(r)] or rows
    icons = {r["_IconImageIndex"] for r in rows}
    return min(icons) if icons else None


# Costumes are cash rows; each maps onto a costumes.json tier by its fixed stats.
COSTUME_TABLES = ["itemtable_cash.dnt", "itemtable_common2014.dnt", "itemtable_common2024.dnt",
                  "itemtable_commonweapon2021.dnt", "itemtable_event.dnt", "itemtable_gacha.dnt",
                  "itemtable_guild.dnt", "itemtable_commoncash.dnt"]
PARTS_TABLES = ["partstable_cash.dnt", "partstable_common2014.dnt", "partstable_common2024.dnt",
                "partstable__commonweapon2021.dnt", "partstable_event.dnt", "partstable_gacha.dnt",
                "partstable_guild.dnt", "partstable_commoncash.dnt"]
PARTS_SLOT = {5: "Necklace", 6: "Earring", 7: "Ring", 8: "Ring", 9: "Wings", 10: "Tail", 11: "Decal"}
EXCHANGE_SLOT = {16: "Main weapon", 17: "Secondary weapon", 23: "Necklace", 24: "Earring", 25: "Ring",
                 26: "Wings", 27: "Tail", 28: "Decal"}
STATE_ATTR = {0: "STR", 1: "AGI", 2: "INT", 3: "VIT", 4: "PATK min", 5: "PATK max", 6: "MATK min",
              7: "MATK max", 8: "DEF", 9: "MDEF", 25: "HP", 26: "MP", 27: "MP regen", 29: "Final damage"}
STATE_PERCENT = {54: "PATK %", 55: "PATK %", 56: "MATK %", 57: "MATK %", 58: "DEF %", 59: "MDEF %",
                 74: "Move speed %"}
BASE_JOB_NAME = {v: k for k, v in BASE_JOB.items()}


def costume_stats(row: dict) -> dict[str, float] | None:
    out: dict[str, float] = {}
    for i in range(1, 11):
        state, value = row.get(f"_State{i}", -1), row.get(f"_State{i}_Min")
        if state is None or state < 0 or value in (None, "", "0"):
            continue
        if state in STATE_ATTR:
            out[STATE_ATTR[state]] = round(float(value), 4)
        elif state in STATE_PERCENT:
            out[STATE_PERCENT[state]] = round(float(value) * 100, 4)
        else:
            return None  # a stat the tiers do not have
    return out


def costume_items(root: Path, ui: dict[int, str], tiers: dict[str, dict]) -> tuple[dict, dict[str, int]]:
    parts = {}
    for table in PARTS_TABLES:
        for row in parse_dnt(locate(root, table)):
            parts[row["RowId"]] = row.get("_Parts")
    floats = lambda stats: {k: round(float(v), 4) for k, v in stats.items()}  # noqa: E731
    profile = {slot: {json.dumps(floats(stats), sort_keys=True): tier for tier, stats in items.items()}
               for slot, items in tiers.items()}
    items: dict[str, dict[str, dict]] = {}
    icon_of: dict[str, int] = {}
    for table in COSTUME_TABLES:
        for row in parse_dnt(locate(root, table)):
            if row.get("_IsCash") != 1 or row.get("_Type") not in (0, 1) or not row.get("_IconImageIndex"):
                continue
            slot = PARTS_SLOT.get(parts.get(row["RowId"])) or EXCHANGE_SLOT.get(row.get("_ExchangeType"))
            name = item_name(ui, row)
            if not slot or not name or name[0].isdigit() or name.startswith("<") or "Day" in name or "GSP" in name:
                continue
            stats = costume_stats(row)
            tier = profile.get(slot, {}).get(json.dumps(stats, sort_keys=True)) if stats else None
            if not tier:
                continue
            entry = items.setdefault(slot, {}).setdefault(name, {"tier": tier, "jobs": set(), "rank": row.get("_Rank") or 0})
            entry["jobs"] |= {BASE_JOB_NAME[j] for j in jobs_of(row) if j in BASE_JOB_NAME}
            icon_of.setdefault(name, row["_IconImageIndex"])
    return items, icon_of


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    ui = load_uistrings(root)
    by_name: dict[str, list[dict]] = {}
    for table in ("itemtable_equipment.dnt", "itemtable.dnt", "itemtable_glyph.dnt", "itemtable_rune.dnt", "itemtable_card.dnt"):
        for row in parse_dnt(locate(root, table)):
            if row.get("_IconImageIndex"):
                by_name.setdefault(item_name(ui, row), []).append(row)

    job_map = json.loads((SIM / "job_map.json").read_text(encoding="utf-8"))
    first_to_base = {v["first_job"]: v["base_class"] for v in job_map.values()}
    equipment = json.loads((SIM / "equipment.json").read_text(encoding="utf-8"))
    jewelry = json.loads((SIM / "jewelry.json").read_text(encoding="utf-8"))["items"]
    extra = REPO / "netlify/data/sim/gear-client.json"  # build_sim_gear.py output, if built
    if extra.exists():
        client = json.loads(extra.read_text(encoding="utf-8"))
        for job, items in client["equipment"].items():
            equipment[job] = {**items, **equipment.get(job, {})}
        for slot, items in client.get("jewelry", {}).items():
            jewelry[slot] = {**items, **jewelry.get(slot, {})}

    wanted: dict[str, dict[str, int]] = {}
    missing = []
    for job, items in equipment.items():
        base = BASE_JOB.get(first_to_base.get(job, job))
        for name, item in items.items():
            idx = pick(by_name.get(name, []), item.get("level", ""), base)
            if idx is None:
                missing.append(f"{job}: {name}")
            else:
                wanted.setdefault(job, {})[name] = idx
    for slot, items in jewelry.items():
        for name, item in items.items():
            idx = pick(by_name.get(name, []), item.get("level", ""), None)
            if idx is None:
                missing.append(f"Jewelry: {name}")
            else:
                wanted.setdefault("Jewelry", {})[name] = idx

    # Heraldry keyed "name|Lv70"; the Smelted Rune keyed by its level ("60", "70").
    lists = json.loads((SIM / "lists.json").read_text(encoding="utf-8"))
    for kind in ("glyph_a", "glyph_s"):
        for name in lists[kind]["names"]:
            for level in lists[kind]["levels"]:
                rows = [r for r in by_name.get(name, []) if f"Lv{r.get('_LevelLimit')}" == level]
                if rows:
                    wanted.setdefault("Heraldry", {})[f"{name}|{level}"] = min(r["_IconImageIndex"] for r in rows)
                elif name != "None" and level != "None":
                    missing.append(f"Heraldry: {name} {level}")
    for level in lists["runes"]["core_levels"]:
        rows = [r for r in by_name.get("Smelted Rune", []) + by_name.get("Desert Dragon Smelted Rune", [])
                + by_name.get("Black Dragon Smelted Rune", []) if str(r.get("_LevelLimit")) == level]
        if rows:
            wanted.setdefault("Smelted", {})[level] = rows[0]["_IconImageIndex"]
        else:
            missing.append(f"Smelted Rune {level}")

    # Each level's Triangular rune is the attack rune and its Circular rune the defense rune; keyed "Attack|5".
    for rune_type, shape in (("Attack", "Triangular Rune"), ("Defense", "Circular Rune")):
        for rank in (2, 3, 4, 5):
            rows = [r for name, rs in by_name.items() if name.endswith(shape) and "Event" not in name
                    for r in rs if r.get("_Rank") == rank and (r.get("_LevelLimit") or 0) >= 50]
            if rows:
                wanted.setdefault("Rune", {})[f"{rune_type}|{rank}"] = min(r["_IconImageIndex"] for r in rows)
            else:
                missing.append(f"Rune: {rune_type} rank {rank}")

    # Monster cards ("Monster Card-<name>") and the Power of Mastery skills.
    for name in json.loads((SIM / "cards.json").read_text(encoding="utf-8"))["names"]:
        rows = by_name.get(f"Monster Card-{name}", [])
        if rows:
            wanted.setdefault("Card", {})[name] = max(rows, key=lambda r: r.get("_Rank") or 0)["_IconImageIndex"]
        else:
            missing.append(f"Card: {name}")
    for row in parse_dnt(locate(root, "cardskilltable.dnt")):
        if not row.get("_IsHide"):
            wanted.setdefault("Mastery", {})[ui.get(row["_NameID"], "")] = SKILL_ICON + row["_IconImageIndex"]
    mastery = sorted((r for r in parse_dnt(locate(root, "cardskilltable.dnt")) if not r.get("_IsHide")),
                     key=lambda r: r["_TreeSlotIndex"])

    tiers = json.loads((SIM / "costumes.json").read_text(encoding="utf-8"))
    costumes, costume_icons = costume_items(root, ui, tiers)
    wanted["Costume"] = costume_icons

    indexes = sorted({i for items in wanted.values() for i in items.values()})
    cell = {idx: n for n, idx in enumerate(indexes)}
    rows = -(-len(indexes) // SPRITE_COLS)
    sprite = Image.new("RGBA", (SPRITE_COLS * ICON, rows * ICON))
    sheets: dict[str, Image.Image] = {}
    # Icon sheets are spread over several ResourceNN folders.
    sheet_files = {p.name.lower(): p for p in sorted(root.rglob("*icon*.dds"))}
    for idx, n in cell.items():
        family = "skillicon" if idx >= SKILL_ICON else "itemicon"
        sheet_no, pos = divmod(idx % SKILL_ICON, PER_SHEET)
        sheet_name = f"{family}{sheet_no + 1:02d}.dds"
        if sheet_name not in sheets:
            sheets[sheet_name] = Image.open(sheet_files[sheet_name]).convert("RGBA")
        x, y = pos % PER_ROW * ICON, pos // PER_ROW * ICON
        icon = sheets[sheet_name].crop((x, y, x + ICON, y + ICON))
        sprite.paste(icon, (n % SPRITE_COLS * ICON, n // SPRITE_COLS * ICON))

    SPRITE.parent.mkdir(parents=True, exist_ok=True)
    sprite.save(SPRITE, "WEBP", quality=90, method=6)
    out = {"size": ICON, "cols": SPRITE_COLS, "frames": list(FRAMES),
           # Mastery in the game's order: [name, client stat id].
           "mastery": [[ui.get(r["_NameID"], ""), r.get("_StateType") or 0] for r in mastery],
           "items": {job: {name: cell[idx] for name, idx in sorted(items.items())} for job, items in sorted(wanted.items())}}
    MAP.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Costume picker: slot -> [name, tier, base classes ("" = any), rank], sorted by tier then name.
    pick_list = {slot: sorted(([name, e["tier"], ",".join(sorted(e["jobs"])), e["rank"]] for name, e in entries.items()),
                              key=lambda x: (x[1], x[0]))
                 for slot, entries in sorted(costumes.items())}
    COSTUMES_OUT.write_text(json.dumps(pick_list, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for slot, entries in pick_list.items():
        print(f"  costume {slot}: {len(entries)} items")
    frames_src = Image.open(locate(root, "uit_itemslotbutton.dds")).convert("RGBA")
    frames = Image.new("RGBA", (ICON * len(FRAMES), ICON))
    for n, (x, y) in enumerate(FRAMES.values()):
        frames.paste(frames_src.crop((x, y, x + ICON, y + ICON)), (n * ICON, 0))
    frames.save(FRAMES_OUT)

    print(f"{len(indexes)} icons, sprite {SPRITE.stat().st_size // 1024} KB; missing {len(missing)}")
    for m in missing:
        print("  missing", m)


if __name__ == "__main__":
    main()
