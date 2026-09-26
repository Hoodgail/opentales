#!/usr/bin/env python3
"""Grade eval-novel-agent runs against objective, persisted-state assertions.

Usage: grade-novel-agent.py <run-dir> [<run-dir> ...]
Writes grading.json (skill-creator schema) beside each summary.json.
"""
import json
import re
import sys
from pathlib import Path


def doc(state, name):
    """Find a doc by title, tolerating subfolders and title suffixes."""
    name = name.lower()
    exact = next((d for d in state["docs"] if d["path"].lower().split("/")[-1] == name), None)
    return exact or next((d for d in state["docs"] if name in d["path"].lower().split("/")[-1]), None)


def section(body, name):
    match = re.search(rf"^#+\s*{re.escape(name)}.*?$(.*?)(?=^#+\s|\Z)", body or "", re.M | re.S | re.I)
    return match.group(1).strip() if match else ""


def grade_plan(summary, state):
    ledger = doc(state, "Ledger")
    brief = doc(state, "Brief & Contract")
    chapters = state["chapters"]
    return [
        ("Keeps planning out of chat (final reply under 250 words)", summary["chatWords"] < 250, f"{summary['chatWords']} chat words"),
        ("Persists at least 3,000 words of planning into docs", summary["persistedDocWords"] >= 3000, f"{summary['persistedDocWords']} doc words"),
        ("Organizes work in a Story Bible folder", any(f.startswith("Story Bible") for f in state["folders"]), ", ".join(state["folders"])),
        ("Creates a Ledger with Now / Next action / Notes to future self",
         bool(ledger) and all(section(ledger["body"], s) for s in ["Now", "Next action", "Notes to future self"]),
         ledger["path"] if ledger else "no ledger"),
        ("Brief & Contract has numbered drift criteria and a length target",
         bool(brief) and bool(re.search(r"\bC\d+\.", brief["body"])) and bool(re.search(r"\d{2},?\d{3}", brief["body"])),
         brief["path"] if brief else "no brief"),
        ("Creates at least 4 characters as native profiles", len(state["characters"]) >= 4, f"{len(state['characters'])} characters"),
        ("Creates at least 3 locations as native objects", len(state["locations"]) >= 3, f"{len(state['locations'])} locations"),
        ("Creates character relationships", state["relationships"] >= 2, f"{state['relationships']} relationships"),
        ("Creates acts", len(state["acts"]) >= 2, f"{len(state['acts'])} acts"),
        ("Creates the whole chapter skeleton (>= 12 chapters)", len(chapters) >= 12, f"{len(chapters)} chapters"),
        ("Every chapter has a summary", bool(chapters) and all((c.get("summary") or "").strip() for c in chapters),
         f"{sum(1 for c in chapters if (c.get('summary') or '').strip())}/{len(chapters)} summarized"),
        ("Sets a logline in story structure", bool(state["structure"] and state["structure"]["logline"].strip()), (state["structure"] or {}).get("logline", "")[:120]),
        ("Tool error rate under 10%", summary["toolCalls"] > 0 and summary["toolErrors"] / summary["toolCalls"] < 0.10, f"{summary['toolErrors']}/{summary['toolCalls']} errors"),
    ]


