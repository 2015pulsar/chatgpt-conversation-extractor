# Changelog

## 0.2.0 — Public release candidate

- Export the current active conversation branch from structured ChatGPT conversation JSON.
- Traverse the branch through `current_node` and parent links instead of sorting all nodes by time.
- Create three public outputs: Markdown, raw JSON, and structural integrity report.
- Preserve the exact raw JSON response as the recovery/source artifact.
- Include original attachment filenames next to their corresponding visible messages.
- Normalize duplicate attachment representations.
- Exclude internal-routing Assistant nodes and reasoning/context content from Markdown while preserving them in raw JSON and structural validation.
- Detect broken parent links, cycles, and duplicate node visits.
- Add `Hide result` and repeat export without reloading the page.
- Keep the button aligned with the lower composer action row for tall/multiline composers and attachment previews.
- Position the button relative to the composer for both expanded and collapsed sidebars.
- Reset result state when navigating between conversations in the ChatGPT single-page app.
- MIT License selected for public distribution.
