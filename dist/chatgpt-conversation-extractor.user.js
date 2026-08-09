// ==UserScript==
// @name         ChatGPT Conversation Extractor
// @namespace    local.chatgpt-conversation-extractor
// @version      0.2.0
// @description  Export the current ChatGPT active branch from its same-origin conversation JSON.
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function initCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChatGPTConversationExtractorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function coreFactory() {
  "use strict";

  const VISIBLE_ROLES = new Set(["user", "assistant"]);
  const HIDDEN_CONTENT_TYPES = new Set([
    "thoughts",
    "reasoning_recap",
    "model_editable_context",
    "user_editable_context",
  ]);
  const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function extractConversationId(urlLike) {
    let url;
    try {
      url = new URL(String(urlLike));
    } catch {
      throw new Error("Cannot determine conversation ID: the current URL is invalid.");
    }
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") {
      throw new Error("Cannot determine conversation ID: open a conversation on https://chatgpt.com/.");
    }
    const segments = url.pathname.split("/");
    const cIndex = segments.lastIndexOf("c");
    if (cIndex < 0 || cIndex + 1 >= segments.length) {
      throw new Error("Cannot determine conversation ID: the URL has no /c/<conversation-id> segment.");
    }
    let id;
    try {
      id = decodeURIComponent(segments[cIndex + 1]);
    } catch {
      throw new Error("Cannot determine conversation ID: the /c/ segment is malformed.");
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
      throw new Error("Cannot determine conversation ID: the /c/ value failed validation.");
    }
    return id;
  }

  function walkActiveBranch(conversation) {
    const mapping = conversation && conversation.mapping;
    const currentNode = conversation && conversation.current_node;
    const result = {
      branch: [],
      currentNode: typeof currentNode === "string" ? currentNode : "",
      totalNodes: isPlainObject(mapping) ? Object.keys(mapping).length : 0,
      steps: 0,
      brokenParentLinks: 0,
      cycles: 0,
      duplicateNodeVisits: 0,
      structuralErrors: [],
      structuralPass: false,
    };

    if (!isPlainObject(mapping)) {
      result.structuralErrors.push("FAIL: mapping is missing or is not an object");
      return result;
    }
    if (!currentNode) {
      result.structuralErrors.push("FAIL: current_node is missing or invalid");
      return result;
    }

    const reverseBranch = [];
    const visited = new Set();
    let id = currentNode;
    while (id) {
      result.steps += 1;
      if (visited.has(id)) {
        result.cycles += 1;
        result.duplicateNodeVisits += 1;
        result.structuralErrors.push(`FAIL: cycle detected at node ${id}`);
        break;
      }
      visited.add(id);

      const node = mapping[id];
      if (!isPlainObject(node)) {
        if (id === currentNode) {
          result.structuralErrors.push(`FAIL: current node ${id} is missing`);
        } else {
          result.brokenParentLinks += 1;
          result.structuralErrors.push(`FAIL: missing parent node ${id}`);
        }
        break;
      }
      reverseBranch.push({ id, node });

      const parent = node.parent;
      if (parent === null || parent === undefined || parent === "") {
        result.structuralPass = true;
        break;
      }
      if (typeof parent !== "string") {
        result.brokenParentLinks += 1;
        result.structuralErrors.push(`FAIL: invalid parent reference on node ${id}`);
        break;
      }
      if (!Object.prototype.hasOwnProperty.call(mapping, parent)) {
        result.brokenParentLinks += 1;
        result.structuralErrors.push(`FAIL: missing parent node ${parent}`);
        break;
      }
      id = parent;
    }
    result.branch = reverseBranch.reverse();
    if (result.structuralErrors.length > 0) result.structuralPass = false;
    return result;
  }

  function hiddenByMetadata(message) {
    const metadata = isPlainObject(message && message.metadata) ? message.metadata : {};
    return metadata.is_visually_hidden_from_conversation === true ||
      metadata.is_visually_hidden === true ||
      metadata.hidden === true ||
      metadata.is_hidden === true;
  }

  function classifyTranscriptMessage(message) {
    const role = message && message.author && message.author.role;
    if (!message || !VISIBLE_ROLES.has(role)) return "other-role";
    if (hiddenByMetadata(message)) return "visual-hidden";
    if (Object.prototype.hasOwnProperty.call(message, "recipient") && message.recipient !== "all") {
      return "internal-non-all-recipient";
    }
    const contentType = message.content && message.content.content_type;
    if (typeof contentType === "string" && HIDDEN_CONTENT_TYPES.has(contentType.toLowerCase())) {
      return "reasoning-context-hidden";
    }
    return "visible";
  }

  function shouldIncludeInTranscript(message) {
    return classifyTranscriptMessage(message) === "visible";
  }

  function isKnownAttachmentPart(part) {
    if (!isPlainObject(part) || !attachmentCandidate(part)) return false;
    if (part.asset_pointer || part.file_id) return true;
    const type = String(part.content_type || part.type || "").toLowerCase();
    return type === "image_asset_pointer" ||
      type === "audio_asset_pointer" ||
      type === "video_asset_pointer" ||
      type === "file_asset_pointer" ||
      type === "media_asset_pointer" ||
      type === "file_attachment" ||
      type === "attachment" ||
      type === "file";
  }

  function textFromPart(part, unknownParts, path) {
    if (typeof part === "string") return part;
    if (typeof part === "number" || typeof part === "boolean") return String(part);
    if (!isPlainObject(part)) {
      if (part !== null && part !== undefined) unknownParts.push(path);
      return "";
    }

    if (typeof part.text === "string") return part.text;
    if (isPlainObject(part.text) && typeof part.text.value === "string") return part.text.value;
    if (typeof part.content === "string" && /text/i.test(String(part.content_type || part.type || ""))) {
      return part.content;
    }
    if (Array.isArray(part.parts)) {
      return part.parts.map((child, index) => textFromPart(child, unknownParts, `${path}.parts[${index}]`))
        .filter(Boolean).join("\n");
    }
    if (isKnownAttachmentPart(part)) return "";
    unknownParts.push(path);
    return "";
  }

  function extractMessageText(message, identifier) {
    const unknownParts = [];
    const content = message && message.content;
    const base = identifier || (message && message.id) || "unknown-message";
    let text = "";

    if (typeof content === "string") {
      text = content;
    } else if (isPlainObject(content)) {
      if (Array.isArray(content.parts)) {
        text = content.parts.map((part, index) =>
          textFromPart(part, unknownParts, `${base}:content.parts[${index}]`))
          .filter(Boolean).join("\n");
      } else if (typeof content.text === "string") {
        text = content.text;
      } else if (isPlainObject(content.text) && typeof content.text.value === "string") {
        text = content.text.value;
      } else if (typeof content.result === "string") {
        text = content.result;
      } else {
        const candidate = textFromPart(content, unknownParts, `${base}:content`);
        text = candidate;
      }
    } else if (content !== null && content !== undefined) {
      unknownParts.push(`${base}:content`);
    }

    return { text, unknownParts };
  }

  function normalizeAttachmentId(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim().replace(/^(?:sediment|file-service):\/\//i, "");
  }

  function attachmentCandidate(value) {
    if (!isPlainObject(value)) return null;
    const id = value.id || value.file_id || value.asset_pointer || value.upload_id || "";
    const name = value.name || value.file_name || value.filename || value.original_name || "";
    const mimeType = value.mime_type || value.mimeType || value.content_type || "";
    if (!id && !name) return null;
    return {
      id: String(id || ""),
      normalizedId: normalizeAttachmentId(id),
      name: String(name || ""),
      mimeType: String(mimeType || ""),
    };
  }

  function extractAttachments(message) {
    const found = [];
    const byKey = new Map();
    function add(value, sourcePriority) {
      const attachment = attachmentCandidate(value);
      if (!attachment) return;
      const key = attachment.normalizedId
        ? `id:${attachment.normalizedId}`
        : attachment.name ? `name:${attachment.name}` : "";
      if (!key) return;
      const existing = byKey.get(key);
      if (!existing) {
        const stored = {
          ...attachment,
          namePriority: attachment.name ? sourcePriority : -1,
          mimePriority: attachment.mimeType ? sourcePriority : -1,
        };
        byKey.set(key, stored);
        found.push(stored);
        return;
      }
      if (attachment.name && (!existing.name || sourcePriority > existing.namePriority)) {
        existing.name = attachment.name;
        existing.namePriority = sourcePriority;
      }
      if (attachment.mimeType && (!existing.mimeType || sourcePriority > existing.mimePriority)) {
        existing.mimeType = attachment.mimeType;
        existing.mimePriority = sourcePriority;
      }
      if (!existing.id && attachment.id) existing.id = attachment.id;
    }
    const metadata = isPlainObject(message && message.metadata) ? message.metadata : {};
    for (const key of ["attachments", "files", "uploads"]) {
      if (Array.isArray(metadata[key])) metadata[key].forEach((item) => add(item, 2));
    }

    const content = message && message.content;
    const parts = isPlainObject(content) && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (isKnownAttachmentPart(part)) add(part, 1);
    }
    return found.map(({ namePriority, mimePriority, normalizedId, ...attachment }) => attachment);
  }

  function attachmentMarker(attachment) {
    if (attachment.name) return `<<File name="${attachment.name}">>`;
    return `<<Attachment id="${attachment.id || "unavailable"}"; name unavailable>>`;
  }

  function formatTimestamp(value) {
    if (value === null || value === undefined || value === "") return "";
    let numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return "";
    if (Math.abs(numeric) < 1e12) numeric *= 1000;
    const date = new Date(numeric);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function analyzeConversation(conversation) {
    const walk = walkActiveBranch(conversation);
    const visibleMessages = [];
    const unknownContentParts = [];
    let otherHiddenNodes = 0;
    let attachmentsFound = 0;
    let attachmentsWithName = 0;
    let attachmentsWithoutName = 0;
    let internalNonAllRecipientNodes = 0;
    let reasoningContextHiddenNodes = 0;

    for (const entry of walk.branch) {
      const message = entry.node.message;
      const classification = classifyTranscriptMessage(message);
      if (classification !== "visible") {
        otherHiddenNodes += 1;
        if (classification === "internal-non-all-recipient") internalNonAllRecipientNodes += 1;
        if (classification === "reasoning-context-hidden") reasoningContextHiddenNodes += 1;
        continue;
      }
      const role = message.author.role;
      const extracted = extractMessageText(message, entry.id);
      unknownContentParts.push(...extracted.unknownParts);
      const attachments = extractAttachments(message);
      attachmentsFound += attachments.length;
      attachmentsWithName += attachments.filter((item) => Boolean(item.name)).length;
      attachmentsWithoutName += attachments.filter((item) => !item.name).length;
      visibleMessages.push({
        nodeId: entry.id,
        messageId: message.id || "",
        role,
        time: formatTimestamp(message.create_time),
        rawTime: message.create_time,
        text: extracted.text,
        attachments,
      });
    }

    const visibleTimes = visibleMessages.filter((message) => message.time);
    return {
      title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title.trim() : "",
      walk,
      visibleMessages,
      counts: {
        user: visibleMessages.filter((message) => message.role === "user").length,
        assistant: visibleMessages.filter((message) => message.role === "assistant").length,
        otherHiddenNodes,
        attachmentsFound,
        attachmentsWithName,
        attachmentsWithoutName,
        unknownContentParts: unknownContentParts.length,
        internalNonAllRecipientNodes,
        reasoningContextHiddenNodes,
      },
      unknownContentPartDetails: unknownContentParts,
      firstVisibleMessageTime: visibleTimes.length ? visibleTimes[0].time : "",
      lastVisibleMessageTime: visibleTimes.length ? visibleTimes[visibleTimes.length - 1].time : "",
    };
  }

  function inlineCode(value) {
    const text = String(value);
    const runs = text.match(/`+/g) || [];
    const fence = "`".repeat(Math.max(1, ...runs.map((run) => run.length + 1)));
    const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
    return `${fence}${padded}${fence}`;
  }

  function renderTxt(analysis, conversationId, exportedAt) {
    const lines = [
      "==================================================",
      `CHAT: ${analysis.title || `chat_${conversationId}`}`,
      `CONVERSATION ID: ${conversationId}`,
      `EXPORTED: ${exportedAt}`,
      `ACTIVE BRANCH: ${analysis.walk.currentNode}`,
      "==================================================",
      "",
    ];
    for (const message of analysis.visibleMessages) {
      const prefix = message.time ? `[${message.time}] ` : "";
      lines.push(`${prefix}${message.role.toUpperCase()}`, "");
      if (message.text) lines.push(message.text, "");
      for (const attachment of message.attachments) lines.push(attachmentMarker(attachment), "");
      lines.push("---", "");
    }
    return lines.join("\n").replace(/\n+$/, "\n");
  }

  function renderMarkdown(analysis, conversationId, exportedAt) {
    const lines = [
      `# ${analysis.title || `chat_${conversationId}`}`,
      "",
      `Conversation ID: ${inlineCode(conversationId)}`,
      "",
      `Exported: ${inlineCode(exportedAt)}`,
      "",
    ];
    for (const message of analysis.visibleMessages) {
      const heading = message.role === "user" ? "User" : "Assistant";
      lines.push(`## ${heading}`, "");
      if (message.time) lines.push(inlineCode(message.time), "");
      if (message.text) lines.push(message.text, "");
      for (const attachment of message.attachments) {
        lines.push(inlineCode(attachmentMarker(attachment)), "");
      }
    }
    return lines.join("\n").replace(/\n+$/, "\n");
  }

  function renderIntegrityReport(analysis, conversationId) {
    const walk = analysis.walk;
    const lines = [
      `CHAT TITLE: ${analysis.title || "(missing)"}`,
      `CONVERSATION ID: ${conversationId}`,
      `CURRENT NODE: ${walk.currentNode || "(missing)"}`,
      `TOTAL NODES IN MAPPING: ${walk.totalNodes}`,
      `NODES IN ACTIVE BRANCH: ${walk.branch.length}`,
      `PARENT-CHAIN STEPS: ${walk.steps}`,
      `VISIBLE USER MESSAGES: ${analysis.counts.user}`,
      `VISIBLE ASSISTANT MESSAGES: ${analysis.counts.assistant}`,
      `OTHER/HIDDEN NODES IN ACTIVE BRANCH: ${analysis.counts.otherHiddenNodes}`,
      `ATTACHMENTS FOUND: ${analysis.counts.attachmentsFound}`,
      `ATTACHMENTS WITH NAME: ${analysis.counts.attachmentsWithName}`,
      `ATTACHMENTS WITHOUT NAME: ${analysis.counts.attachmentsWithoutName}`,
      `UNKNOWN CONTENT PARTS: ${analysis.counts.unknownContentParts}`,
      `INTERNAL/NON-ALL RECIPIENT NODES: ${analysis.counts.internalNonAllRecipientNodes}`,
      `REASONING/CONTEXT HIDDEN NODES: ${analysis.counts.reasoningContextHiddenNodes}`,
      `BROKEN PARENT LINKS: ${walk.brokenParentLinks}`,
      `CYCLES: ${walk.cycles}`,
      `DUPLICATE NODE VISITS: ${walk.duplicateNodeVisits}`,
      `FIRST VISIBLE MESSAGE TIME: ${analysis.firstVisibleMessageTime || "(not available)"}`,
      `LAST VISIBLE MESSAGE TIME: ${analysis.lastVisibleMessageTime || "(not available)"}`,
      "",
    ];
    if (analysis.unknownContentPartDetails.length) {
      lines.push("CONTENT WARNINGS:");
      for (const detail of analysis.unknownContentPartDetails) {
        lines.push(`- unknown/unrendered content part: ${detail}`);
      }
      lines.push("");
    }
    if (walk.structuralPass) {
      lines.push(
        "STRUCTURAL STATUS: PASS",
        "Active branch is structurally continuous within the JSON returned by ChatGPT.",
      );
    } else {
      lines.push("STRUCTURAL STATUS: FAIL", ...walk.structuralErrors);
    }
    return `${lines.join("\n")}\n`;
  }

  function sanitizeFilename(value, maxLength) {
    const limit = Number.isInteger(maxLength) && maxLength > 8 ? maxLength : 120;
    let name = String(value || "untitled")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[ .]+$/g, "");
    if (!name) name = "untitled";
    if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
    const points = Array.from(name);
    if (points.length > limit) name = points.slice(0, limit).join("").replace(/[ .]+$/g, "");
    return name || "untitled";
  }

  function makeFileBase(title, conversationId) {
    if (!title) return sanitizeFilename(`chat_${conversationId}`);
    return sanitizeFilename(`${title} [${conversationId.slice(0, 8)}]`);
  }

  function createExportArtifacts(conversation, conversationId, rawJsonText, exportedAt) {
    const analysis = analyzeConversation(conversation);
    const timestamp = exportedAt || new Date().toISOString();
    const base = makeFileBase(analysis.title, conversationId);
    const artifacts = {
      base,
      analysis,
      json: { name: `${base}.json`, content: rawJsonText, type: "application/json;charset=utf-8" },
      integrity: {
        name: `${base}.integrity.txt`,
        content: renderIntegrityReport(analysis, conversationId),
        type: "text/plain;charset=utf-8",
      },
    };
    if (analysis.walk.structuralPass) {
      artifacts.md = {
        name: `${base}.md`,
        content: renderMarkdown(analysis, conversationId, timestamp),
        type: "text/markdown;charset=utf-8",
      };
    }
    return artifacts;
  }

  return {
    analyzeConversation,
    attachmentMarker,
    createExportArtifacts,
    extractAttachments,
    extractConversationId,
    extractMessageText,
    formatTimestamp,
    makeFileBase,
    normalizeAttachmentId,
    renderIntegrityReport,
    renderMarkdown,
    renderTxt,
    sanitizeFilename,
    shouldIncludeInTranscript,
    walkActiveBranch,
  };
});

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

