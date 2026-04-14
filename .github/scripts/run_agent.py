#!/usr/bin/env python3
"""
Agentic build loop for deepgram/examples.

Runs Claude in a tool-use loop inside a Docker sandbox until the example
is built, tested, and passing. No turn limit — keeps going until AGENT_DONE.
"""

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any

import anthropic

from agent_state import WorkingMemory, RuleEngine, check_constraints

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL = "claude-opus-4-5"
WORKSPACE = Path(os.environ["WORKSPACE_DIR"])  # e.g. /repo/examples/NNN-slug
EXAMPLE_NUMBER = os.environ["EXAMPLE_NUMBER"]
EXAMPLE_SLUG = os.environ["EXAMPLE_SLUG"]
WORKSPACE_ACTION = os.environ.get("WORKSPACE_ACTION", "new")  # "new" or "modify"
DOCKER_IMAGE = os.environ["DOCKER_IMAGE"]
ISSUE_BODY = os.environ["ISSUE_BODY"]
ISSUE_NUMBER = os.environ["ISSUE_NUMBER"]
CONTAINER_NAME = f"example-sandbox-{ISSUE_NUMBER}"
BUILD_LOG = Path(os.environ.get("BUILD_LOG", "/tmp/build-log.md"))
MAX_TURNS = int(os.environ.get("MAX_TURNS", "75"))

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# ---------------------------------------------------------------------------
# Docker helpers
# ---------------------------------------------------------------------------

def start_container() -> None:
    """Start the sandbox container with workspace mounted and env file injected."""
    subprocess.run([
        "docker", "run", "-d",
        "--name", CONTAINER_NAME,
        "--env-file", "/tmp/sandbox.env",
        # context7 and deepgram CLI need outbound network
        "--network", "bridge",
        # cap resources
        "--memory", "2g",
        "--cpus", "2",
        "-v", f"{WORKSPACE}:/workspace",
        "-w", "/workspace",
        DOCKER_IMAGE,
        # keep alive
        "tail", "-f", "/dev/null",
    ], check=True)
    log("Container started", level="system")


def stop_container() -> None:
    subprocess.run(["docker", "rm", "-f", CONTAINER_NAME],
                   capture_output=True)


def exec_in_container(command: str, timeout: int = 300) -> dict[str, Any]:
    """Run a shell command inside the container, return stdout/stderr/exit_code."""
    result = subprocess.run(
        ["docker", "exec", CONTAINER_NAME, "bash", "-c", command],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.returncode,
    }


# ---------------------------------------------------------------------------
# File helpers (operate on workspace, not inside container)
# ---------------------------------------------------------------------------

def write_file(path: str, content: str) -> dict[str, Any]:
    # Write to a temp file on the host, then use docker cp to put it in the
    # container. This avoids PermissionError when the container (running as root)
    # has already created parent directories that the host runner cannot write into.
    import tempfile as _tmp
    with _tmp.NamedTemporaryFile(mode="w", suffix=".tmp", delete=False) as tf:
        tf.write(content)
        tmp_path = tf.name
    try:
        container_path = f"/workspace/{path}"
        # Ensure parent directory exists inside the container
        mkdir_result = exec_in_container(f"mkdir -p \"$(dirname '{container_path}')\"")
        if mkdir_result["exit_code"] != 0:
            return {"error": f"mkdir failed: {mkdir_result['stderr'][:200]}"}
        cp_result = subprocess.run(
            ["docker", "cp", tmp_path, f"{CONTAINER_NAME}:{container_path}"],
            capture_output=True, text=True,
        )
        if cp_result.returncode != 0:
            return {"error": f"docker cp failed: {cp_result.stderr[:200]}"}
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    return {"written": path, "bytes": len(content)}


def read_file(path: str) -> dict[str, Any]:
    full = WORKSPACE / path
    if not full.exists():
        return {"error": f"{path} does not exist"}
    return {"content": full.read_text()}


def list_files(path: str = ".") -> dict[str, Any]:
    full = WORKSPACE / path
    if not full.exists():
        return {"error": f"{path} does not exist"}
    files = [str(p.relative_to(WORKSPACE)) for p in sorted(full.rglob("*")) if p.is_file()]
    return {"files": files}


# ---------------------------------------------------------------------------
# Tool definitions (passed to Claude)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "run_command",
        "description": (
            "Run a shell command inside the Docker sandbox. "
            "Use this to install dependencies, run tests, start servers, "
            "use the deepgram CLI, call context7, run Playwright, etc. "
            "Long-running processes should be backgrounded with & and then "
            "tested with a follow-up command. "
            "Timeout is 300s by default but you can specify longer for heavy installs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to run"},
                "timeout": {"type": "integer", "description": "Timeout in seconds (default 300)"},
            },
            "required": ["command"],
        },
    },
    {
        "name": "write_file",
        "description": "Write or overwrite a file in the example workspace. Path is relative to the workspace root.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative file path, e.g. src/index.ts"},
                "content": {"type": "string", "description": "Full file content"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "read_file",
        "description": "Read a file from the example workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative file path"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_files",
        "description": "List all files in a directory within the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative directory path (default '.')"},
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------

