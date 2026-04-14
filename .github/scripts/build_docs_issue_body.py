#!/usr/bin/env python3
"""
build_docs_issue_body.py

Builds the body for a deepgram-docs issue from a changed example directory.

Arguments:
  example_dir   Path to the example directory (e.g. examples/010-twilio-node)
  slug          Example slug (e.g. 010-twilio-node)
  action        "added" or "updated"

Environment variables:
  PR_URL        URL of the PR that changed the example
  PR_TITLE      Title of the PR
  PR_NUMBER     Number of the PR

Writes the body to /tmp/docs-issue-body.md and prints the byte count.

Usage:
  python3 .github/scripts/build_docs_issue_body.py EXAMPLE_DIR SLUG ACTION
"""

import os
import pathlib
import sys
import textwrap


def main() -> None:
    example_dir, slug, action = sys.argv[1], sys.argv[2], sys.argv[3]
    pr_url   = os.environ["PR_URL"]
    pr_title = os.environ["PR_TITLE"]
    pr_num   = os.environ["PR_NUMBER"]

    base  = pathlib.Path(example_dir)
    verb  = "added" if action == "added" else "updated"
    gh_url = f"https://github.com/deepgram/dx-examples/tree/main/{example_dir}"

    def read(path, limit=12000):
        p = base / path
        if not p.exists():
            return None
        txt = p.read_text(errors="ignore")
        if len(txt) > limit:
            txt = txt[:limit] + f"\n\n… *(truncated — full file at {gh_url}/{path})*"
        return txt

    readme = read("README.md")
    blog   = read("BLOG.md", limit=20000)

    lines = []
    lines.append(f"A Deepgram example was **{verb}** in PR #{pr_num}: [{pr_title}]({pr_url}).\n")
    lines.append(f"**Example:** [`{slug}`]({gh_url})\n")
    lines.append("---\n")
    lines.append("## What a writer should do with this\n")
    lines.append(textwrap.dedent(f"""\
        Use the BLOG.md below as the basis for a developer tutorial. It walks through
        the build step by step. The README is the quickstart reference. Between them,
        everything a developer needs is already here — your job is to edit for voice,
        add any extra context for the docs audience, and publish.
    """))
    lines.append("---\n")

    if readme:
        lines.append("## README (quickstart guide)\n")
        lines.append(f"```markdown\n{readme}\n```\n")

    if blog:
        lines.append("## BLOG.md (development narrative — use as tutorial draft)\n")
        lines.append(f"```markdown\n{blog}\n```\n")
    else:
        lines.append("## BLOG.md\n")
        lines.append("*(No BLOG.md found in this example — write the tutorial from scratch using the README and source code.)*\n")

    lines.append("---\n")
    lines.append(f"*Auto-created by notify-docs workflow. Source: [dx-examples PR #{pr_num}]({pr_url})*")

    body_file = pathlib.Path("/tmp/docs-issue-body.md")
    body_file.write_text("\n".join(lines))
    print(f"Body written ({body_file.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
