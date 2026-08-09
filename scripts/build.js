"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const corePath = path.join(projectRoot, "src", "core.js");
const networkPath = path.join(projectRoot, "src", "network.js");
const uiStatePath = path.join(projectRoot, "src", "ui-state.js");
const userscriptPath = path.join(projectRoot, "src", "userscript.user.js");
const outputPath = path.join(projectRoot, "dist", "chatgpt-conversation-extractor.user.js");

const core = fs.readFileSync(corePath, "utf8").trim();
const network = fs.readFileSync(networkPath, "utf8").trim();
const uiState = fs.readFileSync(uiStatePath, "utf8").trim();
const userscript = fs.readFileSync(userscriptPath, "utf8");
const metadataEnd = userscript.indexOf("// ==/UserScript==");
if (metadataEnd < 0) throw new Error("Userscript metadata block is missing.");
const splitAt = metadataEnd + "// ==/UserScript==".length;
const metadata = userscript.slice(0, splitAt);
const runtime = userscript.slice(splitAt).trim();

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${metadata}\n\n${core}\n\n${network}\n\n${uiState}\n\n${runtime}\n`,
  "utf8",
);
process.stdout.write(`Built ${path.relative(projectRoot, outputPath)}\n`);
