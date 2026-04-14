#!/usr/bin/env python3
"""
find_unhandled_issue.py

Reads newline-separated issue numbers from stdin (output of `gh issue list --jq '.[].number'`)
and prints the number of the oldest issue that still needs a response.

An issue is considered already handled if:
  - It has the 'type:example' or 'automated' label (build already done), OR
  - Its last comment contains '<!-- claude-reply -->' (already replied)

Prints nothing (empty) if no eligible issue is found.

Usage (piped from gh):
  gh issue list --label "type:suggestion" --state open --limit 50 --json number \
    --jq '.[].number' \
    | python3 .github/scripts/find_unhandled_issue.py --repo OWNER/REPO
"""

import argparse
import json
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="GitHub repo in OWNER/REPO format")
    args = parser.parse_args()

    numbers = [int(l.strip()) for l in sys.stdin if l.strip()]
    numbers.reverse()  # oldest first

    for num in numbers:
        result = subprocess.run(
            ["gh", "issue", "view", str(num), "--repo", args.repo, "--json", "comments,labels"],
            capture_output=True,
            text=True,
        )
        data = json.loads(result.stdout)

        # Skip already-built issues
        label_names = {l["name"] for l in data.get("labels", [])}
        if {"type:example", "automated"}.intersection(label_names):
            continue

        comments = data.get("comments", [])
        if not comments:
            print(num)
            return
        if "<!-- claude-reply -->" not in comments[-1].get("body", ""):
            print(num)
            return


if __name__ == "__main__":
    main()
