#!/usr/bin/env python3
"""Apply Umbra's branding and source substitutions to a Chromium checkout.

Substitutions are exact find/replace pairs against named files rather than
context diffs. A context diff against Chromium rots on every version bump and
fails in ways that take an afternoon to unpick; a substitution that no longer
matches names the file and the string it wanted, and stops.

    python3 scripts/apply.py --src src [--check] [--revert]

--check   report what would change without writing anything
--revert  restore every file this script has touched, from its .umbra-orig copy
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent

BACKUP_SUFFIX = ".umbra-orig"

BRANDING = {
    "COMPANY_FULLNAME": "stillemptyNOW",
    "COMPANY_SHORTNAME": "Umbra",
    "PRODUCT_FULLNAME": "Umbra",
    "PRODUCT_SHORTNAME": "Umbra",
    "PRODUCT_INSTALLER_FULLNAME": "Umbra Installer",
    "PRODUCT_INSTALLER_SHORTNAME": "Umbra Installer",
    "COPYRIGHT": "Copyright 2026 stillemptyNOW. All Rights Reserved.",
    "MAC_BUNDLE_ID": "io.umbra.browser",
    "MAC_CREATOR_CODE": "Umbr",
    "MAC_TEAM_ID": "",
}

# Icons copied over Chromium's own artwork. Source paths are relative to the
# repository root, destinations relative to the Chromium src directory.
ICONS = [
    ("brand/generated/umbra.ico", "chrome/app/theme/chromium/win/chromium.ico"),
    ("brand/generated/umbra-256.png", "chrome/app/theme/chromium/product_logo_256.png"),
    ("brand/generated/umbra-128.png", "chrome/app/theme/chromium/product_logo_128.png"),
    ("brand/generated/umbra-64.png", "chrome/app/theme/chromium/product_logo_64.png"),
    ("brand/generated/umbra-48.png", "chrome/app/theme/chromium/product_logo_48.png"),
    ("brand/generated/umbra-32.png", "chrome/app/theme/chromium/product_logo_32.png"),
    ("brand/generated/umbra-16.png", "chrome/app/theme/chromium/product_logo_16.png"),
]


class Failure(Exception):
    pass


def log(message: str) -> None:
    print(f"    {message}")


def parse_substitutions(path: Path) -> list[tuple[str, str, str]]:
    rules: list[tuple[str, str, str]] = []
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 3:
            raise Failure(f"{path.name}:{lineno}: expected three | separated fields")
        rules.append((parts[0], parts[1], parts[2]))
    return rules


def backup(path: Path) -> None:
    """Keep one pristine copy so --revert can undo everything."""
    original = path.with_suffix(path.suffix + BACKUP_SUFFIX)
    if not original.exists():
        shutil.copy2(path, original)


def write_branding(src: Path, check: bool) -> int:
    target = src / "chrome/app/theme/chromium/BRANDING"
    if not target.exists():
        raise Failure(f"missing {target.relative_to(src)} — is --src really a Chromium checkout?")

    body = "\n".join(f"{key}={value}" for key, value in BRANDING.items()) + "\n"
    if target.read_text(encoding="utf-8") == body:
        log("BRANDING already applied")
        return 0

    log(f"BRANDING -> {BRANDING['PRODUCT_FULLNAME']}")
    if not check:
        backup(target)
        target.write_text(body, encoding="utf-8")
    return 1


def copy_icons(src: Path, check: bool) -> int:
    changed = 0
    for source_rel, dest_rel in ICONS:
        source = REPO / source_rel
        dest = src / dest_rel
        if not source.exists():
            raise Failure(f"missing {source_rel} — run `npm run icons` at the repository root")
        if not dest.parent.exists():
            log(f"skipped {dest_rel} (not in this checkout)")
            continue
        log(f"icon {dest_rel}")
        if not check:
            if dest.exists():
                backup(dest)
            shutil.copy2(source, dest)
        changed += 1
    return changed


def apply_substitutions(src: Path, rules: list[tuple[str, str, str]], check: bool) -> int:
    changed = 0
    unmatched: list[str] = []

    for rel, find, replace in rules:
        target = src / rel
        if not target.exists():
            unmatched.append(f"{rel} (no such file)")
            continue

        text = target.read_text(encoding="utf-8", errors="surrogateescape")
        if find not in text:
            # Already applied is fine; never having matched is not.
            if replace in text:
                log(f"already applied: {rel}")
                continue
            unmatched.append(f"{rel} (string not found: {find[:60]!r})")
            continue

        count = text.count(find)
        log(f"{rel}: {count} replacement{'s' if count != 1 else ''}")
        if not check:
            backup(target)
            target.write_text(
                text.replace(find, replace), encoding="utf-8", errors="surrogateescape"
            )
        changed += count

    if unmatched:
        raise Failure(
            "these substitutions did not match — Chromium has moved them:\n"
            + "\n".join(f"  - {item}" for item in unmatched)
        )
    return changed


def revert(src: Path) -> int:
    restored = 0
    for original in src.rglob(f"*{BACKUP_SUFFIX}"):
        # Not with_suffix(""): that strips only the final extension, which
        # would turn "chromium.ico.umbra-orig" into "chromium.ico" but
        # "product_logo_16.png.umbra-orig" into "product_logo_16.png" only by
        # luck. Trim the known suffix instead.
        target = original.parent / original.name[: -len(BACKUP_SUFFIX)]
        shutil.move(str(original), str(target))
        log(f"restored {target.relative_to(src)}")
        restored += 1
    return restored


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default="src", help="path to the Chromium checkout")
    parser.add_argument("--check", action="store_true", help="report without writing")
    parser.add_argument("--revert", action="store_true", help="undo previous runs")
    args = parser.parse_args()

    src = (ROOT / args.src).resolve() if not Path(args.src).is_absolute() else Path(args.src)

    try:
        if not src.is_dir():
            raise Failure(f"no checkout at {src} — run scripts/fetch.sh first")

        if args.revert:
            print("==> Umbra: reverting")
            print(f"    {revert(src)} file(s) restored")
            return 0

        print(f"==> Umbra: {'checking' if args.check else 'applying'} against {src}")

        total = write_branding(src, args.check)
        total += copy_icons(src, args.check)
        total += apply_substitutions(src, parse_substitutions(ROOT / "substitutions.txt"), args.check)

        print(f"==> {total} change(s) {'pending' if args.check else 'applied'}")
        print("    next: ./scripts/build.sh <platform>" if not args.check else "")
        return 0

    except Failure as error:
        print(f"\nerror: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
