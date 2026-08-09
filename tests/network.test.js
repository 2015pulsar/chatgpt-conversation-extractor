"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const network = require("../src/network.js");

function response(body, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() { return body; },
  };
}

test("auth session request is minimal, same-origin and extracts a non-empty accessToken", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response('{"accessToken":"memory-only-token"}');
  };
  const token = await network.fetchSessionAccessToken({ fetchImpl, origin: "https://chatgpt.com" });
  assert.equal(token, "memory-only-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/auth/session");
  assert.deepEqual(calls[0].init, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
});

test("conversation request sends both bearer headers and credentials include", async () => {
  const calls = [];
  const raw = '{\n  "title": "Authorized"\n}\n';
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === "/api/auth/session") return response('{"accessToken":"secret-test-token"}');
    return response(raw);
  };
  const result = await network.fetchConversationJson("conversation_123", {
    fetchImpl,
    origin: "https://chatgpt.com",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "/backend-api/conversation/conversation_123");
  assert.equal(calls[1].init.credentials, "include");
  assert.equal(calls[1].init.headers.Accept, "application/json");
  assert.equal(calls[1].init.headers.Authorization, "Bearer secret-test-token");
  assert.equal(calls[1].init.headers["X-Authorization"], "Bearer secret-test-token");
  assert.equal(result.rawText, raw);
});

test("missing or invalid session accessToken fails before conversation request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response('{"accessToken":"   "}');
  };
  await assert.rejects(
    network.fetchConversationJson("conversation_123", { fetchImpl, origin: "https://chatgpt.com" }),
    /did not provide a usable accessToken/,
  );
  assert.equal(calls, 1);
});

test("token is absent from HTTP errors and requests outside exact origin are refused", async () => {
  const token = "must-not-leak-token";
  const fetchImpl = async (url) => url === "/api/auth/session"
    ? response(JSON.stringify({ accessToken: token }))
    : response("denied", 401, "Unauthorized");
  await assert.rejects(
    network.fetchConversationJson("conversation_123", { fetchImpl, origin: "https://chatgpt.com" }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.endpoint, "/backend-api/conversation/conversation_123");
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
  await assert.rejects(
    network.fetchSessionAccessToken({ fetchImpl, origin: "https://example.com" }),
    /outside chatgpt\.com/,
  );
});
