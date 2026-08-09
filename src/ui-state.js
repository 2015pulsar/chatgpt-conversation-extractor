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
