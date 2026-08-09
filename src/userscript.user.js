// ==UserScript==
// @name         ChatGPT Conversation Extractor
// @namespace    local.chatgpt-conversation-extractor
// @version      0.2.0
// @description  Export the current ChatGPT active branch from its same-origin conversation JSON.
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

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
