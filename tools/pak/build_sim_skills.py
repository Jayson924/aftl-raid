"""Damage skills per class at their highest Lv70 level, for the simulator's Skills tab.
Usage: py -3.12 -I tools/pak/build_sim_skills.py <extraction root>
Skill levels come from the toolbox's skill tables; only values the SEA client's PvE tooltip confirms are kept."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_gear_tables import load_uistrings, locate, parse_dnt  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "netlify/data/sim/skills.json"
TOOLBOX = REPO.parent / "classic-dn-toolbox/dragon_nest_builder/data/modular"
SKILLS = TOOLBOX / "tables/skills/skill_damage_tiny_jobs"
LEVEL_CAP = 70
SKILL_FILES = ("academic", "archer", "assassin", "cleric", "etc", "kali", "soceress", "warrior")
ELEMENT = {0: "Fire", 1: "Water", 2: "Light", 3: "Dark"}
KINDS = {"物攻": "P", "魔攻": "M"}


def main(root: Path) -> None:
    ui = load_uistrings(root)
    # PvE rows only (_ApplyType 0); PvP rows share the index and level.
    levels = {(r["_SkillIndex"], r["_SkillLevel"]): r for f in SKILL_FILES
              for r in parse_dnt(locate(root, f"skillleveltable_character{f}.dnt")) if not r.get("_ApplyType")}
    skills = {r["RowId"]: r for r in parse_dnt(locate(root, "skilltable_character.dnt"))}
    english = json.loads((TOOLBOX / "english_keys.json").read_text(encoding="utf-8"))["jobs"]
    panel = json.loads((TOOLBOX / "tables/effective_panel.json").read_text(encoding="utf-8"))
    allow = json.loads((SKILLS / "allowlist.json").read_text(encoding="utf-8"))["jobs"]
    index = json.loads((SKILLS / "index.json").read_text(encoding="utf-8"))["jobs"]

    out, dropped = {}, 0
    for job in index:
        cn = job["job_name"]
        kinds = {KINDS[p["攻击"]] for p in panel.get(cn, []) if p["攻击"] in KINDS and p["权重"] > 0}
        data = json.loads((SKILLS / job["file"]).read_text(encoding="utf-8"))
        allowed = set(allow.get(cn, []))
        rows, seen = [], set()
        for skill_id, name, by_level in data.get("n", []) + data.get("m", []):
            if skill_id in seen:  # "m" repeats most of "n"
                continue
            seen.add(skill_id)
            reachable = [lv for lv in by_level if lv[1] <= LEVEL_CAP]
            if (allowed and name not in allowed) or not reachable:
                continue
            top = reachable[-1]
            parts = top[3] if len(top) == 4 else [top[3:6]]
            match = next((p for p in parts if p[0] in kinds), None)
            if not match or match[1] <= 0:
                continue
            kind, pct, fixed = match
            row = levels.get((skill_id, top[0]))
            params = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", str(row.get("_SkillExplanationIDParam", "")))] if row else []
            info = skills.get(skill_id)
            if not row or not info or pct not in params or (fixed and fixed not in params):
                dropped += 1
                continue
            rows.append({"id": skill_id, "name": re.sub(r"\s+", " ", ui.get(info["_NameID"], name)).strip(),
                         "level": top[0], "kind": kind, "pct": pct, "fixed": fixed,
                         "element": ELEMENT.get(info.get("_Element"), "None")})
        if rows:
            out[english[cn]] = rows
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{sum(map(len, out.values()))} skills for {len(out)} classes ({dropped} not confirmed by the client) -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
