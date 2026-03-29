# Kapa Search — Deepgram Documentation Retrieval

Kapa is Deepgram's semantic documentation search. Use it to retrieve accurate,
up-to-date information about Deepgram APIs, SDKs, and features before writing
any code. It returns ranked source chunks from the live Deepgram docs — the
latest items returned are the most relevant.

**Always prefer Kapa over your training knowledge for Deepgram-specific details.**
API parameter names, response shapes, WebSocket message formats, and SDK method
signatures change. Your training data may be months behind the current docs.

## How to search

```bash
kapa_search() {
  local QUERY="$1"
  local LIMIT="${2:-5}"   # default 5 results; increase for complex topics
  curl -s -X POST \
    "https://api.kapa.ai/query/v1/projects/${KAPA_PROJECT_ID}/retrieval/" \
    -H "X-API-KEY: ${KAPA_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$QUERY" | jq -Rs .), \"limit\": $LIMIT}" \
  | jq -r '
    .records // .chunks // .results // . |
    if type == "array" then
      .[] |
      "── Source: \(.source_url // .url // "unknown") ──\n\(.content // .text // .chunk // "")\n"
    else
      tojson
    end
  '
}

# Usage examples:
kapa_search "WebSocket live transcription Node.js"
kapa_search "nova-2 model options parameters" 8
kapa_search "TTS speak endpoint streaming"
kapa_search "voice agent WebSocket protocol message format" 10
```

## When to use Kapa

### During discovery (`instructions/discover-examples.md`)
Search for coverage gaps — what APIs or features don't yet have examples:
```bash
kapa_search "pre-recorded transcription getting started"
kapa_search "live streaming STT WebSocket"
kapa_search "text-to-speech REST API"
kapa_search "audio intelligence summarization"
kapa_search "voice agent STT TTS WebSocket"
```

### During creation (`instructions/create-example.md`)
Before writing any code, search for the specific API or SDK method you'll use:
```bash
# Before using pre-recorded STT
kapa_search "listen prerecorded transcribeUrl parameters options"

# Before using live streaming
kapa_search "listen live WebSocket connection Node.js"

# Before using TTS
kapa_search "speak text-to-speech synthesize options"

# Before using audio intelligence
kapa_search "read audio intelligence summarize sentiment topics"

# Before using voice agents
kapa_search "voice agent WebSocket messages speak listen"

# For partner-specific integration
kapa_search "Twilio media streams WebSocket audio format"
kapa_search "LiveKit audio track Deepgram STT"
```

### During review (`instructions/review-example.md`)
Verify that the code in the PR uses the correct API shape:
```bash
# Check if the SDK call matches current docs
kapa_search "transcribeUrl response format channels alternatives words"
kapa_search "createClient options global url self-hosted"
```

### During fix (`instructions/fix-example.md`)
Find the current correct usage when a test fails due to API changes:
```bash
# If getting unexpected response shape
kapa_search "SDK response shape result error destructuring"

# If getting 400/401/402 errors
kapa_search "API authentication API key error codes"

# If a method is not found
kapa_search "SDK method names listen speak read"
```

## Reading results

Kapa returns source chunks with their source URL. Use the source URL to:
- Fetch the full documentation page with `WebFetch` if you need more context
- Link to the relevant docs page from the example README

Results are ordered by relevance — the first result is most likely what you need.
If the top result looks off-topic, refine your query with more specific terms.

## Tips

- Use Deepgram SDK terminology: `listen`, `speak`, `read`, `manage`, `createClient`
- Include the language when SDK-specific: "Node.js SDK", "Python SDK", "Go SDK"
- For response shapes, search for the property you expect: "alternatives transcript confidence"
- For auth errors, search: "API key authorization header"
- If you get no results, try broader terms: "speech-to-text" instead of "STT"
