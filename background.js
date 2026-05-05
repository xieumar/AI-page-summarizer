
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "./config.js";

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiKey", "model"], (result) => {
      resolve({
        apiKey: result.apiKey || OPENROUTER_API_KEY,
        model: result.model || OPENROUTER_MODEL || "google/gemini-2.0-flash-001"
      });
    });
  });
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (message.type === "SUMMARIZE") {
    handleSummarize(message.payload).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message || "Unknown error" });
    });
    return true;
  }

  if (message.type === "CLEAR_CACHE") {
    clearCacheForUrl(message.payload.url).then(sendResponse);
    return true;
  }

  if (message.type === "HIGHLIGHT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "APPLY_HIGHLIGHTS",
          payload: message.payload,
        });
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "REMOVE_HIGHLIGHTS") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "REMOVE_HIGHLIGHTS" });
      }
    });
    sendResponse({ success: true });
    return true;
  }

  return false;
});

async function handleSummarize({ url, content, title, forceRefresh = false }) {
  if (!url || !content) {
    throw new Error("Missing required fields: url and content.");
  }

  if (!forceRefresh) {
    const cached = await getCachedSummary(url);
    if (cached) {
      return { success: true, summary: cached, fromCache: true };
    }
  }

  const settings = await getSettings();
  const { apiKey, model } = settings;

  if (!apiKey || apiKey.includes("YOUR_OPENROUTER_API_KEY_HERE")) {
    throw new Error("OpenRouter API key not found. Please add your key to the extension settings.");
  }

  const prompt = buildPrompt(title, content);
  const summary = await callOpenRouter(prompt, apiKey, model);
  const parsed = parseSummaryResponse(summary);

  await cacheSummary(url, parsed);
  return { success: true, summary: parsed, fromCache: false };
}

function buildPrompt(title, content) {
  const truncated = content.slice(0, 12000);
  return `You are a precise content analyst. Analyze the following webpage and return a structured JSON summary.

Page Title: ${title || "Unknown"}

Page Content:
${truncated}

Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence overview",
  "bullets": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
  "insights": ["Insight 1", "Insight 2", "Insight 3"],
  "keyTerms": ["term1", "term2", "term3"],
  "sentiment": "positive|negative|neutral|mixed",
  "category": "article|tutorial|news|product|documentation|social|other",
  "wordCount": 0,
  "readingTimeMinutes": 0,
  "highlightPhrases": ["phrase 1", "phrase 2"]
}

Rules:
- All text must be safe and free of HTML/script injection.`;
}

async function callOpenRouter(prompt, apiKey, model) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://summarizer.extension",
      "X-Title": "AI Page Summarizer",
    },
    body: JSON.stringify({
      model: model || "google/gemini-2.0-flash-001",
      messages: [
        { role: "system", content: "You are a precise content analyst. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  await assertOk(response, "OpenRouter");
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function assertOk(response, provider) {
  if (!response.ok) {
    let errorMsg = `${provider} error: ${response.status}`;
    try {
      const errData = await response.json();
      errorMsg += ` — ${errData.error?.message || JSON.stringify(errData)}`;
    } catch (_) { }
    throw new Error(errorMsg);
  }
}

function parseSummaryResponse(raw) {
  let clean = raw.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI returned invalid JSON.");
    parsed = JSON.parse(match[0]);
  }
  return sanitizeObject(parsed);
}

function sanitizeString(str) {
  if (typeof str !== "string") return str;
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function sanitizeObject(obj) {
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === "object" && obj !== null) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[sanitizeString(k)] = sanitizeObject(v);
    return out;
  }
  return obj;
}

async function getCachedSummary(url) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`cache:${url}`, (result) => {
      const entry = result[`cache:${url}`];
      if (!entry || Date.now() - entry.timestamp > CACHE_TTL_MS) return resolve(null);
      resolve(entry.data);
    });
  });
}

async function cacheSummary(url, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [`cache:${url}`]: { data, timestamp: Date.now() } }, resolve);
  });
}

async function clearCacheForUrl(url) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(`cache:${url}`, () => resolve({ success: true }));
  });
}