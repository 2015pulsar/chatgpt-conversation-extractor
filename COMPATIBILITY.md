# Compatibility

Last tested: **2026-08-09**  
Public pre-release: **0.2.0**

## Physically exercised environment

- Windows desktop.
- Firefox + Violentmonkey on Windows.
- Chrome + Violentmonkey on Windows.
- Real export of a small ChatGPT conversation.
- Real export of a large ChatGPT conversation with more than one thousand mapping nodes.
- Expanded and collapsed ChatGPT sidebar states.
- Conversations with attachments.

## Userscript manager

Violentmonkey is the primary documented and physically verified userscript manager.

Tampermonkey is expected to be compatible with the standard userscript metadata and browser APIs used by version 0.2.0, but it has not been physically verified by the project owner. No claim is made that every userscript manager has been tested.

## macOS and Linux

The userscript is browser JavaScript and has no intended Windows filesystem or native-runtime dependency. Its browser architecture is therefore expected to work through a compatible browser/userscript manager on macOS and Linux, but the project owner has not physically verified version 0.2.0 on either operating system.

## Browsers

The code uses current browser APIs including `fetch`, `Blob`, `URL.createObjectURL`, `ResizeObserver`, and standard DOM geometry methods. Exact behavior can still depend on ChatGPT UI changes, userscript-manager behavior, and browser multiple-download policy.

No claim of official OpenAI compatibility or support is made.
