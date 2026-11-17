"""Rebuild tasks.json, milestones.json and decisions.json from the markdown docs,
keeping each task's status, verification and evidence, then cross-check everything.

Run from anywhere:  python3 docs/tracker/sync.py
It reads and writes files only; it calls no service.
"""

import glob
import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent
TRACKER = DOCS / "tracker"
AREA = {"BE": "Backend", "FE": "Frontend", "OPS": "Operations", "DOC": "Documents"}
OWNERS = {"Fable", "Opus", "Sonnet", "Haiku", "Owner"}
NEEDS = {"Correctness", "Safety", "Acceptance", "Optional"}
CLASSES = {"Confirmed", "Assumed", "Needs Verification", "Deferred", "Out of Scope"}
VERIFICATION = {"", "VERIFIED", "MOCK-VERIFIED", "IMPLEMENTED, UNVERIFIED", "BLOCKED", "DEFERRED"}


def load(name):
    return json.loads((TRACKER / name).read_text())


def dump(name, rows):
    (TRACKER / name).write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")


def cells(line):
    return [c.strip() for c in line.split("|")[1:-1]]


def main():
    md = (DOCS / "MILESTONES.md").read_text()
    old = {t["id"]: t for t in load("tasks.json")}
    old_ms = {m["id"]: m for m in load("milestones.json")}

    lanes = {}
    for line in md.splitlines():
        c = cells(line)
        if len(c) == 3 and re.fullmatch(r"T-\d+", c[0]):
            lanes[c[0]] = (c[1], "" if c[2] == "—" else c[2])

    tasks, milestones, current = [], [], None
    for line in md.splitlines():
        heading = re.match(r"## (M\d(?:\.\d)?) — ", line)
        if heading:
            current = heading.group(1)
        c = cells(line)
        if len(c) == 4 and re.fullmatch(r"M\d(?:\.\d)?", c[0]):
            milestones.append({
                "id": c[0], "order": len(milestones), "milestone": c[1], "outcome": c[2],
                "depends_on": c[3], "status": old_ms.get(c[0], {}).get("status", "Planned"),
            })
        if len(c) == 7 and re.fullmatch(r"T-\d+", c[0]):
            tid, area, owner, need, traces, title, accepted = c
            before = old.get(tid, {})
            tasks.append({
                "id": tid, "milestone": current, "area": AREA[area],
                "lane": lanes.get(tid, ("", ""))[0], "owner": owner, "need": need,
                "traces_to": traces, "starts_after": lanes.get(tid, ("", ""))[1],
                "task": title, "acceptance": accepted,
                "status": before.get("status", "To do"),
                "verification": before.get("verification", ""),
                "evidence": before.get("evidence", ""),
            })

    decisions = []
    for block in (DOCS / "DECISIONS.md").read_text().split("\n## ")[1:]:
        head = re.match(r"(D-\d+) — (.+)", block)
        parts = dict(re.findall(r"\*\*(Status|Choice|Alternatives|Why|Trade-off|Validation):\*\* (.+)", block))
        if len(parts) != 6:
            sys.exit(f"{head.group(1)}: a decision needs Status, Choice, Alternatives, Why, Trade-off, Validation")
        status, date, area = [p.strip() for p in parts["Status"].split("·")]
        # The dashboard counts statuses by exact word: Confirmed, Proposed, Needs owner, Superseded.
        # Any note in brackets after the word stays in DECISIONS.md only.
        word = "Needs owner" if status.startswith("Needs") else status.split(" (")[0].split(" by ")[0]
        question = re.search(r"Q-\d+", status) if word == "Needs owner" else None
        decisions.append({
            "id": head.group(1), "decision": head.group(2).strip(),
            "status": word,
            "waiting_on": question.group(0) if question else "",
            "area": area.replace("Area: ", "").capitalize(), "choice": parts["Choice"],
            "trade_off": parts["Trade-off"], "validation": parts["Validation"], "date": date,
        })

    dump("tasks.json", tasks)
    dump("milestones.json", milestones)
    dump("decisions.json", decisions)

    # ---- cross-checks
    requirements, questions = load("requirements.json"), load("questions.json")
    problems = []
    ids = {row["id"] for rows in (tasks, decisions, requirements, questions, milestones) for row in rows}
    task_ids = {t["id"] for t in tasks}
    files = [DOCS / n for n in ("HLD.md", "DECISIONS.md", "MILESTONES.md", "README.md", "M1-PLAN.md", "UX.md")]
    files += [DOCS.parent / "backend" / "CLAUDE.md", DOCS.parent / "frontend" / "CLAUDE.md"]
    files += [Path(p) for p in glob.glob(str(TRACKER / "*.json"))]
    for path in files:
        if path.exists():
            for ref in set(re.findall(r"\b([RQDT]-\d{2,3})\b", path.read_text())):
                if ref not in ids:
                    problems.append(f"{path.name}: {ref} is not defined")
    if set(lanes) != task_ids:
        problems.append(f"lane table and task tables differ: {sorted(set(lanes) ^ task_ids)}")
    after = {t["id"]: [x.strip() for x in t["starts_after"].split(",") if x.strip()] for t in tasks}
    for t in tasks:
        if t["owner"] not in OWNERS or t["need"] not in NEEDS or not t["traces_to"]:
            problems.append(f"{t['id']}: needs a valid owner, need and requirement")
        if t["verification"] not in VERIFICATION:
            problems.append(f"{t['id']}: unknown verification value {t['verification']!r}")
        problems += [f"{t['id']}: starts after unknown task {d}" for d in after[t["id"]] if d not in task_ids]

    def ancestors(tid, seen, path=()):
        if tid in path:
            sys.exit(f"dependency cycle through {tid}")
        for dep in after.get(tid, []):
            seen.add(dep)
            ancestors(dep, seen, path + (tid,))
        return seen

    reach = {tid: ancestors(tid, set()) for tid in task_ids}
    lane_of = {t["id"]: t["lane"] for t in tasks}
    for a in sorted(task_ids):
        for b in sorted(task_ids):
            if a < b and lane_of[a] == lane_of[b] and lane_of[a] not in ("Docs", "Review"):
                if a not in reach[b] and b not in reach[a]:
                    problems.append(f"{a} and {b} share lane {lane_of[a]} but have no order")
    for r in requirements:
        if r["class"] not in CLASSES:
            problems.append(f"{r['id']}: unknown class {r['class']!r}")
        if r["class"] == "Confirmed" and not r["source"].startswith("Owner"):
            problems.append(f"{r['id']}: Confirmed must come from the owner")
    for d in decisions:
        if d["status"] == "Needs owner" and not d["waiting_on"]:
            problems.append(f"{d['id']}: 'Needs owner' must name a question")

    done = {t["id"] for t in tasks if t["status"] == "Done"}
    ready = [t["id"] for t in tasks if t["status"] == "To do" and all(d in done for d in after[t["id"]])]
    print(f"{len(tasks)} tasks, {len(decisions)} decisions, {len(requirements)} requirements, {len(questions)} questions")
    print("can start now:", ", ".join(ready) or "none")
    if problems:
        sys.exit("PROBLEMS:\n  " + "\n  ".join(problems))
    print("cross-check passed")


if __name__ == "__main__":
    main()
