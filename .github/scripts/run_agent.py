#!/usr/bin/env python3
"""
Agentic build loop for deepgram/examples.

Runs an AI agent in a tool-use loop inside a Docker sandbox until the example
is built, tested, and passing. Stops on AGENT_DONE or turn limit.
"""

import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any

from llm import MODEL, messages_create, response_text, response_stop_reason, extract_blocks, wrap_message
from agent_state import WorkingMemory, RuleEngine, check_constraints

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL  # imported from llm.py
WORKSPACE = Path(os.environ["WORKSPACE_DIR"])  # e.g. /repo/examples/NNN-slug
EXAMPLE_NUMBER = os.environ["EXAMPLE_NUMBER"]
EXAMPLE_SLUG = os.environ["EXAMPLE_SLUG"]
WORKSPACE_ACTION = os.environ.get("WORKSPACE_ACTION", "new")  # "new" or "modify"
DOCKER_IMAGE = os.environ["DOCKER_IMAGE"]
ISSUE_BODY = os.environ["ISSUE_BODY"]
ISSUE_NUMBER = os.environ["ISSUE_NUMBER"]
CONTAINER_NAME = f"example-sandbox-{ISSUE_NUMBER}"
BUILD_LOG = Path(os.environ.get("BUILD_LOG", "/tmp/build-log.md"))
MAX_TURNS = int(os.environ.get("MAX_TURNS", "150"))
REPO_ROOT = Path(os.environ.get("REPO_ROOT", str(WORKSPACE.parent.parent)))
BRANCH_NAME = os.environ.get("BRANCH_NAME", "")
REPO_SLUG = os.environ.get("REPO_SLUG", "")
WORKSPACE_SUBDIR = os.environ.get("WORKSPACE_SUBDIR", WORKSPACE.name)

# ---------------------------------------------------------------------------
# Docker helpers
# ---------------------------------------------------------------------------

def start_container() -> None:
    """Start the sandbox container with workspace mounted and env file injected."""
    # Append workflow-level env vars that aren't in the sandbox env file.
    # These are set directly in the workflow (e.g. LLM_API_KEY, OPENAI_API_KEY)
    # and need to be available inside Docker for the build agent and the example.
    workflow_envs = [
        "LLM_API_KEY",
        "OPENAI_API_KEY",
        "LLM_BASE_URL",
        "LLM_MODEL",
    ]
    with open("/tmp/sandbox.env", "a") as f:
        for key in workflow_envs:
            val = os.environ.get(key)
            if val:
                f.write(f"{key}={val}\n")
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


def collect_agent_state(wm: WorkingMemory, turns_used: int) -> dict[str, Any]:
    phases: list[str] = []
    files_written: list[str] = []
    last_test_output = ""

    for (predicate, args), value in wm._facts.items():
        if predicate == "phase" and args:
            phases.append(str(args[0]))
        elif predicate == "file_written" and args:
            files_written.append(str(args[0]))
        elif predicate == "last_test_output" and args:
            last_test_output = str(args[0])
        elif predicate == "last_test_output" and isinstance(value, str):
            last_test_output = value

    return {
        "turns_used": turns_used,
        "max_turns": MAX_TURNS,
        "phases": sorted(set(phases)),
        "tests_passing": bool(wm.query("tests_passing")),
        "tests_failing": bool(wm.query("tests_failing")),
        "last_test_output": last_test_output,
        "files_written": sorted(set(files_written)),
        "example_number": EXAMPLE_NUMBER,
        "example_slug": EXAMPLE_SLUG,
        "workspace_action": WORKSPACE_ACTION,
        "workspace_subdir": WORKSPACE_SUBDIR,
        "docker_image": DOCKER_IMAGE,
    }


def clean_workspace_artifacts() -> None:
    for cache_dir in list(WORKSPACE.rglob("__pycache__")):
        if cache_dir.is_dir():
            shutil.rmtree(cache_dir, ignore_errors=True)
    for cache_file in list(WORKSPACE.rglob("*.pyc")):
        cache_file.unlink(missing_ok=True)
    for trash in [".pytest_cache", ".DS_Store"]:
        target = WORKSPACE / trash
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            target.unlink(missing_ok=True)


