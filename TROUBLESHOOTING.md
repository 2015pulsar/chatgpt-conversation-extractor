# Troubleshooting

## Export chat button does not appear

- Confirm that the userscript is enabled in Violentmonkey.
- Refresh ChatGPT after installing, updating, enabling, or disabling the script.
- Confirm that the URL is an actual conversation route containing `/c/...`.
- Open an existing conversation rather than the New Chat screen.
- On a very narrow window there may not be enough safe space to place the button to the left of the composer; widen the window.

## Chrome shows the script crossed out

Chrome requires explicit permission for Violentmonkey to run userscripts:

1. Open `chrome://extensions`.
2. Find **Violentmonkey** and open **Details**.
3. Set **Allow User Scripts** to **ON**.
4. Return to ChatGPT and refresh the page.

When this permission is off, the script may appear crossed out in Violentmonkey and **Export chat** will not be injected.

## Violentmonkey reports a name/namespace conflict

Another copy of ChatGPT Conversation Extractor is already installed. Delete the duplicate copy or update the existing installed script instead of installing a second copy with the same name and namespace.

## I enabled or disabled the script, but the button did not change

Userscript managers normally inject scripts when a matching page loads. After enabling or disabling ChatGPT Conversation Extractor:

1. Return to ChatGPT.
2. Refresh the page.

After refresh:

- enabled → **Export chat** should appear on a conversation;
- disabled → **Export chat** should disappear.

This page-load behavior is normal for a userscript manager and does not require a runtime workaround.

## HTTP 401 or 403

Your ChatGPT web session, internal authentication flow, or internal endpoints may have changed or may no longer permit the request.

Refresh ChatGPT and confirm that you are signed in normally. Never paste an access token into the userscript and never publish a token in an issue.

## HTTP 404

The internal conversation endpoint may have changed, or the selected conversation may no longer be accessible to the signed-in account. Confirm that the conversation opens normally in ChatGPT.

## PASS but the snapshot is not the conversation you expected

Make sure the desired conversation was open when you clicked **Export chat**. Each export uses the conversation ID from the current URL and takes one new JSON snapshot.

## Only JSON and integrity report were downloaded

The active branch failed structural validation. Read `.integrity.txt` for the exact missing-parent or cycle reason. Markdown is intentionally withheld on structural `FAIL`.

## The browser blocks multiple downloads

Allow multiple downloads for `chatgpt.com`, then run the export again. The script does not create a ZIP archive.

## ChatGPT changed its UI or API

Compare the project's **Last tested** date with the latest GitHub Release when one is available. Internal ChatGPT endpoints and page layout can change without notice.