def dispatch_tool(name: str, input_: dict) -> str:
    if name == "run_command":
        result = exec_in_container(
            input_["command"],
            timeout=input_.get("timeout", 300),
        )
        log_tool_result(name, input_["command"], result)
        return json.dumps(result)

    elif name == "write_file":
        result = write_file(input_["path"], input_["content"])
        log(f"wrote {input_['path']}", level="file")
        return json.dumps(result)

    elif name == "read_file":
        result = read_file(input_["path"])
        return json.dumps(result)

    elif name == "list_files":
        result = list_files(input_.get("path", "."))
        return json.dumps(result)

    else:
        return json.dumps({"error": f"unknown tool: {name}"})


# ---------------------------------------------------------------------------
# Build log
# ---------------------------------------------------------------------------

def log(message: str, level: str = "info") -> None:
    prefix = {"info": "ℹ️", "system": "⚙️", "file": "📄", "error": "❌"}.get(level, "•")
    line = f"{prefix} {message}\n"
    sys.stdout.write(line)
    sys.stdout.flush()
    with BUILD_LOG.open("a") as f:
        f.write(line)


def log_tool_result(tool: str, command: str, result: dict) -> None:
    with BUILD_LOG.open("a") as f:
        f.write(f"\n### `{tool}`: `{command}`\n")
        f.write(f"**exit**: `{result['exit_code']}`\n")
        if result.get("stdout"):
            f.write(f"```\n{result['stdout'][:4000]}\n```\n")
        if result.get("stderr"):
            f.write(f"**stderr**:\n```\n{result['stderr'][:2000]}\n```\n")


# ---------------------------------------------------------------------------
# Install agent prerequisites inside the container
# ---------------------------------------------------------------------------

BOOTSTRAP_SCRIPT = """
set -e

# Deepgram CLI
if ! command -v deepgram &> /dev/null; then
  curl -fsSL https://raw.githubusercontent.com/deepgram/deepgram-cli/main/install.sh | sh
fi

# context7 CLI (npx-based, no install needed but ensure node is present)
# Playwright (Python)
pip install playwright --quiet 2>/dev/null || true
playwright install chromium --with-deps 2>/dev/null || true

echo "Bootstrap complete"
"""

def bootstrap_container() -> None:
    log("Bootstrapping container tools...")
    result = exec_in_container(BOOTSTRAP_SCRIPT, timeout=600)
    if result["exit_code"] != 0:
        log(f"Bootstrap warning (non-fatal): {result['stderr'][:500]}", level="error")


# ---------------------------------------------------------------------------
# Main agent loop
# ---------------------------------------------------------------------------

def build_system_prompt() -> str:
    prompt_path = Path(__file__).parent / "system_prompt.md"
    base = prompt_path.read_text()

    # WORKSPACE is examples/{NNN}-{slug}/ (or existing dir for modify)
    # .parent is the examples/ directory
    examples_dir = WORKSPACE.parent
    existing = sorted(p.name for p in examples_dir.iterdir()
                      if p.is_dir()) if examples_dir.exists() else []

    workspace_dir_name = WORKSPACE.name  # NNN-slug (new) or existing dir (modify)

    modification_context = ""
    if WORKSPACE_ACTION == "modify":
        modification_context = textwrap.dedent(f"""

    ---

    ## IMPORTANT: This is a MODIFICATION task

    You are updating an **existing** example at `examples/{workspace_dir_name}/`.
    The workspace already contains the existing code.

    Before making any changes:
    1. Use `list_files` to understand the current structure
    2. Use `read_file` to read key files (README, BLOG.md, tests, src/)
    3. Understand exactly what the issue is asking you to change
    4. Make targeted changes — preserve what works, fix/extend what needs it
    5. Run existing tests first to confirm the baseline, then update as needed
    """)

    return base + modification_context + textwrap.dedent(f"""

    ---

    ## Runtime context

    - Action: `{WORKSPACE_ACTION}` ({'creating new' if WORKSPACE_ACTION == 'new' else 'modifying existing'} example)
    - Example number: `{EXAMPLE_NUMBER}`
    - Example slug: `{EXAMPLE_SLUG}`
    - Docker image: `{DOCKER_IMAGE}`
    - Workspace root: `/workspace` (this IS the example directory — `examples/{workspace_dir_name}/` on the host)
    - Existing examples in repo: {', '.join(existing) if existing else 'none yet'}

    The workspace is mounted at `/workspace` inside the container.
    The container working directory is already set to `/workspace`.
    All file paths in `write_file`, `read_file`, and `list_files` tool calls are relative
    to `/workspace` — i.e. directly inside the example directory.

    Write `src/main.py`, not `examples/{workspace_dir_name}/src/main.py`.
    Write `README.md`, not `examples/{workspace_dir_name}/README.md`.
    """)


