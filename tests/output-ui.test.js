"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/core.js");
const network = require("../src/network.js");
const ui = require("../src/ui-state.js");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "conversations.json"), "utf8"));
const conversationId = "final-output-conversation-123";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() { return body; },
  };
}

test("output count: a successful export plan contains exactly MD, JSON and integrity", () => {
  const raw = JSON.stringify(fixtures.linear);
  const artifacts = core.createExportArtifacts(fixtures.linear, conversationId, raw);
  const plan = ui.getDownloadArtifacts(artifacts);
  assert.equal(artifacts.txt, undefined);
  assert.deepEqual(plan, [artifacts.md, artifacts.json, artifacts.integrity]);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((artifact) => path.extname(artifact.name)), [".md", ".json", ".txt"]);
  assert.equal(plan.filter((artifact) => artifact.name.endsWith(".txt") && !artifact.name.endsWith(".integrity.txt")).length, 0);
});

test("same snapshot: one conversation response builds all three outputs without refetch", async () => {
  const raw = `${JSON.stringify(fixtures.linear, null, 2)}\n`;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === "/api/auth/session") return response('{"accessToken":"snapshot-token"}');
    return response(raw);
  };
  const fetched = await network.fetchConversationJson(conversationId, {
    fetchImpl,
    origin: "https://chatgpt.com",
  });
  const artifacts = core.createExportArtifacts(fetched.data, conversationId, fetched.rawText, "2026-08-09T12:00:00.000Z");
  const plan = ui.getDownloadArtifacts(artifacts);
  assert.equal(calls.filter((url) => url.startsWith("/backend-api/conversation/")).length, 1);
  assert.equal(artifacts.json.content, raw);
  assert.match(artifacts.md.content, /Hello/);
  assert.match(artifacts.integrity.content, /VISIBLE USER MESSAGES: 1/);
  assert.equal(plan.length, 3);
});

test("result state: Export chat -> PASS/Hide result -> Export chat", () => {
  let state = ui.createUiState("chat-one");
  assert.equal(ui.getButtonLabel(state), "Export chat");
  assert.equal(state.panelVisible, false);
  state = ui.transitionUiState(state, { type: "START_EXPORT" });
  state = ui.transitionUiState(state, { type: "SHOW_RESULT", outcome: "PASS", panelText: "PASS" });
  assert.equal(ui.getButtonLabel(state), "Hide result");
  assert.equal(state.panelVisible, true);
  assert.match(state.panelText, /PASS/);
  state = ui.transitionUiState(state, { type: "HIDE_RESULT" });
  assert.equal(ui.getButtonLabel(state), "Export chat");
  assert.equal(state.panelVisible, false);
  assert.equal(state.panelText, "");
});

test("fail result state uses the same Hide result reset", () => {
  let state = ui.createUiState("chat-one");
  state = ui.transitionUiState(state, { type: "START_EXPORT" });
  state = ui.transitionUiState(state, { type: "SHOW_RESULT", outcome: "FAIL", panelText: "FAIL\nHTTP 401" });
  assert.equal(ui.getButtonLabel(state), "Hide result");
  assert.equal(state.outcome, "FAIL");
  assert.equal(state.panelVisible, true);
  state = ui.transitionUiState(state, { type: "HIDE_RESULT" });
  assert.equal(ui.getButtonLabel(state), "Export chat");
  assert.equal(state.panelVisible, false);
});

test("re-export works after hiding a previous result", () => {
  let state = ui.createUiState("chat-one");
  state = ui.transitionUiState(state, { type: "START_EXPORT" });
  state = ui.transitionUiState(state, { type: "SHOW_RESULT", outcome: "PASS", panelText: "PASS" });
  state = ui.transitionUiState(state, { type: "HIDE_RESULT" });
  state = ui.transitionUiState(state, { type: "START_EXPORT" });
  assert.equal(state.phase, "working");
  assert.equal(state.panelVisible, false);
  assert.equal(ui.getButtonLabel(state), "Fetching...");
});

test("SPA reset closes an old result and adopts the new conversation ID", () => {
  let state = ui.createUiState("chat-one");
  state = ui.transitionUiState(state, { type: "SHOW_RESULT", outcome: "PASS", panelText: "OLD PASS" });
  state = ui.transitionUiState(state, { type: "NAVIGATE", conversationId: "chat-two" });
  assert.equal(state.conversationId, "chat-two");
  assert.equal(state.panelVisible, false);
  assert.equal(state.panelText, "");
  assert.equal(ui.getButtonLabel(state), "Export chat");
  state = ui.transitionUiState(state, { type: "START_EXPORT" });
  assert.equal(state.conversationId, "chat-two");
  assert.equal(state.phase, "working");
});
