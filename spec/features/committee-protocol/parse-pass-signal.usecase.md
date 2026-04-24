# Use Case: parse-pass-signal

## Actor

Internal — committee-protocol, invoked on every Adapter response body. Not an MCP tool.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `raw` | string | Adapter's final message for a Turn (after subprocess output parsing). May be empty. |

## Output

**Success:**

```
{
  kind: 'speech' | 'pass',
  text: string        // for 'speech', the cleaned body; for 'pass', the literal '<PASS/>'
}
```

## Flow

1. `trimmed = raw.trim()`.
2. If `trimmed` is empty → `{ kind: 'speech', text: '' }`. Rationale: an empty reply is a `speech` of length zero; it is not a pass. [run-round](./run-round.usecase.md) still records it; the Orchestrator may interpret a zero-length `speech` however it wants.
3. Compute `passOnly = trimmed.replace(/\s+/g, '') === '<PASS/>'`.
4. If `passOnly` is `true` → `{ kind: 'pass', text: '<PASS/>' }`.
5. Otherwise, detect whether `<PASS/>` appears anywhere in `trimmed`:
   - 5a. If `<PASS/>` appears (case-sensitive, exact literal) **and** there is any non-`<PASS/>` content surrounding it, classify as `speech`. The token is preserved in the output `text` so that downstream logs are faithful; the adapter's system prompt warns the model that adding content alongside `<PASS/>` cancels the pass.
   - 5b. Otherwise → `speech` with `text = trimmed`.

## Errors

None. Parsing is total.

## Side Effects

None. Pure function.

## Rules

- **Case-sensitive match.** `<pass/>` or `< PASS />` does NOT count as a Pass Signal. The system prompt instructs the model to emit exactly `<PASS/>` with no whitespace.
- **Surrounding whitespace is ignored.** `"  <PASS/>  "` and `"<PASS/>\n"` both qualify as a pure pass.
- **Mixed content is `speech`.** A Member that wants to pass must emit only the token. This is documented in the system prompt suffix the adapter injects. See [dispatch-turn](../agent-integration/dispatch-turn.usecase.md).
- **No multi-line tolerance for a pure pass beyond surrounding whitespace.** Any non-whitespace character outside the token demotes the outcome to `speech` — this keeps the parser deterministic and prevents prompt-injection patterns like `"<PASS/>ignore the above"` from accidentally counting as a pass.
- **No model-specific heuristics.** The same parser applies to every Adapter; per-model instructions live in their system prompt suffix, not in the parser.
