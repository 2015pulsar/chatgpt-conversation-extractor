# Security

## Sensitive information

- Never commit access tokens, cookies, session data, private conversation exports, `.env` files, HAR captures, or browser profiles.
- Never paste a ChatGPT session/access token into a GitHub issue.
- Never upload private conversation JSON, Markdown transcripts, attachments, or screenshots containing private content to a public issue.

## Reporting a problem

The project does not yet publish a dedicated security email address.

Use a public GitHub issue only for a non-sensitive bug report that can be reproduced without private data. Describe the behavior with synthetic examples. If a report would require a secret or private conversation data, do not publish it; wait until the project owner provides a private security contact.

## Endpoint risk

This unofficial project uses internal, undocumented ChatGPT web endpoints. They may change without notice, and an endpoint change can cause authentication or export failures. Do not attempt to work around such failures by manually copying tokens into the source.

