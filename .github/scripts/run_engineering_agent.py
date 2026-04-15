#!/usr/bin/env python3
"""
run_engineering_agent.py

Engineering agent loop — acts on @deepgram-robot requests.
Uses llm.py for provider abstraction, gh CLI for repo operations.
"""

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

from llm import MODEL, messages_create, response_text, response_stop_reason, extract_blocks, wrap_message, wrap_tool_result

REPO_SLUG = os.environ["REPO_SLUG"]
ISSUE_NUMBER = os.environ["ISSUE_NUMBER"]
COMMENT_BODY = os.environ["COMMENT_BODY"]
COMMENTER = os.environ["COMMENTER"]
BRANCH = os.environ["BRANCH"]
PR_BODY = os.environ.get("PR_BODY", "").strip()
PRIOR_STATE = os.environ.get("PRIOR_STATE", "").strip()
COMMENT_URL = os.environ.get("COMMENT_URL", "")
WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", "")
REPO_ROOT = os.environ.get("REPO_ROOT", "")


def run_command(cmd: str, timeout: int = 300) -> dict:
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, timeout=timeout
    )
    return {"stdout": result.stdout, "stderr": result.stderr, "exit_code": result.returncode}


def post_comment(body: str) -> None:
    body_quoted = body.replace("'", "'\"'\"'")
    run_command(
        f"gh issue comment {ISSUE_NUMBER} --repo {REPO_SLUG} --body '{body_quoted}'"
    )


TOOLS = [
    {
        "name": "Bash",
        "description": "Run a shell command. Use for git operations, running tests, installing deps, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer"},
            },
            "required": ["command"],
        },
    },
    {
        "name": "Read",
        "description": "Read a file from the repo.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "Write",
        "description": "Write or overwrite a file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "Edit",
        "description": "Edit an existing file by replacing old text with new text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "oldString": {"type": "string"},
                "newString": {"type": "string"},
            },
            "required": ["path", "oldString", "newString"],
        },
    },
    {
        "name": "Glob",
        "description": "List files matching a glob pattern.",
        "input_schema": {
            "type": "object",
            "properties": {"pattern": {"type": "string"}},
            "required": ["pattern"],
        },
    },
    {
        "name": "Grep",
        "description": "Search file contents using regex.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "path": {"type": "string"},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "WebSearch",
        "description": "Search the web.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "WebFetch",
        "description": "Fetch content from a URL.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
            },
            "required": ["url"],
        },
    },
]


def dispatch_tool(name: str, inp: dict) -> str:
    timeout = inp.get("timeout", 300)
    if name == "Bash":
        result = run_command(inp["command"], timeout=timeout)
    elif name == "Read":
        p = Path(inp["path"])
        if not p.exists():
            return json.dumps({"error": f"{inp['path']} does not exist"})
        return json.dumps({"content": p.read_text()})
    elif name == "Write":
        p = Path(inp["path"])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(inp["content"])
        return json.dumps({"written": inp["path"]})
    elif name == "Edit":
        p = Path(inp["path"])
        if not p.exists():
            return json.dumps({"error": f"{inp['path']} does not exist"})
        old = inp["oldString"]
        new = inp["newString"]
        content = p.read_text()
        if old not in content:
            return json.dumps({"error": f"oldString not found in {inp['path']}"})
        p.write_text(content.replace(old, new, 1))
        return json.dumps({"edited": inp["path"]})
    elif name == "Glob":
        paths = [str(p) for p in Path(".").glob(inp["pattern"])]
        return json.dumps({"files": paths})
    elif name == "Grep":
        import re
        pattern = re.compile(inp["pattern"])
        matches = []
        search_path = Path(inp.get("path", "."))
        for f in search_path.rglob("*") if search_path.is_dir() else [search_path]:
            if f.is_file():
                try:
                    for i, line in enumerate(f.read_text().splitlines(), 1):
                        if pattern.search(line):
                            matches.append(f"{f}:{i}: {line.rstrip()}")
                except Exception:
                    pass
        return json.dumps({"matches": matches})
    elif name == "WebSearch":
        result = run_command(f"echo 'WebSearch not available in this context — use WebFetch or Bash with curl' && echo '{inp['query']}'")
        return json.dumps(result)
    elif name == "WebFetch":
        result = run_command(f"curl -sL '{inp['url']}' 2>/dev/null | head -c 10000 || echo 'WebFetch unavailable'")
        return json.dumps(result)
    else:
        return json.dumps({"error": f"unknown tool: {name}"})
    return json.dumps(result)


def build_system_prompt() -> str:
    return textwrap.dedent("""
        You are a senior developer on the Deepgram examples repository.
        You have full access to the entire repo — read any file, write code,
        run tests, install dependencies, commit changes, push branches.

        Your task is to act on the request from the human who @mentioned you.
        Do exactly what they asked. If something fails, fix it.

        IMPORTANT: Do NOT modify anything under .github/, context7.json, or
        renovate.json — these are infrastructure files.
    """).strip()


def build_user_message() -> str:
    parts = [
        f"@{COMMENTER} mentioned @deepgram-robot on #{ISSUE_NUMBER}:\n\n{COMMENT_BODY}",
        "\n---\n",
        f"Repository: {REPO_SLUG}",
        f"Branch checked out: {BRANCH}",
    ]
    if COMMENT_URL:
        parts.append(f"Comment URL: {COMMENT_URL}")
    if PR_BODY:
        parts.append(f"\n\nPR Description (use as context — contains original issue, extra context, and prior agent state):\n{PR_BODY}")
    if PRIOR_STATE:
        try:
            state = json.loads(PRIOR_STATE)
            parts.append(f"\n\nPrior agent state:\n```json\n{json.dumps(state, indent=2)}\n```")
        except Exception:
            pass
    parts.append(
        "\n\nAct on the request above. When done, post a summary reply on "
        f"#{ISSUE_NUMBER} using:\n\n"
        "```bash\n"
        f"gh issue comment {ISSUE_NUMBER} --repo {REPO_SLUG} --body 'YOUR SUMMARY'\n"
        "```"
    )
    return "\n".join(parts)


def run() -> None:
    system_prompt = build_system_prompt()
    messages = [{"role": "user", "content": build_user_message()}]

    for turn in range(1, 151):
        print(f"Turn {turn}/150")
        response = messages_create(
            model=MODEL,
            max_tokens=8096,
            system=system_prompt,
            tools=TOOLS,
            messages=messages,
        )

        blocks = extract_blocks(response)
        stop_reason = response_stop_reason(response)
        text_content = response_text(response)
        messages.append(wrap_message("assistant", blocks))

        if stop_reason == "end_turn":
            print("Agent stopped — prompting to continue")
            messages.append({"role": "user", "content": "Continue working until the request is complete, then post your summary reply."})
            continue

        if stop_reason not in ("tool_use", "TOOL_CALLS"):
            print(f"Unexpected stop reason: {stop_reason}")
            break

        tool_results = []
        for block in blocks:
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            inp = block.get("input", {})
            block_id = block.get("id", "")
            result = dispatch_tool(name, inp)
            tool_results.append(wrap_tool_result(block_id, result))

        messages.append(wrap_message("user", tool_results))

    print("Turn limit reached")


if __name__ == "__main__":
    run()