(function initUiState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChatGPTConversationExtractorUiState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function uiStateFactory() {
  "use strict";

  function createUiState(conversationId) {
    return {
      conversationId: conversationId || "",
      phase: "idle",
      progressLabel: "",
      panelVisible: false,
      outcome: "",
      panelText: "",
    };
  }

  function transitionUiState(state, action) {
    switch (action.type) {
      case "NAVIGATE":
        return action.conversationId === state.conversationId
          ? state
          : createUiState(action.conversationId);
      case "START_EXPORT":
        return {
          ...state,
          phase: "working",
          progressLabel: "Fetching...",
          panelVisible: false,
          outcome: "",
          panelText: "",
        };
      case "PROGRESS":
        return { ...state, phase: "working", progressLabel: action.label || "Working..." };
      case "SHOW_RESULT":
        return {
          ...state,
          phase: "result",
          progressLabel: "",
          panelVisible: true,
          outcome: action.outcome === "PASS" ? "PASS" : "FAIL",
          panelText: action.panelText || "",
        };
      case "HIDE_RESULT":
        return createUiState(state.conversationId);
      default:
        return state;
    }
  }

  function getButtonLabel(state) {
    if (state.panelVisible) return "Hide result";
    if (state.phase === "working") return state.progressLabel || "Working...";
    return "Export chat";
  }

  function getDownloadArtifacts(artifacts) {
    if (artifacts.analysis.walk.structuralPass) {
      return [artifacts.md, artifacts.json, artifacts.integrity];
    }
    return [artifacts.json, artifacts.integrity];
  }

  function computeHorizontalPlacement(options) {
    const composerLeft = Number(options && options.composerLeft);
    const buttonWidth = Number(options && options.buttonWidth);
    const horizontalGap = Number(options && options.horizontalGap);
    const viewportWidth = Number(options && options.viewportWidth);
    const minLeft = Number(options && options.minLeft);
    const left = Math.round(composerLeft - buttonWidth - horizontalGap);
    const visible = [composerLeft, buttonWidth, horizontalGap, viewportWidth, minLeft]
      .every(Number.isFinite) && left >= minLeft && left + buttonWidth <= viewportWidth;
    return { left, visible };
  }

  function createResultPanelText(analysis) {
    const counts = analysis.counts;
    if (analysis.walk.structuralPass) {
      return `PASS\n\nuser messages: ${counts.user}\n` +
        `assistant messages: ${counts.assistant}\nattachments: ${counts.attachmentsFound}\n\n` +
        "files:\nMD\nJSON\nIntegrity";
    }
    return `FAIL\n\nuser messages: ${counts.user}\n` +
      `assistant messages: ${counts.assistant}\nattachments: ${counts.attachmentsFound}\n\n` +
      "files:\nJSON\nIntegrity\n\nMD withheld: structural validation failed.";
  }

  return {
    computeHorizontalPlacement,
    createResultPanelText,
    createUiState,
    getButtonLabel,
    getDownloadArtifacts,
    transitionUiState,
  };
});

