# Privacy

ChatGPT Conversation Extractor is designed for local, manual export.

## Project-side data collection

- The userscript has no telemetry.
- It contains no third-party analytics.
- It sends no data to an external project server.
- Network requests made by version 0.2.0 are limited to the current exact ChatGPT origin as implemented in the source: the session endpoint and the selected conversation endpoint.

## Authentication

The ChatGPT access token obtained for an export operation is:

- used only in memory for that operation;
- not intentionally saved by the userscript;
- not written to exported files;
- not logged by the userscript;
- not displayed in the result panel.

Do not paste tokens or cookies into the script, source code, bug reports, or screenshots.

## Exported data

The Markdown file intentionally contains only the visible User/Assistant transcript of the selected active branch plus attachment names and available timestamps.

The raw JSON can contain substantially more information than the Markdown transcript: internal metadata, identifiers, tool calls/results, search or file-processing results, and attachment metadata. It may include private information that is not obvious from the readable Markdown file.

**Inspect raw JSON before uploading or sharing it publicly. Do not share private conversation JSON casually.**

Raw JSON is not a bundle of the original uploaded binary attachments.

