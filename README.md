# ChatGPT Conversation Extractor

[Русская версия](README_RU.md)

A small browser userscript for exporting the current active branch of a ChatGPT conversation without relying on Ctrl+A / Ctrl+C, DOM transcript scraping, scrolling, or Print/PDF.

Some users of very long ChatGPT conversations have reported incomplete copy/export behavior and other long-conversation issues. This project is a practical workaround for users who need a structured local export of one current conversation.

> **Unofficial project:** This project is not affiliated with or endorsed by OpenAI. It uses internal, undocumented ChatGPT web endpoints that may change at any time.

- Version: **0.2.0 public release candidate**
- Last tested: **2026-08-09**
- Scope: one conversation currently open on `https://chatgpt.com/`

## What it exports

A successful export downloads three files created from one conversation JSON snapshot.

### Markdown (`.md`)

The human-readable current active conversation branch. It contains:

- visible User messages;
- visible Assistant messages;
- timestamps when available;
- attachment names next to the corresponding message.

It does not intentionally include system, tool, internal-routing, thoughts, reasoning recap, or context nodes.

### Raw JSON (`.json`)

The raw conversation JSON returned by ChatGPT. It may contain considerably more information than the Markdown file, including:

- the conversation tree and mapping;
- `current_node`;
- message IDs and parent/child relationships;
- timestamps and metadata;
- attachment IDs, filenames, and MIME information;
- internal tool-call and tool-result nodes;
- search and file-processing results;
- portions of file text if ChatGPT previously loaded that text into a tool result;
- other backend metadata returned by ChatGPT.

Raw JSON is **not a backup of the original uploaded files**. Images, ZIP files, and other binary attachments are not bundled into the JSON merely because they were attached to the conversation. The JSON may contain reasoning-related metadata or recap/internal nodes returned by ChatGPT; it is not marketed as a guaranteed export of a private hidden chain of thought.

> **Privacy warning:** Raw JSON can contain substantially more internal conversation metadata than the Markdown transcript. Inspect it before sharing or uploading it publicly.

### Integrity report (`.integrity.txt`)

This is a structural validation report, not another copy of the chat. It includes counters such as:

- total nodes in the mapping;
- nodes in the active branch;
- visible User and Assistant messages;
- attachments found;
- broken parent links;
- cycles and duplicate node visits;
- structural `PASS` or `FAIL`.

The number of Assistant messages does not have to equal the number of User messages. A single user request can sometimes create multiple visible Assistant messages or status messages.

## Installation for beginners

The primary, physically tested installation route is **Violentmonkey**. Violentmonkey is a browser extension/userscript manager that runs small user scripts on selected websites.

1. Install Violentmonkey from the official browser extension store.
2. Open Violentmonkey.
3. Create a new userscript.
4. Delete the complete default template.
5. Open `dist/chatgpt-conversation-extractor.user.js` from this project folder.
6. Copy the complete file, including the userscript header.
7. Paste it into the Violentmonkey editor.
8. Save the userscript.
9. Make sure the script toggle is enabled.
10. Open or refresh an actual ChatGPT conversation.
11. Find the **Export chat** button to the left of the message composer.

If you enable or disable the userscript while ChatGPT is already open, refresh the ChatGPT page for the change to take effect.

Tampermonkey is expected to be compatible with the standard userscript metadata and browser APIs used here, but it has not been physically verified by the project owner.

Never paste a ChatGPT access token or cookies into the userscript. The script obtains the current web session information through the already signed-in ChatGPT tab.

## Usage

1. Open the ChatGPT conversation you want to export.
2. Click **Export chat**.
3. Wait for the result panel to show `PASS` or `FAIL`.
4. Your browser downloads the available export files. It may ask for permission to download multiple files.
5. Click **Hide result** to close the result panel.
6. Click **Export chat** again whenever you want a fresh snapshot.

On structural `PASS`, the browser downloads Markdown, raw JSON, and integrity report. On structural `FAIL`, the script acts fail-closed: it keeps raw JSON and the integrity report available but withholds Markdown rather than presenting an incomplete branch as a complete transcript.

## How it works

- The conversation ID is read from the current `/c/<conversation-id>` URL.
- The script uses the existing signed-in browser session on the exact `chatgpt.com` origin.
- It fetches one raw conversation JSON snapshot.
- It follows `current_node -> parent -> root` and reverses the path to recover the current active branch.
- It validates missing parents, cycles, and duplicate visits.
- It builds all export files from that same snapshot.

The page DOM is used only to place the project button and result panel relative to the ChatGPT composer. Conversation messages are not collected from the DOM.

## Development

Requirements: Node.js 18 or newer. There are no third-party runtime or test dependencies.

```powershell
npm run check
node --check dist/chatgpt-conversation-extractor.user.js
```

On Windows systems where PowerShell blocks `npm.ps1`, use `npm.cmd run check`.

See also:

- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Compatibility](COMPATIBILITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT License. See `LICENSE`.

## Current limitations

- Internal ChatGPT endpoints and response formats can change without notice.
- The project exports one currently open conversation, not all chats or an entire Project.
- Original attachment binaries are not downloaded.
- Team/Business workspace routing is not implemented.
- Structural `PASS` confirms continuity inside the JSON received by the script; it does not prove what may exist elsewhere on the server.
