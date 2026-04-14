#!/usr/bin/env python3
"""
find_unprocessed_issue.py

Reads a JSON list of issues from stdin (output of `gh issue list --json number`)
and prints the number of the oldest unprocessed one as JSON: {"number": NNN}

An issue is considered already processed if any of its comments contains
the '<!-- pr-opened -->' marker (injected when a build PR is opened).

Prints the string SKIP if no eligible issue is found.

Usage (piped from gh):
  gh issue list --label "type:suggestion" --state open --json number --limit 50 \
    | python3 .github/scripts/find_unprocessed_issue.py --repo OWNER/REPO
"""

import argparse
import json
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="GitHub repo in OWNER/REPO format")
    args = parser.parse_args()

    issues = json.load(sys.stdin)
    numbers = [i["number"] for i in reversed(issues)]  # oldest first

    for num in numbers:
        r = subprocess.run(
            ["gh", "issue", "view", str(num), "--repo", args.repo, "--json", "comments"],
            capture_output=True,
            text=True,
        )
        comments = json.loads(r.stdout).get("comments", [])
        if any("<!-- pr-opened -->" in c.get("body", "") for c in comments):
            continue  # build already started or completed
        print(json.dumps({"number": num}))
        return

    print("SKIP")


if __name__ == "__main__":
    main()