def grade_resume(summary, state):
    ledger = doc(state, "Ledger")
    chapters = state["chapters"]
    briefs = [d for d in state["docs"] if d["path"].startswith("Chapter Briefs/")]
    scenes = [s for c in chapters[:3] for s in c["scenes"]]
    notes = section(ledger["body"], "Notes to future self") if ledger else ""
    return [
        ("Follows the Ledger's next action: briefs for chapters 1-3", len(briefs) >= 3, f"{len(briefs)} briefs"),
        ("Plans at least 2 scenes per chapter for chapters 1-3", all(len(c["scenes"]) >= 2 for c in chapters[:3]), [len(c["scenes"]) for c in chapters[:3]]),
        ("Scenes carry goal and turn metadata", bool(scenes) and all(s.get("goal") and s.get("turn") for s in scenes), f"{len(scenes)} scenes"),
        ("Does not draft prose (the Ledger said not to)", summary["proseWords"] == 0, f"{summary['proseWords']} prose words"),
        ("Does not re-plan from scratch (no duplicate Brief)", sum(1 for d in state["docs"] if "brief & contract" in d["path"].lower()) == 1, "brief count"),
        ("Preserves the author's standing notes in the Ledger", "withholds" in notes.lower() or "never lie" in notes.lower(), notes[:160]),
        ("Updates the Ledger's Next action", bool(ledger) and "Write chapter briefs for chapters 1–3" not in section(ledger["body"], "Next action"), section(ledger["body"], "Next action")[:200] if ledger else ""),
        ("Keeps reply short (under 200 words)", summary["chatWords"] < 200, f"{summary['chatWords']} words"),
    ]


def grade_draft(summary, state):
    ch1 = state["chapters"][0] if state["chapters"] else {"scenes": [], "words": 0}
    scene_words = sum(s["words"] for s in ch1["scenes"])
    ledger = doc(state, "Ledger")
    canon = doc(state, "Canon")
    return [
        ("Drafts Chapter 1 into scenes (>= 2 scenes with prose)", sum(1 for s in ch1["scenes"] if s["words"] > 200) >= 2, [s["words"] for s in ch1["scenes"]]),
        ("Chapter 1 prose totals 2,000-4,500 words", 2000 <= max(ch1["words"], scene_words) <= 4500, f"chapter {ch1['words']}w, scenes {scene_words}w"),
        ("Compiles scenes into the chapter body", ch1["words"] > 1500, f"{ch1['words']} chapter words"),
        ("Runs runStoryLint", summary["toolHistogram"].get("runStoryLint", 0) > 0, summary["toolHistogram"].get("runStoryLint", 0)),
        ("Stops after Chapter 1 as the Ledger instructs", all(c["words"] == 0 and not any(s["words"] for s in c["scenes"]) for c in state["chapters"][1:]), [c["words"] for c in state["chapters"]]),
        ("Adds new facts to Canon", bool(canon) and canon["words"] > 40, f"{canon['words'] if canon else 0} canon words"),
        ("Updates the Ledger's Next action past Chapter 1", bool(ledger) and "Draft Chapter 1" not in section(ledger["body"], "Next action"), section(ledger["body"], "Next action")[:160] if ledger else ""),
        ("Keeps the prose out of chat (reply under 250 words)", summary["chatWords"] < 250, f"{summary['chatWords']} chat words"),
    ]


def main():
    for run_dir in map(Path, sys.argv[1:]):
        summary = json.loads((run_dir / "summary.json").read_text())
        state = json.loads((run_dir / "state.json").read_text())
        grader = {"resume-from-ledger": grade_resume, "write-next-chapter": grade_draft}.get(summary["scenario"], grade_plan)
        results = grader(summary, state)
        expectations = [{"text": t, "passed": bool(p), "evidence": str(e)} for t, p, e in results]
        passed = sum(e["passed"] for e in expectations)
        grading = {
            "expectations": expectations,
            "summary": {"passed": passed, "failed": len(expectations) - passed, "total": len(expectations), "pass_rate": passed / len(expectations)},
            "execution_metrics": {"total_tool_calls": summary["toolCalls"], "errors_encountered": summary["toolErrors"]},
            "timing": {"total_duration_seconds": summary["durationSeconds"]},
        }
        (run_dir / "grading.json").write_text(json.dumps(grading, indent=2))
        print(f"{run_dir}: {passed}/{len(expectations)}")
        for e in expectations:
            if not e["passed"]:
                print(f"   ✗ {e['text']} — {e['evidence']}")


if __name__ == "__main__":
    main()
