#!/usr/bin/env python3
"""
build_pr_body.py

Generates a clean PR body for an auto-built example:
  - Short summary (action, runtime, example, turn count)
  - Verbatim test files from the workspace
  - Prints "needs-credentials" to stdout if any test checks for missing
    credentials (i.e. has an exit-2 path), so the workflow can apply the label

Writes the PR body to /tmp/pr-body.md.
Prints "needs-credentials" to stdout if the label should be applied,
otherwise prints nothing.

Usage:
  python3 .github/scripts/build_pr_body.py \\
    --workspace WORKSPACE_DIR \\
    --issue ISSUE_NUMBER \\
    --action new|modify \\
    --runtime python \\
    --example 540-livekit-voice-agent-python \\
    --build-log /tmp/build-log.md
"""

import argparse
import re
import sys
from pathlib import Path


def extract_build_summary(build_log: Path) -> str:
    """Pull a one-paragraph summary out of the build log."""
    if not build_log.exists():
        return "_No build log found._"

    text = build_log.read_text(errors="ignore")

    # Count turns
    turns = len(re.findall(r"ℹ️ Turn \d+/\d+", text))

    # Final status
    if "Agent signalled completion" in text:
        status = "✅ Agent completed successfully"
    elif "AGENT_TURN_LIMIT_EXCEEDED" in text:
        status = "⚠️ Turn limit reached"
    else:
        status = "❓ Unknown completion state"

    # Rules that fired (interesting for reviewers)
    rules_fired = sorted(set(re.findall(r"\[RULE:[\w-]+\]", text)))
    rules_str = ", ".join(rules_fired) if rules_fired else "none"

    return (
        f"{status} after {turns} turns.  \n"
        f"Rules fired: {rules_str}"
    )


def collect_test_files(workspace: Path) -> list[tuple[str, str]]:
    """Return (relative_path, content) for each file in tests/."""
    tests_dir = workspace / "tests"
    if not tests_dir.exists():
        return []
    results = []
    for f in sorted(tests_dir.rglob("*")):
        if f.is_file() and f.suffix in (".py", ".sh", ".ts", ".js", ".go", ".rs"):
            rel = str(f.relative_to(workspace))
            results.append((rel, f.read_text(errors="ignore")))
    return results


def needs_credentials(test_files: list[tuple[str, str]]) -> bool:
    """Return True if any test has an exit-2 / missing-credentials path."""
    for _, content in test_files:
        if re.search(r"exit\s*\(?2\)?|sys\.exit\(2\)|exit 2", content):
            return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--issue", required=True)
    parser.add_argument("--action", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--example", required=True)
    parser.add_argument("--build-log", default="/tmp/build-log.md")
    parser.add_argument("--incomplete", action="store_true",
                        help="Mark PR as WIP / turn limit reached")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    build_log = Path(args.build_log)

    summary = extract_build_summary(build_log)
    test_files = collect_test_files(workspace)
    apply_needs_credentials = needs_credentials(test_files)

    lines = []
    if args.incomplete:
        lines.append(f"Part of #{args.issue} — turn limit reached, build incomplete.\n")
        lines.append(
            f"> ⚠️ **WIP** — the agent ran out of turns. Comment `@claude continue` "
            f"to resume from where it left off.\n"
        )
    else:
        lines.append(f"Closes #{args.issue}\n")
    lines.append(
        f"**Action:** {args.action.capitalize()}  \n"
        f"**Runtime:** `{args.runtime}`  \n"
        f"**Example:** `{args.example}`\n"
    )
    lines.append("---\n")
    lines.append(f"## Build summary\n\n{summary}\n")

    if test_files:
        lines.append("---\n")
        lines.append("## Tests\n")
        for rel_path, content in test_files:
            ext = Path(rel_path).suffix.lstrip(".")
            lines.append(f"### `{rel_path}`\n")
            lines.append(f"```{ext}\n{content}\n```\n")
    else:
        lines.append("---\n")
        lines.append("## Tests\n\n_No test files found._\n")

    if apply_needs_credentials:
        lines.append("---\n")
        lines.append(
            "> **needs-credentials** — one or more tests exit 2 when credentials "
            "are missing. Add the required secrets to the repository to enable "
            "end-to-end testing.\n"
        )

    body = "\n".join(lines)
    Path("/tmp/pr-body.md").write_text(body)

    if apply_needs_credentials:
        print("needs-credentials")


if __name__ == "__main__":
    main()
