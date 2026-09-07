#!/usr/bin/env python3
"""Auto-resolve additive-only merge conflicts in known fork-touched files.

Used by .github/workflows/docker.yml's "Sync fork with upstream" step, for
files listed there in FORK_ADDITIVE_CONFLICT_FILES: shared files where this
fork only ever appends its own entries after upstream's (see CLAUDE.md's
"Fork sync conventions"), so a conflict there is expected to be nothing more
than "both sides added new lines in the same place" -- upstream growing its
own list, this fork's tail-appended block sitting right after it.

The step runs `git config merge.conflictStyle diff3` before merging, so every
conflict hunk carries a "|||||||" common-ancestor section. A hunk is only
auto-resolved when that section is completely empty -- i.e. the anchor line
both sides inserted after was never itself touched, so git left it as plain
context outside the hunk, and everything on both sides is brand new content
that didn't exist in the merge base at all. That's what the two real
conflicts this script was written for looked like (see PR #42). A non-empty
base section is deliberately treated as unresolvable, even though in
principle both sides might still only be adding lines around shared context:
naively concatenating "theirs" then "ours" in that case would duplicate the
shared context line(s) that both sides carried into the hunk, silently
producing wrong output. If a hunk fails the empty-base check (the fork or
upstream did something other than a clean append, or git just didn't draw
the hunk boundary where this script assumes it does), it's left untouched
and this script exits non-zero so the workflow falls back to its existing
behavior: abort the merge and fail the job for a human to resolve manually
via PR.

Resolution keeps both sides, upstream's ("theirs") lines first and this
fork's ("ours") lines after, matching the "append fork-only entries after
everything upstream has" convention -- so this is exactly the same
resolution a human following that convention would type by hand.

A hand-rolled line-by-line parser is used instead of a regex: an empty
common-ancestor section (the usual case here -- both sides are adding
something that didn't exist at all before) leaves zero lines between the
"|||||||" and "=======" markers, which is awkward to express correctly in a
single regex and easy to get subtly wrong. Scanning line-by-line handles
that (and any other segment being empty) with no special-casing.
"""

import sys

CONFLICT_START = "<<<<<<< HEAD"
CONFLICT_BASE = "||||||| "
CONFLICT_SEP = "======="
CONFLICT_END = ">>>>>>> upstream/main"


def process(lines: list[str], path: str) -> tuple[list[str], bool]:
    out: list[str] = []
    ok = True
    i, n = 0, len(lines)

    while i < n:
        if lines[i] != CONFLICT_START:
            out.append(lines[i])
            i += 1
            continue

        i += 1
        ours: list[str] = []
        while i < n and not lines[i].startswith(CONFLICT_BASE):
            ours.append(lines[i])
            i += 1
        if i >= n:
            print(f"::error::{path}: unterminated conflict marker (missing '|||||||')")
            return lines, False
        i += 1  # skip the "||||||| <label>" line

        base: list[str] = []
        while i < n and lines[i] != CONFLICT_SEP:
            base.append(lines[i])
            i += 1
        if i >= n:
            print(f"::error::{path}: unterminated conflict marker (missing '=======')")
            return lines, False
        i += 1  # skip "======="

        theirs: list[str] = []
        while i < n and not lines[i].startswith(CONFLICT_END):
            theirs.append(lines[i])
            i += 1
        if i >= n:
            print(f"::error::{path}: unterminated conflict marker (missing '>>>>>>>')")
            return lines, False
        i += 1  # skip ">>>>>>> upstream/main"

        if base:
            print(
                f"::error::{path}: a conflict hunk has a non-empty common-"
                "ancestor section -- needs manual resolution"
            )
            ok = False
            continue  # drop this hunk's markers from `out`; caller bails anyway

        out.extend(theirs)
        out.extend(ours)

    return out, ok


def resolve_file(path: str) -> bool:
    with open(path, encoding="utf-8") as f:
        content = f.read()

    if CONFLICT_START not in content:
        print(f"::error::{path}: no conflict markers found, nothing to resolve")
        return False

    ends_with_newline = content.endswith("\n")
    lines = content.split("\n")
    if ends_with_newline:
        lines.pop()  # split("\n") on a trailing newline leaves a bogus "" entry

    new_lines, ok = process(lines, path)
    if not ok:
        return False

    new_content = "\n".join(new_lines) + ("\n" if ends_with_newline else "")
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"Auto-resolved additive conflict(s) in {path}")
    return True


def main(paths: list[str]) -> int:
    if not paths:
        print("::error::no files given to resolve-additive-conflicts.py")
        return 1
    success = True
    for path in paths:
        if not resolve_file(path):
            success = False
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
