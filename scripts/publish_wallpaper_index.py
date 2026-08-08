#!/usr/bin/env python3
"""Scan wallpapers/ and generate wallpapers/index.json.

A wallpaper only appears in the index if BOTH its preview image
(NAME.png or NAME.bmp) and its NAME.zip (containing wallpaper.xbm) are
present in wallpapers/ - drop one file with no matching partner and it's
silently skipped rather than half-showing on the Wallpaper Showcase page.

"added" is the commit date the image file first appeared in git history
(falling back to the zip's first-add date, then to "now" if neither can
be determined - e.g. a very first commit with no prior history in a
shallow checkout), which is what the Showcase page's Newest/Oldest sort
uses. Run this from the repo root; it shells out to `git log` so the
checkout needs real history (fetch-depth: 0 in CI), not a shallow clone.

Dates are collected with a single `git log` pass over the whole
wallpapers/ tree rather than one subprocess per file - with hundreds of
wallpapers in here, spawning a separate git process per file adds up
fast (this was originally per-file and became the slow part once the
initial alphabet/initials batch landed).
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

IMAGE_EXTS = (".png", ".bmp")
REPO_ROOT = Path(__file__).resolve().parent.parent
WALLPAPERS_DIR = REPO_ROOT / "wallpapers"
INDEX_PATH = WALLPAPERS_DIR / "index.json"


def collect_added_dates() -> dict[str, str]:
    """Map of repo-relative path -> ISO 8601 date it was first added,
    for every path ever added under wallpapers/, in one git invocation."""
    try:
        out = subprocess.run(
            ["git", "log", "--reverse", "--diff-filter=A", "--name-only", "--format=%x00%aI"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        return {}

    dates: dict[str, str] = {}
    current_date = None
    for line in out.splitlines():
        if line.startswith("\x00"):
            current_date = line[1:].strip()
            continue
        path = line.strip()
        if not path or current_date is None:
            continue
        # --reverse walks oldest-first, so the first time we see a path is
        # genuinely its earliest "added" date even if it was later touched
        # again in a subsequent commit.
        if path.startswith("wallpapers/") and path not in dates:
            dates[path] = current_date
    return dates


def main() -> int:
    if not WALLPAPERS_DIR.is_dir():
        print(f"No wallpapers/ directory at {WALLPAPERS_DIR}, nothing to do.")
        return 0

    files = [f for f in WALLPAPERS_DIR.iterdir() if f.is_file() and f.name != "index.json"]
    images = {f.stem: f for f in files if f.suffix.lower() in IMAGE_EXTS}
    zips = {f.stem: f for f in files if f.suffix.lower() == ".zip"}
    added_dates = collect_added_dates()

    entries = []
    skipped = []
    for name, image_path in images.items():
        zip_path = zips.get(name)
        if zip_path is None:
            skipped.append(f"{image_path.name} (no matching .zip)")
            continue
        image_rel = f"wallpapers/{image_path.name}"
        zip_rel = f"wallpapers/{zip_path.name}"
        added = added_dates.get(image_rel) or added_dates.get(zip_rel)
        if not added:
            added = datetime.now(timezone.utc).isoformat()
        entries.append({"name": name, "image": image_rel, "zip": zip_rel, "added": added})

    for name, zip_path in zips.items():
        if name not in images:
            skipped.append(f"{zip_path.name} (no matching image)")

    entries.sort(key=lambda e: e["name"].casefold())

    index = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "wallpapers": entries,
    }
    INDEX_PATH.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(entries)} wallpaper(s) to {INDEX_PATH}")
    if skipped:
        print("Skipped (incomplete pair):")
        for s in skipped:
            print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