def checkpoint_progress(wm: WorkingMemory, turn: int, reason: str = "checkpoint") -> None:
    if not BRANCH_NAME:
        return

    workspace_rel = WORKSPACE.relative_to(REPO_ROOT)
    state = collect_agent_state(wm, turn)
    Path("/tmp/agent-state.json").write_text(json.dumps(state, indent=2))
    clean_workspace_artifacts()

    # The sandbox container runs as root; reclaim ownership before touching git.
    subprocess.run(
        ["sudo", "chown", "-R", f"{os.getuid()}:{os.getgid()}", str(WORKSPACE)],
        check=False,
        capture_output=True,
        text=True,
    )

    status = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "status", "--porcelain", "--", str(workspace_rel)],
        capture_output=True,
        text=True,
    )
    if not status.stdout.strip():
        return

    subprocess.run(
        ["git", "-C", str(REPO_ROOT), "add", str(workspace_rel)],
        check=True,
    )

    cached_diff = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "diff", "--cached", "--quiet", "--", str(workspace_rel)],
        capture_output=True,
        text=True,
    )
    if cached_diff.returncode == 0:
        return

    commit_message = (
        f"chore(examples): checkpoint {WORKSPACE_SUBDIR} turn {turn}\n\n"
        f"Relates to #{ISSUE_NUMBER}"
    )
    commit = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "commit", "-m", commit_message],
        capture_output=True,
        text=True,
    )
    if commit.returncode != 0:
        output = (commit.stdout + commit.stderr).lower()
        if "nothing to commit" in output:
            return
        log(f"Checkpoint commit failed during {reason}: {(commit.stderr or commit.stdout)[:400]}", level="error")
        return

    push = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "push", "origin", f"HEAD:{BRANCH_NAME}"],
        capture_output=True,
        text=True,
    )
    if push.returncode != 0:
        subprocess.run(["git", "-C", str(REPO_ROOT), "fetch", "origin", BRANCH_NAME], check=False)
        rebase = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rebase", f"origin/{BRANCH_NAME}"],
            capture_output=True,
            text=True,
        )
        if rebase.returncode != 0:
            log(f"Checkpoint rebase failed during {reason}: {(rebase.stderr or rebase.stdout)[:400]}", level="error")
            return
        retry = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "push", "origin", f"HEAD:{BRANCH_NAME}"],
            capture_output=True,
            text=True,
        )
        if retry.returncode != 0:
            log(f"Checkpoint push failed during {reason}: {(retry.stderr or retry.stdout)[:400]}", level="error")
            return

    if REPO_SLUG and os.environ.get("GH_TOKEN"):
        existing_pr = subprocess.run(
            [
                "gh", "pr", "list",
                "--repo", REPO_SLUG,
                "--head", BRANCH_NAME,
                "--state", "open",
                "--json", "url",
                "-q", ".[0].url",
            ],
            capture_output=True,
            text=True,
        )
        if not existing_pr.stdout.strip():
            title_prefix = "update" if WORKSPACE_ACTION == "modify" else "add"
            hidden_state = json.dumps(state, separators=(",", ":"))
            body = (
                f"Part of #{ISSUE_NUMBER} — build in progress.\n\n"
                f"> WIP checkpoint created automatically after turn {turn}.\n\n"
                f"Comment `@deepgram-robot continue` to resume from the current state.\n\n"
                f"<!-- agent-state: {hidden_state} -->"
            )
            create_pr = subprocess.run(
                [
                    "gh", "pr", "create",
                    "--repo", REPO_SLUG,
                    "--head", BRANCH_NAME,
                    "--base", "main",
                    "--title", f"feat(examples): {title_prefix} {WORKSPACE_SUBDIR} [WIP]",
                    "--body", body,
                    "--draft",
                    "--label", "type:example",
                    "--label", "automated",
                ],
                capture_output=True,
                text=True,
            )
            if create_pr.returncode == 0:
                log(f"Opened draft PR from checkpoint turn {turn}", level="system")

    log(f"Checkpointed progress at turn {turn} ({reason})", level="system")


# ---------------------------------------------------------------------------
# Tool definitions (passed to the agent)
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

