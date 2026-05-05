
(function () {
  "use strict";

  // Guard against double-injection
  if (window.__aiSummarizerInjected) return;
  window.__aiSummarizerInjected = true;

  const HIGHLIGHT_CLASS = "ai-summarizer-highlight";
  const HIGHLIGHT_MARK_ATTR = "data-ai-summarizer";


  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    switch (message.type) {
      case "EXTRACT_CONTENT":
        sendResponse({ success: true, content: extractPageContent() });
        break;

      case "APPLY_HIGHLIGHTS":
        applyHighlights(message.payload.phrases || []);
        sendResponse({ success: true });
        break;

      case "REMOVE_HIGHLIGHTS":
        removeHighlights();
        sendResponse({ success: true });
        break;

      case "PING":
        sendResponse({ success: true, alive: true });
        break;
    }
    return false;
  });

 
  function extractPageContent() {
    // Clone body to avoid mutating the live DOM
    const bodyClone = document.body.cloneNode(true);

    // Remove noise elements from the clone
    const noiseSelectors = [
      "nav", "header", "footer", "aside",
      '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
      ".nav", ".navigation", ".sidebar", ".side-bar", ".widget",
      ".advertisement", ".ad", ".ads", ".advert", ".promo",
      ".cookie-banner", ".cookie-notice", ".popup", ".modal",
      ".social-share", ".share-buttons", ".related-posts",
      ".comments", "#comments", ".comment-section",
      "script", "style", "noscript", "iframe", "form",
      ".menu", "#menu", ".navbar",
    ];
    noiseSelectors.forEach((sel) => {
      bodyClone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Priority 1: <article>
    const article = bodyClone.querySelector("article");
    if (article) return cleanText(article.innerText || article.textContent);

    // Priority 2: <main> or [role="main"]
    const main =
      bodyClone.querySelector("main") ||
      bodyClone.querySelector('[role="main"]');
    if (main) return cleanText(main.innerText || main.textContent);

    // Priority 3: CMS content selectors
    const cmsSelectors = [
      ".post-content", ".post-body", ".entry-content", ".entry-body",
      ".article-content", ".article-body", ".story-body",
      ".page-content", "#content", ".content",
      ".prose", "[itemprop='articleBody']",
    ];
    for (const sel of cmsSelectors) {
      const el = bodyClone.querySelector(sel);
      if (el) {
        const text = cleanText(el.innerText || el.textContent);
        if (text.length > 200) return text;
      }
    }

    // Priority 4: Find the container with the most <p> text
    const best = findRichestParagraphContainer(bodyClone);
    if (best) return cleanText(best);

    // Priority 5: Full body fallback
    return cleanText(bodyClone.innerText || bodyClone.textContent);
  }

  function findRichestParagraphContainer(root) {
    let best = null;
    let bestScore = 0;

    const candidates = root.querySelectorAll(
      "div, section, article, main, td"
    );
    candidates.forEach((el) => {
      const paragraphs = el.querySelectorAll("p");
      if (paragraphs.length < 2) return;

      let score = 0;
      paragraphs.forEach((p) => {
        score += (p.textContent || "").trim().length;
      });

      if (score > bestScore) {
        bestScore = score;
        best = el.innerText || el.textContent;
      }
    });

    return bestScore > 300 ? best : null;
  }

  function cleanText(raw) {
    if (!raw) return "";
    return raw
      .replace(/\t/g, " ")                       
      .replace(/[ \t]+/g, " ")                   
      .replace(/\n{3,}/g, "\n\n")               
      .replace(/^\s+|\s+$/g, "")                 
      .slice(0, 50000);                           
  }

  function applyHighlights(phrases) {
    if (!phrases || phrases.length === 0) return;
    removeHighlights(); // clean up any previous highlights

    // Inject styles once
    injectHighlightStyles();

    // Walk text nodes and wrap matches
    const seen = new Set();
    phrases.forEach((phrase) => {
      const trimmed = phrase.trim();
      if (!trimmed || trimmed.length < 4 || seen.has(trimmed.toLowerCase()))
        return;
      seen.add(trimmed.toLowerCase());
      highlightPhrase(document.body, trimmed);
    });
  }

  function highlightPhrase(root, phrase) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("script,style,noscript,head")) return NodeFilter.FILTER_REJECT;
          if (parent.getAttribute(HIGHLIGHT_MARK_ATTR)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedPhrase})`, "gi");

    nodes.forEach((textNode) => {
      const text = textNode.textContent;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index))
          );
        }
        const mark = document.createElement("mark");
        mark.className = HIGHLIGHT_CLASS;
        mark.setAttribute(HIGHLIGHT_MARK_ATTR, "1");
        mark.textContent = match[0];
        fragment.appendChild(mark);
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  function removeHighlights() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function injectHighlightStyles() {
    if (document.getElementById("ai-summarizer-styles")) return;
    const style = document.createElement("style");
    style.id = "ai-summarizer-styles";
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background: linear-gradient(120deg, rgba(255, 213, 79, 0.6) 0%, rgba(255, 183, 3, 0.5) 100%);
        border-radius: 2px;
        padding: 0 2px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        transition: background 0.2s ease;
        cursor: pointer;
      }
      .${HIGHLIGHT_CLASS}:hover {
        background: linear-gradient(120deg, rgba(255, 183, 3, 0.8) 0%, rgba(255, 149, 0, 0.7) 100%);
      }
    `;
    document.head.appendChild(style);
  }
})();
