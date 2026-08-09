(function initNetwork(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChatGPTConversationExtractorNetwork = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function networkFactory() {
  "use strict";

  const ALLOWED_ORIGIN = "https://chatgpt.com";
  const SESSION_ENDPOINT = "/api/auth/session";
  const CONVERSATION_ENDPOINT = (conversationId) =>
    `/backend-api/conversation/${encodeURIComponent(conversationId)}`;

  class ConversationFetchError extends Error {
    constructor(message, endpoint, status) {
      super(message);
      this.name = "ConversationFetchError";
      this.endpoint = endpoint;
      this.status = status;
    }
  }

  function resolveDependencies(options) {
    const settings = options || {};
    const fetchImpl = settings.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const origin = settings.origin || (typeof location !== "undefined" ? location.origin : "");
    if (origin !== ALLOWED_ORIGIN) {
      throw new ConversationFetchError("Refusing a request outside chatgpt.com.", "(none)", 0);
    }
    if (typeof fetchImpl !== "function") {
      throw new ConversationFetchError("Browser fetch is unavailable.", "(none)", 0);
    }
    return { fetchImpl };
  }

  async function requestText(fetchImpl, endpoint, init, label) {
    let response;
    try {
      response = await fetchImpl(endpoint, init);
    } catch {
      throw new ConversationFetchError(`${label} network request failed.`, endpoint, 0);
    }
    if (!response || !response.ok) {
      const status = response && Number.isFinite(response.status) ? response.status : 0;
      const statusText = response && response.statusText ? ` ${response.statusText}` : "";
      throw new ConversationFetchError(
        `${label} returned HTTP ${status || "unknown"}${statusText}`,
        endpoint,
        status,
      );
    }
    return { response, text: await response.text() };
  }

  async function fetchSessionAccessToken(options) {
    const { fetchImpl } = resolveDependencies(options);
    const result = await requestText(fetchImpl, SESSION_ENDPOINT, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    }, "Auth session");

    let session;
    try {
      session = JSON.parse(result.text);
    } catch {
      throw new ConversationFetchError("Auth session returned a non-JSON response.", SESSION_ENDPOINT, result.response.status);
    }
    const accessToken = session && session.accessToken;
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new ConversationFetchError("Auth session did not provide a usable accessToken.", SESSION_ENDPOINT, result.response.status);
    }
    return accessToken.trim();
  }

  async function fetchConversationJson(conversationId, options) {
    const dependencies = resolveDependencies(options);
    const accessToken = await fetchSessionAccessToken({
      fetchImpl: dependencies.fetchImpl,
      origin: ALLOWED_ORIGIN,
    });
    const endpoint = CONVERSATION_ENDPOINT(conversationId);
    const authorization = `Bearer ${accessToken}`;
    const result = await requestText(dependencies.fetchImpl, endpoint, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "X-Authorization": authorization,
      },
    }, "Conversation endpoint");

    let data;
    try {
      data = JSON.parse(result.text);
    } catch {
      throw new ConversationFetchError("Conversation endpoint returned a non-JSON response.", endpoint, result.response.status);
    }
    return { data, rawText: result.text, endpoint, status: result.response.status };
  }

  return {
    ALLOWED_ORIGIN,
    CONVERSATION_ENDPOINT,
    SESSION_ENDPOINT,
    ConversationFetchError,
    fetchConversationJson,
    fetchSessionAccessToken,
  };
});