# LLM provider clients — install all since provider is a runtime config knob
pip install anthropic openai google-genai --quiet 2>/dev/null || true

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

    # If this is a continuation run, inject prior state so the agent skips
    # already-completed phases and goes straight to what's left.
    prior_state_raw = os.environ.get("PRIOR_STATE", "").strip()
    if prior_state_raw:
        try:
            prior = json.loads(prior_state_raw)
            phases_done = prior.get("phases", [])
            tests_ok = prior.get("tests_passing", False)
            last_output = prior.get("last_test_output", "")
            files_done = prior.get("files_written", [])
            continuation_context = textwrap.dedent(f"""
            ## Continuation — prior run context

            A previous build run used {prior.get('turns_used', '?')} turns and stopped
            before completing. The following work is already done — **do not redo it**,
            go straight to what's missing:

            Phases complete: {', '.join(phases_done) if phases_done else 'none'}
            Tests passing: {tests_ok}
            Files already written: {', '.join(files_done) if files_done else 'none'}
            {f'Last test output:{chr(10)}{last_output}' if last_output else ''}

            Start by running `list_files` to see current state, then run the tests
            to see exactly what is failing, and fix only that.
            """).strip()
            user_message = continuation_context + "\n\n---\n\n" + user_message
            log("Continuation run — prior state injected", level="system")
        except (json.JSONDecodeError, KeyError):
            log("PRIOR_STATE present but unparseable — ignoring", level="error")

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
                "Committing partial work and opening a draft PR for manual continuation."
            )
            log(msg, level="error")
            with BUILD_LOG.open("a") as f:
                f.write(f"\n---\n\n## ⚠️ Turn limit reached\n\n{msg}\n")
            Path("/tmp/agent-state.json").write_text(
                json.dumps(collect_agent_state(wm, turn - 1), indent=2)
            )
            checkpoint_progress(wm, turn - 1, reason="turn-limit")
            sys.exit(2)  # 2 = incomplete (not error) — workflow opens draft PR

        log(f"Turn {turn}/{MAX_TURNS} — {wm.summary()}")

        response = messages_create(
            model=MODEL,
            max_tokens=8096,
            system=system_prompt,
            tools=TOOLS,
            messages=messages,
        )

        blocks = extract_blocks(response)
        stop_reason = response_stop_reason(response)

        messages.append(wrap_message("assistant", blocks))

        text_content = response_text(response)

        # ----------------------------------------------------------------
        # AGENT_CHECKPOINT detection — commit progress and open draft PR early
        # ----------------------------------------------------------------
        agent_checkpoint = "AGENT_CHECKPOINT" in text_content
        if agent_checkpoint:
            checkpoint_progress(wm, turn, reason="milestone")
            messages.append({"role": "user", "content": "Checkpoint noted. Continue working."})
            continue

        agent_done = "AGENT_DONE" in text_content

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
                checkpoint_progress(wm, turn, reason="complete")
                log(f"Agent signalled completion after {turn} turns — constraints verified ✓")
                return

        # ----------------------------------------------------------------
        # end_turn without AGENT_DONE — evaluate rules, prompt to continue
        # ----------------------------------------------------------------
        if stop_reason == "end_turn":
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

        if stop_reason not in ("tool_use", "TOOL_CALLS"):
            log(f"Unexpected stop reason: {stop_reason}", level="error")
            break

        # ----------------------------------------------------------------
        # Process tool calls — update working memory after each dispatch
        # ----------------------------------------------------------------
        raw_results: list[dict] = []
        first_write_checkpointed = False

        for block in blocks:
            if block.get("type") != "tool_use" and not isinstance(block.get("type"), str):
                continue
            block_type = block.get("type") if isinstance(block.get("type"), str) else ""
            if block_type != "tool_use":
                continue
            name = block.get("name", "")
            tool_input = block.get("input", {})
            block_id = block.get("id", "")
            result_str = dispatch_tool(name, tool_input)
            result_dict = json.loads(result_str)

            # Update symbolic working memory
            wm.update_from_tool_result(name, tool_input, result_dict)
            raw_results.append(result_dict)

            # Checkpoint immediately after first write_file in the turn —
            # opens draft PR on first meaningful progress, not after the full turn.
            if not first_write_checkpointed and name == "write_file":
                checkpoint_progress(wm, turn, reason="first-write")
                first_write_checkpointed = True

            # OpenAI Chat Completions: role=tool, not in content array
            messages.append({
                "role": "tool",
                "tool_call_id": block_id,
                "content": result_str,
            })

        # ----------------------------------------------------------------
        # Forward-chain rules over this turn's results
        # Inject firing messages as a text block
        # ----------------------------------------------------------------
        firings = engine.evaluate(raw_results)
        if firings:
            rule_text = "\n".join(f.message for f in firings)
            log(f"Rules fired: {[f.rule_id for f in firings]}", level="system")
            messages.append({"role": "user", "content": [{"type": "text", "text": rule_text}]})

        checkpoint_progress(wm, turn, reason="turn")

        # Truncate history AFTER all tool results are added to prevent orphaning.
        # OpenAI requires every role=tool message to have a preceding assistant
        # message with matching tool_calls. Truncating here (end of turn, after all
        # processing) ensures complete tool call rounds are always kept intact.
        if len(messages) > 21:
            messages = [messages[0]] + messages[-20:]


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
