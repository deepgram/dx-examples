#!/usr/bin/env python3
"""
Planning phase: given an issue body, available secret names, and the list of
existing examples, uses an AI model to determine:
  - action: "new" or "modify"
  - the target runtime / Docker image
  - the example slug
  - workspace_subdir: resolved directory name (NNN-slug for new, existing dir for modify)
  - which secrets the example will need

Outputs a JSON object to stdout. The workflow reads this to configure
the build step.
"""

import json
import os
import re
import sys
from pathlib import Path

from llm import messages_create, response_text

AVAILABLE_SECRET_NAMES = os.environ["SECRET_NAMES"].split(",")
ISSUE_BODY = os.environ["ISSUE_BODY"]
ISSUE_NUMBER = os.environ["ISSUE_NUMBER"]
EXAMPLE_NUMBER = os.environ["EXAMPLE_NUMBER"]
EXAMPLES_DIR = os.environ.get("EXAMPLES_DIR", "examples")

# Map of runtime identifiers to Docker images
RUNTIME_IMAGES = {
    "node": "node:22-bookworm",
    "typescript": "node:22-bookworm",
    "python": "python:3.12-bookworm",
    "go": "golang:1.23-bookworm",
    "java": "eclipse-temurin:21-jdk-bookworm",
    "rust": "rust:1.78-bookworm",
    "dotnet": "mcr.microsoft.com/dotnet/sdk:8.0",
    "dart": "dart:3.3",
    "kotlin": "eclipse-temurin:21-jdk-bookworm",
    "swift": "swift:5.10",
}

SYSTEM_PROMPT = """
You are helping plan an automated build of a code example for the Deepgram examples repository.

Each run builds EXACTLY ONE example. If the issue mentions multiple examples or languages,
pick the most impactful one — prefer Python over JavaScript when both are mentioned.

Given an issue body, a list of existing example directories, and available secret names, return a JSON object with:

- "action": "new" if this is a brand-new example, or "modify" if the issue is asking to update, fix, extend, or add to an existing example
- "runtime": one of: node, typescript, python, go, java, rust, dotnet, dart, kotlin, swift
- "slug": a short kebab-case identifier
  - For "new": descriptive slug, e.g. "twilio-voice-agent-node" or "fastapi-transcription-python"
  - For "modify": the slug portion of the existing directory, e.g. "fastapi-transcription-python" (without the NNN- prefix)
- "existing_dir": (only when action is "modify") the full directory name to modify, e.g. "020-fastapi-transcription-python". Must exactly match one of the existing directories listed.
- "required_secrets": array of secret names from the available list that this example needs. Always include DEEPGRAM_API_KEY. Include ANTHROPIC_API_KEY only if the example uses an LLM. Include partner secrets only if relevant.

Return ONLY a single JSON object. No array. No explanation. No markdown fences.
""".strip()


def read_existing_examples() -> list[str]:
    """Return sorted list of existing example directory names."""
    p = Path(EXAMPLES_DIR)
    if not p.exists():
        return []
    return sorted(
        entry.name for entry in p.iterdir()
        if entry.is_dir() and re.match(r"^\d{3}-", entry.name)
    )


def main() -> None:
    existing_examples = read_existing_examples()

    # Planner uses a fast/cheap model — override MODEL for this step
    plan_model = os.environ.get("LLM_PLAN_MODEL", MODEL)

    user_message = f"""
Issue #{ISSUE_NUMBER}:

{ISSUE_BODY}

---

Existing examples in the repository:
{json.dumps(existing_examples, indent=2) if existing_examples else '(none yet)'}

Available secret names:
{json.dumps(AVAILABLE_SECRET_NAMES, indent=2)}

Return the JSON plan object.
""".strip()

    response = messages_create(
        model=plan_model,
        max_tokens=512,
        system=SYSTEM_PROMPT,
        tools=[],
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response_text(response).strip()

    # Strip markdown fences if the model added them anyway
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    plan = json.loads(raw)

    # If model returned an array despite instructions, take the first element
    if isinstance(plan, list):
        if not plan:
            raise ValueError("Planner returned an empty array — cannot proceed")
        plan = plan[0]

    # Validate and enrich
    action = plan.get("action", "new")
    runtime = plan.get("runtime", "node")
    plan["docker_image"] = RUNTIME_IMAGES.get(runtime, RUNTIME_IMAGES["node"])
    plan["example_number"] = EXAMPLE_NUMBER

    # Resolve workspace_subdir — the single source of truth for directory path
    if action == "modify":
        existing_dir = plan.get("existing_dir", "")
        if existing_dir not in existing_examples:
            # Planner hallucinated or matched wrong — fall back to new
            plan["action"] = "new"
            plan["workspace_subdir"] = f"{EXAMPLE_NUMBER}-{plan.get('slug', 'example')}"
        else:
            plan["workspace_subdir"] = existing_dir
    else:
        plan["action"] = "new"
        plan["workspace_subdir"] = f"{EXAMPLE_NUMBER}-{plan.get('slug', 'example')}"

    # Always ensure DEEPGRAM_API_KEY is included
    required = plan.get("required_secrets", [])
    if "DEEPGRAM_API_KEY" not in required:
        required.insert(0, "DEEPGRAM_API_KEY")

    # Filter to only secrets that actually exist in CI
    plan["required_secrets"] = [s for s in required if s in AVAILABLE_SECRET_NAMES]

    print(json.dumps(plan))


if __name__ == "__main__":
    main()
