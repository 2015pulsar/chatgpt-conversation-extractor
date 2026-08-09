"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/core.js");

const hardening = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "hardening.json"), "utf8"));
const original = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "conversations.json"), "utf8"));
const conversationId = "test-conversation-0002";

function artifactsFor(conversation) {
  return core.createExportArtifacts(conversation, conversationId, JSON.stringify(conversation), "2026-08-09T12:00:00.000Z");
}

function occurrences(text, value) {
  return text.split(value).length - 1;
}

test("I: non-all assistant recipient remains structural but is excluded from MD", () => {
  const conversation = hardening.internalRecipient;
  const artifacts = artifactsFor(conversation);
  assert.equal(artifacts.analysis.walk.structuralPass, true);
  assert.deepEqual(artifacts.analysis.walk.branch.map((entry) => entry.id), ["root", "user", "internal", "tool", "final"]);
  assert.doesNotMatch(artifacts.md.content, /INTERNAL BROWSER COMMAND|TOOL RESULT/);
  assert.match(artifacts.md.content, /VISIBLE FINAL ANSWER/);
  assert.match(artifacts.json.content, /INTERNAL BROWSER COMMAND/);
  assert.equal(artifacts.analysis.counts.internalNonAllRecipientNodes, 1);
});

test("J: thoughts and reasoning_recap remain structural but are excluded from transcript", () => {
  const artifacts = artifactsFor(hardening.reasoning);
  assert.equal(artifacts.analysis.walk.structuralPass, true);
  assert.doesNotMatch(artifacts.md.content, /PRIVATE THOUGHTS|PRIVATE REASONING RECAP/);
  assert.match(artifacts.md.content, /PUBLIC RESULT/);
  assert.equal(artifacts.analysis.counts.reasoningContextHiddenNodes, 2);
  assert.match(artifacts.integrity.content, /REASONING\/CONTEXT HIDDEN NODES: 2/);
});

test("K: metadata and sediment representations merge into one named attachment", () => {
  const artifacts = artifactsFor(hardening.duplicateSediment);
  const marker = '<<File name="example.zip">>';
  assert.equal(artifacts.analysis.counts.attachmentsFound, 1);
  assert.equal(occurrences(artifacts.md.content, marker), 1);
  assert.equal(artifacts.analysis.counts.unknownContentParts, 0);
});

test("L: file-service ID normalizes to the metadata file ID", () => {
  const artifacts = artifactsFor(hardening.duplicateFileService);
  assert.equal(core.normalizeAttachmentId("file-service://file_example_123"), "file_example_123");
  assert.equal(artifacts.analysis.counts.attachmentsFound, 1);
  assert.equal(occurrences(artifacts.md.content, '<<File name="example-archive.zip">>'), 1);
});

test("M: a known image_asset_pointer is an attachment, not unknown text", () => {
  const artifacts = artifactsFor(hardening.knownImage);
  assert.equal(artifacts.analysis.counts.attachmentsFound, 1);
  assert.equal(artifacts.analysis.counts.unknownContentParts, 0);
  assert.match(artifacts.md.content, /Attachment id="sediment:\/\/image_456"/);
});

test("N: an unknown future content type still produces an integrity warning", () => {
  const artifacts = artifactsFor(original.unknownPart);
  assert.equal(artifacts.analysis.walk.structuralPass, true);
  assert.equal(artifacts.analysis.counts.unknownContentParts, 1);
  assert.match(artifacts.integrity.content, /unknown\/unrendered content part/);
});
