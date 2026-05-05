"use strict";


let currentSummary = null;
let currentTab = null;
let isHighlightActive = false;

const $ = (id) => document.getElementById(id);
const summarizeBtn    = $("summarizeBtn");
const clearBtn        = $("clearBtn");
const loadingState    = $("loadingState");
const loadingText     = $("loadingText");
const errorState      = $("errorState");
const errorMessage    = $("errorMessage");
const emptyState      = $("emptyState");
const summaryState    = $("summaryState");
const pageTitle       = $("pageTitle");
const pageFavicon     = $("pageFavicon");
const highlightToggle = $("highlightToggle");
const copySummaryBtn  = $("copySummaryBtn");
const refreshBtn      = $("refreshBtn");

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];

    if (currentTab) {
      // Set page info
      pageTitle.textContent = currentTab.title || currentTab.url || "Current Page";
      if (currentTab.favIconUrl) {
        pageFavicon.src = currentTab.favIconUrl;
        pageFavicon.onerror = () => { pageFavicon.style.display = "none"; };
      } else {
        pageFavicon.style.display = "none";
      }
    }
  } catch (err) {
    console.error("[Popup] Init error:", err);
  }
});

summarizeBtn.addEventListener("click", () => runSummarize(false));

clearBtn.addEventListener("click", () => {
  currentSummary = null;
  isHighlightActive = false;
  updateHighlightToggle(false);
  removeHighlights();
  showState("empty");
  clearBtn.style.display = "none";
});


refreshBtn.addEventListener("click", () => runSummarize(true));

highlightToggle.addEventListener("click", async () => {
  if (!currentSummary) return;
  isHighlightActive = !isHighlightActive;
  updateHighlightToggle(isHighlightActive);

  if (isHighlightActive) {
    await applyHighlights(currentSummary.highlightPhrases || []);
  } else {
    await removeHighlights();
  }
});

copySummaryBtn.addEventListener("click", async () => {
  if (!currentSummary) return;
  const text = buildPlainTextSummary(currentSummary);
  try {
    await navigator.clipboard.writeText(text);
    copySummaryBtn.textContent = "✓ Copied!";
    copySummaryBtn.classList.add("btn-copied");
    setTimeout(() => {
      copySummaryBtn.innerHTML = `<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 1.5H3a2 2 0 00-2 2V14a2 2 0 002 2h10a2 2 0 002-2V3.5a2 2 0 00-2-2h-1v1h1a1 1 0 011 1V14a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5a1 1 0 011-1h1v-1z"/>
        <path d="M9.5 1a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-3a.5.5 0 01-.5-.5v-1a.5.5 0 01.5-.5h3zm-3-1A1.5 1.5 0 005 1.5v1A1.5 1.5 0 006.5 4h3A1.5 1.5 0 0011 2.5v-1A1.5 1.5 0 009.5 0h-3z"/>
      </svg>Copy`;
      copySummaryBtn.classList.remove("btn-copied");
    }, 1800);
  } catch (err) {
    console.error("[Popup] Clipboard error:", err);
  }
});

async function runSummarize(forceRefresh = false) {
  if (!currentTab) {
    showError("No active tab found. Please try again.");
    return;
  }

  // Validate URL scheme
  const url = currentTab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) {
    showError("This page cannot be summarized (browser internal page).");
    return;
  }

  showState("loading");
  setLoadingMessage("Extracting page content…");

  try {
    // Step 1: Ensure content script is alive (inject if needed)
    const alive = await pingContentScript();
    if (!alive) {
      await injectContentScript();
      await sleep(300);
    }

    // Step 2: Extract content from the page
    setLoadingMessage("Reading article content…");
    const extractResult = await sendToContentScript({ type: "EXTRACT_CONTENT" });
    if (!extractResult?.success || !extractResult.content?.trim()) {
      throw new Error("Could not extract content from this page. The page may be empty or restricted.");
    }

    const content = extractResult.content;
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    if (wordCount < 20) {
      throw new Error("Page has too little text to summarize.");
    }

    // Step 3: Send to background for AI processing
    setLoadingMessage("Summarizing with AI…");

    const result = await chrome.runtime.sendMessage({
      type: "SUMMARIZE",
      payload: {
        url: currentTab.url,
        content,
        title: currentTab.title,
        forceRefresh,
      },
    });

    if (!result?.success) {
      throw new Error(result?.error || "Summarization failed. Please try again.");
    }

    // Step 4: Render
    currentSummary = result.summary;
    isHighlightActive = false;
    updateHighlightToggle(false);
    renderSummary(result.summary, result.fromCache);
    showState("summary");
    clearBtn.style.display = "flex";

  } catch (err) {
    console.error("[Popup] Summarize error:", err);
    showError(err.message || "An unexpected error occurred.");
  }
}