(function runUserscript() {
  "use strict";

  const core = globalThis.ChatGPTConversationExtractorCore;
  const network = globalThis.ChatGPTConversationExtractorNetwork;
  const ui = globalThis.ChatGPTConversationExtractorUiState;

  function downloadArtifact(artifact) {
    const blob = new Blob([artifact.content], { type: artifact.type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function createInterface() {
    if (document.getElementById("chatgpt-conversation-extractor")) return;
    const BUTTON_WIDTH = 120;
    const BUTTON_HEIGHT = 40;
    const HORIZONTAL_GAP = 24;
    const MIN_VIEWPORT_LEFT = 12;
    const ACTION_ROW_BOTTOM_OFFSET = 27;
    const host = document.createElement("section");
    host.id = "chatgpt-conversation-extractor";
    host.style.cssText = [
      "display:none", "position:fixed", "z-index:2147483647",
      `width:${BUTTON_WIDTH}px`, "padding:0", "border:0",
      "background:transparent", "color:#ececec",
      "font:12px/1.4 system-ui,sans-serif",
    ].join(";");

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Export chat";
    button.style.cssText = [
      `width:${BUTTON_WIDTH}px`, `height:${BUTTON_HEIGHT}px`, "padding:0 12px",
      "border:1px solid rgba(255,255,255,.14)", "border-radius:8px",
      "background:#424242", "color:#f1f1f1", "font:500 12.5px system-ui,sans-serif",
      "box-shadow:0 1px 2px rgba(0,0,0,.16)", "cursor:pointer",
    ].join(";");

    const status = document.createElement("div");
    status.id = "chatgpt-conversation-extractor-result";
    status.setAttribute("role", "status");
    status.style.cssText = [
      "display:none", "position:fixed", "z-index:2147483646",
      "box-sizing:border-box", "max-height:240px", "overflow:auto",
      "padding:10px", "border:1px solid rgba(255,255,255,.12)", "border-radius:8px",
      "background:#2f2f2f", "box-shadow:0 1px 3px rgba(0,0,0,.18)",
      "font:12px/1.4 system-ui,sans-serif", "white-space:pre-wrap", "overflow-wrap:anywhere",
    ].join(";");
    host.appendChild(button);
    document.body.append(host, status);

    function readConversationId() {
      try {
        return core.extractConversationId(location.href);
      } catch {
        return "";
      }
    }

    let state = ui.createUiState(readConversationId());
    let exportSequence = 0;

    function renderState() {
      button.textContent = ui.getButtonLabel(state);
      button.disabled = state.phase === "working";
      button.style.opacity = state.phase === "working" ? ".65" : "1";
      status.textContent = state.panelVisible ? state.panelText : "";
      status.style.color = state.outcome === "FAIL" ? "#ff9b9b" : "#d7f7ee";
      if (!state.panelVisible) status.style.display = "none";
    }

    function syncConversationIdentity() {
      const conversationId = readConversationId();
      if (conversationId !== state.conversationId) {
        exportSequence += 1;
        state = ui.transitionUiState(state, { type: "NAVIGATE", conversationId });
        renderState();
      }
      return conversationId;
    }

    function usableRect(element) {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
      if (rect.width <= 0 || rect.height <= 0) return null;
      return rect;
    }

    function findComposerGeometry() {
      const elements = Array.from(new Set([
        ...document.querySelectorAll("textarea"),
        ...document.querySelectorAll('[contenteditable="true"][role="textbox"]'),
        ...document.querySelectorAll('[contenteditable="true"][data-lexical-editor="true"]'),
      ]));
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      let inputCandidate = null;
      for (const element of elements) {
        const rect = usableRect(element);
        if (!rect || rect.width < 160 || rect.bottom < viewportHeight * 0.55 ||
          rect.top >= viewportHeight || rect.bottom > viewportHeight + 16) continue;
        const score = rect.bottom + Math.min(rect.width, 1000) / 1000;
        if (!inputCandidate || score > inputCandidate.score) inputCandidate = { element, rect, score };
      }
      if (!inputCandidate) return null;

      const maximumWidth = Math.min(1000, viewportWidth * 0.92);
      const form = inputCandidate.element.closest("form");
      const formRect = usableRect(form);
      if (formRect && formRect.width >= inputCandidate.rect.width && formRect.width <= maximumWidth &&
        formRect.bottom >= viewportHeight * 0.55 && formRect.bottom <= viewportHeight + 16) {
        return { element: form, rect: formRect };
      }

      let best = { element: inputCandidate.element, rect: inputCandidate.rect };
      let ancestor = inputCandidate.element.parentElement;
      for (let depth = 0; ancestor && depth < 7; depth += 1, ancestor = ancestor.parentElement) {
        const rect = usableRect(ancestor);
        if (!rect) continue;
        const composerSized = rect.width >= inputCandidate.rect.width &&
          rect.width <= maximumWidth && rect.height >= inputCandidate.rect.height &&
          rect.bottom >= viewportHeight * 0.55 &&
          rect.bottom <= viewportHeight + 16;
        if (composerSized && rect.width >= best.rect.width) best = { element: ancestor, rect };
      }
      return best;
    }

    let observedComposer = null;
    let positionFrame = 0;
    const layoutObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => schedulePosition())
      : null;

    function updateObservedElement(composer) {
      if (!layoutObserver || composer === observedComposer) return;
      layoutObserver.disconnect();
      observedComposer = composer;
      if (observedComposer) layoutObserver.observe(observedComposer);
    }

    function positionInterface() {
      positionFrame = 0;
      const conversationId = syncConversationIdentity();
      const composer = findComposerGeometry();
      updateObservedElement(composer && composer.element);
      if (!conversationId || !composer) {
        host.style.display = "none";
        status.style.display = "none";
        return;
      }

      const placement = ui.computeHorizontalPlacement({
        composerLeft: composer.rect.left,
        buttonWidth: BUTTON_WIDTH,
        horizontalGap: HORIZONTAL_GAP,
        viewportWidth: window.innerWidth,
        minLeft: MIN_VIEWPORT_LEFT,
      });
      if (!placement.visible) {
        host.style.display = "none";
        status.style.display = "none";
        return;
      }

      const composerActionCenter = composer.rect.bottom - ACTION_ROW_BOTTOM_OFFSET;
      const bottom = Math.max(8, Math.round(window.innerHeight - composerActionCenter - BUTTON_HEIGHT / 2));
      host.style.left = `${placement.left}px`;
      host.style.right = "auto";
      host.style.bottom = `${bottom}px`;
      host.style.display = "block";

      if (state.panelVisible) {
        status.style.width = `${BUTTON_WIDTH}px`;
        status.style.left = `${placement.left}px`;
        status.style.right = "auto";
        status.style.bottom = `${bottom + BUTTON_HEIGHT + 8}px`;
        status.style.display = "block";
      } else {
        status.style.display = "none";
      }
    }

    function schedulePosition() {
      if (positionFrame) cancelAnimationFrame(positionFrame);
      positionFrame = requestAnimationFrame(positionInterface);
    }

    window.addEventListener("resize", schedulePosition, { passive: true });
    window.addEventListener("popstate", schedulePosition, { passive: true });
    document.addEventListener("click", () => {
      schedulePosition();
      setTimeout(schedulePosition, 250);
    }, { passive: true, capture: true });
    let lastObservedUrl = location.href;
    setInterval(() => {
      if (location.href === lastObservedUrl) return;
      lastObservedUrl = location.href;
      schedulePosition();
    }, 500);
    renderState();
    schedulePosition();

    function setProgress(label) {
      state = ui.transitionUiState(state, { type: "PROGRESS", label });
      renderState();
    }

    function showResult(outcome, panelText) {
      state = ui.transitionUiState(state, { type: "SHOW_RESULT", outcome, panelText });
      renderState();
      schedulePosition();
    }

    function operationIsCurrent(sequence, conversationId) {
      return sequence === exportSequence && readConversationId() === conversationId;
    }

    button.addEventListener("click", async () => {
      if (state.panelVisible) {
        exportSequence += 1;
        state = ui.transitionUiState(state, { type: "HIDE_RESULT" });
        renderState();
        schedulePosition();
        return;
      }
      if (state.phase === "working") return;

      const conversationId = syncConversationIdentity();
      if (!conversationId) {
        schedulePosition();
        return;
      }
      const operationSequence = ++exportSequence;
      state = ui.transitionUiState(state, { type: "START_EXPORT" });
      renderState();
      let fetched = null;
      let rawDownloaded = false;
      try {
        setProgress("Fetching...");
        fetched = await network.fetchConversationJson(conversationId);
        if (!operationIsCurrent(operationSequence, conversationId)) {
          syncConversationIdentity();
          return;
        }

        setProgress("Parsing...");
        const artifacts = core.createExportArtifacts(
          fetched.data,
          conversationId,
          fetched.rawText,
          new Date().toISOString(),
        );

        setProgress("Validating...");
        if (!operationIsCurrent(operationSequence, conversationId)) {
          syncConversationIdentity();
          return;
        }
        setProgress("Downloading...");
        for (const artifact of ui.getDownloadArtifacts(artifacts)) {
          downloadArtifact(artifact);
          if (artifact === artifacts.json) rawDownloaded = true;
        }

        const outcome = artifacts.analysis.walk.structuralPass ? "PASS" : "FAIL";
        showResult(outcome, ui.createResultPanelText(artifacts.analysis));
      } catch (error) {
        if (!operationIsCurrent(operationSequence, conversationId)) {
          syncConversationIdentity();
          return;
        }
        if (fetched && !rawDownloaded) {
          try {
            const fallbackBase = core.sanitizeFilename(`chat_${conversationId || "unknown"}`);
            downloadArtifact({
              name: `${fallbackBase}.json`,
              content: fetched.rawText,
              type: "application/json;charset=utf-8",
            });
            rawDownloaded = true;
          } catch {
            // The status below remains the only safe fallback if the browser rejects the download.
          }
        }
        const details = error instanceof network.ConversationFetchError
          ? `\nHTTP status: ${error.status || "not received"}\nEndpoint: ${error.endpoint}`
          : "";
        const rawNote = rawDownloaded ? "\nRaw JSON downloaded." : "";
        showResult("FAIL", `FAIL\n\n${error.message || "Unexpected export error."}${details}${rawNote}`);
      }
    });
  }

  if (!core || !network || !ui) return;
  if (document.body) createInterface();
  else window.addEventListener("DOMContentLoaded", createInterface, { once: true });
})();
