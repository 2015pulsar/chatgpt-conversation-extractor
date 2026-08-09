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