async function pingContentScript() {
  try {
    const resp = await chrome.tabs.sendMessage(currentTab.id, { type: "PING" });
    return resp?.alive === true;
  } catch (_) {
    return false;
  }
}

async function injectContentScript() {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"],
    });
  } catch (err) {
    throw new Error("Could not inject content script. Try reloading the page.");
  }
}

async function sendToContentScript(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(currentTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function applyHighlights(phrases) {
  try {
    await chrome.runtime.sendMessage({
      type: "HIGHLIGHT",
      payload: { phrases },
    });
  } catch (err) {
    console.warn("[Popup] Highlight error:", err);
  }
}

async function removeHighlights() {
  try {
    await chrome.runtime.sendMessage({ type: "REMOVE_HIGHLIGHTS" });
  } catch (err) {
    console.warn("[Popup] Remove highlight error:", err);
  }
}

function renderSummary(s, fromCache) {
  // Meta chips
  $("chipReadTime").textContent = `⏱ ${s.readingTimeMinutes ?? "?"} min read`;
  $("chipWords").textContent = `${formatNumber(s.wordCount ?? 0)} words`;

  const sentimentChip = $("chipSentiment");
  const sentiment = (s.sentiment || "neutral").toLowerCase();
  sentimentChip.textContent = sentimentLabel(sentiment);
  sentimentChip.className = `chip chip-sentiment-${sentiment}`;

  const categoryChip = $("chipCategory");
  categoryChip.textContent = categoryLabel(s.category || "other");
  categoryChip.className = "chip chip-category";

  const cacheChip = $("chipCache");
  if (fromCache) {
    cacheChip.removeAttribute("hidden");
    cacheChip.textContent = "⚡ Cached";
  } else {
    cacheChip.setAttribute("hidden", "");
  }

  $("summaryOverview").textContent = decodeEntities(s.summary || "");

  const bulletList = $("bulletList");
  bulletList.innerHTML = "";
  (s.bullets || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = decodeEntities(b);
    bulletList.appendChild(li);
  });

  const insightList = $("insightList");
  insightList.innerHTML = "";
  (s.insights || []).forEach((ins) => {
    const li = document.createElement("li");
    li.textContent = decodeEntities(ins);
    insightList.appendChild(li);
  });

  const termTags = $("termTags");
  termTags.innerHTML = "";
  (s.keyTerms || []).forEach((term) => {
    const span = document.createElement("span");
    span.className = "term-tag";
    span.textContent = decodeEntities(term);
    termTags.appendChild(span);
  });
}

function showState(state) {
  loadingState.hidden = state !== "loading";
  errorState.hidden   = state !== "error";
  emptyState.hidden   = state !== "empty";
  summaryState.hidden = state !== "summary";
}

function showError(msg) {
  errorMessage.textContent = msg;
  showState("error");
}

function setLoadingMessage(msg) {
  loadingText.textContent = msg;
}

function updateHighlightToggle(active) {
  highlightToggle.setAttribute("aria-checked", active ? "true" : "false");
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatNumber(n) {
  return (n || 0).toLocaleString();
}

function sentimentLabel(s) {
  const map = { positive: "😊 Positive", negative: "😟 Negative", neutral: "😐 Neutral", mixed: "🤔 Mixed" };
  return map[s] || s;
}

function categoryLabel(c) {
  const map = {
    article: "📄 Article",
    tutorial: "📚 Tutorial",
    news: "📰 News",
    product: "🛍 Product",
    documentation: "📖 Docs",
    social: "💬 Social",
    other: "🔗 Page",
  };
  return map[c] || c;
}

function decodeEntities(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function buildPlainTextSummary(s) {
  const lines = [];
  lines.push(`📄 SUMMARY`);
  lines.push("─".repeat(40));
  lines.push(decodeEntities(s.summary || ""));
  lines.push("");
  lines.push("KEY POINTS");
  (s.bullets || []).forEach((b, i) => lines.push(`${i + 1}. ${decodeEntities(b)}`));
  lines.push("");
  lines.push("INSIGHTS");
  (s.insights || []).forEach((ins) => lines.push(`• ${decodeEntities(ins)}`));
  lines.push("");
  lines.push(`⏱ ${s.readingTimeMinutes} min read  |  ${formatNumber(s.wordCount)} words`);
  return lines.join("\n");
}
