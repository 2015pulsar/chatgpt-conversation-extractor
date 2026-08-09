"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/core.js");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "conversations.json"), "utf8"));
const conversationId = "test-conversation-0001";

function artifactsFor(name) {
  const conversation = fixtures[name];
  return core.createExportArtifacts(conversation, conversationId, JSON.stringify(conversation), "2026-08-09T12:00:00.000Z");
}

test("A: a linear branch is walked from current_node to root and reversed", () => {
  const artifacts = artifactsFor("linear");
  assert.equal(artifacts.analysis.walk.structuralPass, true);
  assert.deepEqual(artifacts.analysis.walk.branch.map((entry) => entry.id), ["root", "u1", "a1"]);
  assert.match(artifacts.md.content, /Hello/);
  assert.match(artifacts.md.content, /Hi there/);
  assert.match(artifacts.integrity.content, /STRUCTURAL STATUS: PASS/);
});

test("B: regenerate exports only the active branch", () => {
  const artifacts = artifactsFor("regenerate");
  assert.match(artifacts.md.content, /NEW ACTIVE ANSWER/);
  assert.doesNotMatch(artifacts.md.content, /OLD BRANCH ANSWER/);
  assert.equal(artifacts.analysis.walk.branch.some((entry) => entry.id === "a-old"), false);
});

test("C: an original attachment name remains beside its message", () => {
  const artifacts = artifactsFor("attachment");
  const marker = '<<File name="example.zip">>';
  assert.match(artifacts.md.content, new RegExp(marker.replace(/[()]/g, "\\$&")));
  assert.ok(artifacts.md.content.includes(marker));
  assert.equal(artifacts.analysis.counts.attachmentsWithName, 1);
});

test("D: a missing parent fails closed and withholds MD", () => {
  const artifacts = artifactsFor("missingParent");
  assert.equal(artifacts.analysis.walk.structuralPass, false);
  assert.equal(artifacts.md, undefined);
  assert.match(artifacts.integrity.content, /FAIL: missing parent node missing-node/);
  assert.equal(artifacts.analysis.walk.brokenParentLinks, 1);
});

test("E: a cycle fails closed", () => {
  const artifacts = artifactsFor("cycle");
  assert.equal(artifacts.analysis.walk.structuralPass, false);
  assert.match(artifacts.integrity.content, /FAIL: cycle detected/);
  assert.equal(artifacts.analysis.walk.cycles, 1);
  assert.equal(artifacts.analysis.walk.duplicateNodeVisits, 1);
});

test("F: Cyrillic, Unicode and emoji survive export", () => {
  const artifacts = artifactsFor("unicode");
  assert.ok(artifacts.md.content.includes("Привет, мир! 👋"));
  assert.ok(artifacts.md.content.includes("Здравствуйте — всё работает."));
  assert.ok(artifacts.base.includes("Кириллица и 日本語"));
});

test("G: an unknown content part is reported without aborting export", () => {
  const artifacts = artifactsFor("unknownPart");
  assert.equal(artifacts.analysis.walk.structuralPass, true);
  assert.ok(artifacts.md.content.includes("Visible text"));
  assert.equal(artifacts.analysis.counts.unknownContentParts, 1);
  assert.match(artifacts.integrity.content, /unknown\/unrendered content part: a1:content\.parts\[1\]/);
});

test("H: system/tool nodes remain structural but stay out of the transcript", () => {
  const artifacts = artifactsFor("structuralHidden");
  assert.deepEqual(artifacts.analysis.walk.branch.map((entry) => entry.id), ["root", "system", "u1", "tool", "a1"]);
  assert.equal(artifacts.analysis.counts.otherHiddenNodes, 3);
  assert.match(artifacts.md.content, /Visible user/);
  assert.match(artifacts.md.content, /Visible assistant/);
  assert.doesNotMatch(artifacts.md.content, /Hidden system|Hidden tool/);
});

test("conversation ID extraction supports ordinary and Project URLs", () => {
  assert.equal(core.extractConversationId(`https://chatgpt.com/c/${conversationId}`), conversationId);
  assert.equal(core.extractConversationId(`https://chatgpt.com/g/g-p-123/project/c/${conversationId}?x=1`), conversationId);
  assert.throws(() => core.extractConversationId("https://chatgpt.com/"), /no \/c\//);
  assert.throws(() => core.extractConversationId("https://evil.example/c/12345678"), /chatgpt\.com/);
  assert.throws(() => core.extractConversationId("https://chatgpt.com/c/bad%2Fid"), /failed validation/);
});

test("filename sanitizer handles Windows hazards and length", () => {
  assert.equal(core.sanitizeFilename('a\\b/c:*?"<>| .'), "a_b_c_______");
  assert.equal(core.sanitizeFilename("CON"), "_CON");
  assert.ok(Array.from(core.sanitizeFilename("я".repeat(200))).length <= 120);
});

test("unnamed attachments get an explicit marker and report count", () => {
  const conversation = JSON.parse(JSON.stringify(fixtures.attachment));
  conversation.mapping.u1.message.metadata.attachments[0] = { id: "file-no-name", mime_type: "application/octet-stream" };
  const artifacts = core.createExportArtifacts(conversation, conversationId, JSON.stringify(conversation));
  assert.ok(artifacts.md.content.includes('<<Attachment id="file-no-name"; name unavailable>>'));
  assert.equal(artifacts.analysis.counts.attachmentsWithoutName, 1);
});

test("the JSON artifact preserves the exact fetched response text", () => {
  const raw = '{\n  "title": "raw spacing",\n  "mapping": {},\n  "current_node": "x"\n}\n';
  const parsed = JSON.parse(raw);
  const artifacts = core.createExportArtifacts(parsed, conversationId, raw);
  assert.equal(artifacts.json.content, raw);
});
