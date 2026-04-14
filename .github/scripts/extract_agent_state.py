#!/usr/bin/env python3
"""
extract_agent_state.py

Reads text from stdin and extracts the JSON payload from a hidden
<!-- agent-state: {...} --> HTML comment.

Prints the JSON string on stdout, or nothing if not found.

Usage:
  echo "some comment body" | python3 .github/scripts/extract_agent_state.py
"""

import re
import sys

text = sys.stdin.read().strip()
m = re.search(r"<!-- agent-state: (\{.*?\}) -->", text, re.DOTALL)
if m:
    print(m.group(1))
