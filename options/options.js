"use strict";

const $ = (id) => document.getElementById(id);

const providerSelect      = $("providerSelect");
const apiKeyInput         = $("apiKeyInput");
const modelInput          = $("modelInput");
const toggleKeyVisibility = $("toggleKeyVisibility");
const saveSettingsBtn     = $("saveSettingsBtn");
const testConnectionBtn   = $("testConnectionBtn");
const testResult          = $("testResult");
const clearAllCacheBtn    = $("clearAllCacheBtn");
const refreshStatsBtn     = $("refreshStatsBtn");
const statusToast         = $("statusToast");
const navItems            = document.querySelectorAll(".nav-item");
const sections            = document.querySelectorAll(".section");

const DEFAULT_MODELS = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
};

const MODEL_PLACEHOLDERS = {
  anthropic: "e.g. claude-haiku-4-5-20251001",
  openai: "e.g. gpt-4o-mini",
  gemini: "e.g. gemini-1.5-flash",
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  updateProviderHelp(providerSelect.value);
  await refreshCacheStats();
});

navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const targetSection = item.dataset.section;

    navItems.forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

    sections.forEach((s) => {
      s.hidden = s.id !== `${targetSection}-section`;
    });

    if (targetSection === "cache") refreshCacheStats();
  });
});

providerSelect.addEventListener("change", () => {
  updateProviderHelp(providerSelect.value);
  modelInput.placeholder = MODEL_PLACEHOLDERS[providerSelect.value] || "";
});

function updateProviderHelp(provider) {
  ["anthropic", "openai", "gemini"].forEach((p) => {
    $(`help-${p}`).hidden = p !== provider;
  });
  modelInput.placeholder = MODEL_PLACEHOLDERS[provider] || "";
}

toggleKeyVisibility.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  $("eyeIcon").innerHTML = isPassword
    ? `<path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 00-2.79.588l.77.771A5.944 5.944 0 018 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0114.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/><path d="M11.297 9.176a3.5 3.5 0 00-4.474-4.474l.823.823a2.5 2.5 0 012.829 2.829l.822.822zm-2.943 1.299l.822.822a3.5 3.5 0 01-4.474-4.474l.823.823a2.5 2.5 0 002.829 2.829z"/><path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 001.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 018 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709z"/><path d="M13.646 14.354l-12-12 .708-.708 12 12-.708.708z"/>`
    : `<path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 011.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0114.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 011.172 8z"/><path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM4.5 8a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z"/>`;
});

saveSettingsBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSelect.value;
  const model = modelInput.value.trim();

  if (!apiKey) {
    showToast("Please enter an API key.", "error");
    apiKeyInput.focus();
    return;
  }

  await chrome.storage.local.set({ provider, apiKey, model });
  showToast("Settings saved successfully.", "success");
});

testConnectionBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSelect.value;

  if (!apiKey) {
    showTestResult("Please enter an API key first.", "error");
    return;
  }

  testConnectionBtn.disabled = true;
  testConnectionBtn.textContent = "Testing…";
  testResult.hidden = true;

  try {
    // Save temporarily so background can use it
    await chrome.storage.local.set({ provider, apiKey, model: modelInput.value.trim() });

    const result = await chrome.runtime.sendMessage({
      type: "SUMMARIZE",
      payload: {
        url: "test://connection-test",
        content: "This is a connection test. Please respond with a brief summary to confirm the API key works correctly.",
        title: "Connection Test",
        forceRefresh: true,
      },
    });

    if (result?.success) {
      showTestResult("✓ Connection successful! Your API key is working.", "success");
    } else {
      showTestResult(`✗ ${result?.error || "Connection failed."}`, "error");
    }
  } catch (err) {
    showTestResult(`✗ ${err.message}`, "error");
  } finally {
    testConnectionBtn.disabled = false;
    testConnectionBtn.textContent = "Test Connection";
  }
});

clearAllCacheBtn.addEventListener("click", async () => {
  const keys = await getAllCacheKeys();
  await chrome.storage.local.remove(keys);
  showToast(`Cleared ${keys.length} cached summaries.`, "success");
  await refreshCacheStats();
});

refreshStatsBtn.addEventListener("click", refreshCacheStats);

async function getAllCacheKeys() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const cacheKeys = Object.keys(items).filter((k) => k.startsWith("cache:"));
      resolve(cacheKeys);
    });
  });
}

async function refreshCacheStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const cacheEntries = Object.entries(items).filter(([k]) => k.startsWith("cache:"));
      $("cacheCount").textContent = cacheEntries.length;

      const bytes = new TextEncoder().encode(JSON.stringify(items)).length;
      $("cacheSize").textContent = formatBytes(bytes);
      resolve();
    });
  });
}


async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["provider", "apiKey", "model"], (result) => {
      providerSelect.value = result.provider || "anthropic";
      apiKeyInput.value = result.apiKey || "";
      modelInput.value = result.model || "";
      resolve();
    });
  });
}

function showToast(msg, type = "success") {
  statusToast.textContent = msg;
  statusToast.className = `toast ${type}`;
  statusToast.hidden = false;
  setTimeout(() => { statusToast.hidden = true; }, 3000);
}

function showTestResult(msg, type) {
  testResult.textContent = msg;
  testResult.className = `test-result ${type}`;
  testResult.hidden = false;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
