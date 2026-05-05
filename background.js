
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "./config.js";


async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["provider", "apiKey", "model"], (result) => {
      resolve({
        provider: result.provider || "openrouter",
        apiKey: result.apiKey || OPENROUTER_API_KEY,
        model: result.model || OPENROUTER_MODEL
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
  const apiKey = settings.apiKey;
  const model = settings.model;

  if (!apiKey || apiKey.includes("YOUR_OPENROUTER_API_KEY_HERE")) {
    throw new Error("API key not found. Please add your key to the extension settings or 'config.js'.");
  }

  const prompt = buildPrompt(title, content);

  //  Call AI provider (Currently defaults to OpenRouter)
  const summary = await callOpenRouter(prompt, apiKey, model);


  const parsed = parseSummaryResponse(summary);


  await cacheSummary(url, parsed);

  return { success: true, summary: parsed, fromCache: false };
}

function buildPrompt(title, content) {
  const truncated = content.slice(0, 12000); // stay within token limits
  return `You are a precise content analyst. Analyze the following webpage and return a structured JSON summary.

Page Title: ${title || "Unknown"}

Page Content:
${truncated}

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "summary": "2-3 sentence overview of what this page is about",
  "bullets": [
    "Key point 1",
    "Key point 2",
    "Key point 3",
    "Key point 4",
    "Key point 5"
  ],
  "insights": [
    "Important insight or takeaway 1",
    "Important insight or takeaway 2",
    "Important insight or takeaway 3"
  ],
  "keyTerms": ["term1", "term2", "term3"],
  "sentiment": "positive|negative|neutral|mixed",
  "category": "article|tutorial|news|product|documentation|social|other",
  "wordCount": <estimated word count as number>,
  "readingTimeMinutes": <estimated reading time as number>,
  "highlightPhrases": [
    "exact short phrase from text worth highlighting",
    "another exact short phrase from text"
  ]
}

Rules:
- bullets: exactly 4-6 concise bullet points covering the main points
- insights: exactly 2-4 actionable or notable insights
- keyTerms: 3-8 important terms/concepts from the content
- highlightPhrases: 3-6 exact short phrases (< 60 chars each) that appear verbatim in the source text
- wordCount: approximate count of words in the content
- readingTimeMinutes: based on 200 words/minute average reading speed
- All text must be safe, sanitized, and free of any HTML/script injection`;
}

async function callOpenRouter(prompt, apiKey, model) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://summarizer.extension", // Optional, for OpenRouter analytics
      "X-Title": "AI Page Summarizer",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a precise content analyst. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" }, // Ensure JSON output
    }),
  });

  await assertOk(response, "OpenRouter");
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function assertOk(response, provider) {
  if (!response.ok) {
    let errorMsg = `${provider} API error: ${response.status}`;
    try {
      const errData = await response.json();
      const detail =
        errData.error?.message ||
        errData.message ||
        JSON.stringify(errData).slice(0, 200);
      errorMsg += ` — ${detail}`;
    } catch (_) {}

    if (response.status === 401) throw new Error("Invalid API key. Check your settings.");
    if (response.status === 429) throw new Error("Rate limit exceeded. Please wait and try again.");
    if (response.status === 402 || response.status === 403)
      throw new Error("Quota exceeded or billing issue. Check your account.");
    throw new Error(errorMsg);
  }
}

function parseSummaryResponse(raw) {
  // Strip markdown code fences if model included them anyway
  let clean = raw.trim();
  clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    // Last-ditch: try to extract JSON substring
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI returned invalid JSON. Please try again.");
    parsed = JSON.parse(match[0]);
  }

  // Sanitize all string fields to prevent XSS
  return sanitizeObject(parsed);
}

function sanitizeString(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function sanitizeObject(obj) {
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === "object" && obj !== null) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[sanitizeString(k)] = sanitizeObject(v);
    }
    return out;
  }
  return obj; // number, boolean, null
}

function cacheKey(url) {
  return `cache:${url}`;
}

async function getCachedSummary(url) {
  return new Promise((resolve) => {
    chrome.storage.local.get(cacheKey(url), (result) => {
      const entry = result[cacheKey(url)];
      if (!entry) return resolve(null);
      if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        chrome.storage.local.remove(cacheKey(url));
        return resolve(null);
      }
      resolve(entry.data);
    });
  });
}

async function cacheSummary(url, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [cacheKey(url)]: { data, timestamp: Date.now() } },
      resolve
    );
  });
}

async function clearCacheForUrl(url) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(cacheKey(url), () =>
      resolve({ success: true })
    );
  });
}