def run_agent() -> None:
    system_prompt = build_system_prompt()

    user_message = textwrap.dedent(f"""
    Build the following example for the Deepgram examples repository.

    Issue #{ISSUE_NUMBER}:

    {ISSUE_BODY}

    ---

    Steps:
    1. Check context7 docs for the relevant SDK/library before writing any code
    2. Use the deepgram CLI to verify API connectivity early
    3. Implement the example following all repo conventions
    4. Install dependencies and run tests
    5. Fix anything that fails and re-run
    6. Keep going until tests exit 0
    7. Output AGENT_DONE when complete
    """).strip()

    messages = [{"role": "user", "content": user_message}]
    turn = 0

    # Symbolic components — working memory and rule engine
    wm = WorkingMemory()
    engine = RuleEngine(wm, MAX_TURNS)

    log(f"Starting agent loop for example {EXAMPLE_NUMBER}-{EXAMPLE_SLUG} (max turns: {MAX_TURNS})")

    while True:
        turn += 1
        wm.turn = turn

        if turn > MAX_TURNS:
            msg = (
                f"AGENT_TURN_LIMIT_EXCEEDED: reached {MAX_TURNS} turns without completing. "
                "The build did not reach a passing state. Review the build log for the last known state."
            )
            log(msg, level="error")
            with BUILD_LOG.open("a") as f:
                f.write(f"\n---\n\n## ❌ Turn limit exceeded\n\n{msg}\n")
            sys.exit(1)

        log(f"Turn {turn}/{MAX_TURNS} — {wm.summary()}")

        response = client.messages.create(
            model=MODEL,
            max_tokens=8096,
            system=system_prompt,
            tools=TOOLS,
            messages=messages,
        )

        # Append assistant response to history
        messages.append({"role": "assistant", "content": response.content})

        # ----------------------------------------------------------------
        # AGENT_DONE detection — symbolic constraint check before accepting
        # ----------------------------------------------------------------
        agent_done = any(
            block.type == "text" and "AGENT_DONE" in block.text
            for block in response.content
        )
        if agent_done:
            violations = check_constraints(WORKSPACE)
            if violations:
                log(
                    f"Constraint checker blocked AGENT_DONE — {len(violations)} violation(s)",
                    level="system",
                )
                with BUILD_LOG.open("a") as f:
                    f.write("\n---\n\n### ⛔ AGENT_DONE rejected by constraint checker\n\n")
                    for v in violations:
                        f.write(f"- {v}\n")
                constraint_msg = (
                    "❌ [CONSTRAINT-CHECKER] `AGENT_DONE` was rejected. "
                    "The following requirements are not yet satisfied:\n\n"
                    + "\n".join(f"- {v}" for v in violations)
                    + "\n\nComplete all of the above, then output `AGENT_DONE` again."
                )
                messages.append({"role": "user", "content": constraint_msg})
                continue
            else:
                log(f"Agent signalled completion after {turn} turns — constraints verified ✓")
                return

        # ----------------------------------------------------------------
        # end_turn without AGENT_DONE — evaluate rules, prompt to continue
        # ----------------------------------------------------------------
        if response.stop_reason == "end_turn":
            log("Agent stopped without AGENT_DONE — prompting to continue", level="error")
            firings = engine.evaluate([])
            rule_injections = (
                "\n\n" + "\n".join(f.message for f in firings)
                if firings else ""
            )
            messages.append({
                "role": "user",
                "content": (
                    "Tests have not passed yet. Continue working until they do, "
                    "then output AGENT_DONE." + rule_injections
                ),
            })
            continue

        if response.stop_reason != "tool_use":
            log(f"Unexpected stop reason: {response.stop_reason}", level="error")
            break

        # ----------------------------------------------------------------
        # Process tool calls — update working memory after each dispatch
        # ----------------------------------------------------------------
        tool_results = []
        raw_results: list[dict] = []

        for block in response.content:
            if block.type != "tool_use":
                continue
            result_str = dispatch_tool(block.name, block.input)
            result_dict = json.loads(result_str)

            # Update symbolic working memory
            wm.update_from_tool_result(block.name, block.input, result_dict)
            raw_results.append(result_dict)

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result_str,
            })

        # ----------------------------------------------------------------
        # Forward-chain rules over this turn's results
        # Inject firing messages as a text block after tool_results
        # ----------------------------------------------------------------
        firings = engine.evaluate(raw_results)
        if firings:
            rule_text = "\n".join(f.message for f in firings)
            log(f"Rules fired: {[f.rule_id for f in firings]}", level="system")
            tool_results.append({"type": "text", "text": rule_text})

        messages.append({"role": "user", "content": tool_results})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    BUILD_LOG.write_text(f"# Build log: example {EXAMPLE_NUMBER}-{EXAMPLE_SLUG}\n\n")
    WORKSPACE.mkdir(parents=True, exist_ok=True)

    try:
        start_container()
        bootstrap_container()
        run_agent()
    except KeyboardInterrupt:
        log("Interrupted", level="error")
        sys.exit(1)
    finally:
        stop_container()
