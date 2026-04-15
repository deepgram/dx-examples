#!/usr/bin/env python3
"""
filter_secrets.py

Reads the full secrets JSON blob and a list of required secret names,
writes KEY=VALUE lines to stdout suitable for `docker run --env-file`.

Usage:
  python filter_secrets.py --required NAME1,NAME2 --secrets-json '{"NAME1":"val",...}'
"""

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--required", required=True, help="Comma-separated secret names")
    parser.add_argument("--secrets-json", required=True, help="Full secrets as JSON string")
    args = parser.parse_args()

    required = {k.strip() for k in args.required.split(",") if k.strip()}

    try:
        secrets = json.loads(args.secrets_json)
    except json.JSONDecodeError as e:
        print(f"Failed to parse secrets JSON: {e}", file=sys.stderr)
        sys.exit(1)

    written = 0
    for key, value in secrets.items():
        if key not in required:
            continue
        safe_value = str(value).replace("\n", "\\n").replace("\r", "")
        print(f"{key}={safe_value}")
        written += 1

        if key == "LLM_API_KEY":
            print(f"OPENAI_API_KEY={safe_value}")
            written += 1

    if "OPENAI_API_KEY" in required and "LLM_API_KEY" in secrets and "OPENAI_API_KEY" not in secrets:
        safe_value = str(secrets["LLM_API_KEY"]).replace("\n", "\\n").replace("\r", "")
        print(f"OPENAI_API_KEY={safe_value}")
        written += 1

    missing = required - set(secrets.keys())
    if missing:
        print(f"Warning: requested secrets not found: {', '.join(sorted(missing))}", file=sys.stderr)

    print(f"Wrote {written}/{len(required)} secrets to env file", file=sys.stderr)


if __name__ == "__main__":
    main()
