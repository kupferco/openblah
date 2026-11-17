"""Print a side-by-side table from results/ts.json and results/py.json."""

import json
from pathlib import Path

res = Path(__file__).parent / "results"
ts = json.loads((res / "ts.json").read_text())["summary"]
py = json.loads((res / "py.json").read_text())["summary"]
keys = ["plain_turns_measured", "median_ms", "p95_ms", "mean_ms", "false_cutoffs", "midpause_turns", "missed_ends", "errors"]
print("| language | metric | TypeScript | Python |\n|---|---|---|---|")
for lang in ("en", "pt", "all"):
    for k in keys:
        print(f"| {lang} | {k} | {ts[lang][k]} | {py[lang][k]} |")
