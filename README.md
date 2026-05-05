# AI Page Summarizer — Browser Extension (Manifest V3)

## Introduction
The AI Page Summarizer is a Chromium-based extension designed to provide users with concise, structured summaries of web content. By leveraging advanced language models through the OpenRouter API, the extension extracts the core message of any article or webpage, providing bullet points, key insights, and reading time estimates.

## Features
*   Structured Summarization: Generates an overview, key points, and actionable insights.
*   Intelligent Content Extraction: Uses a heuristic algorithm to identify the main article content while filtering out noise such as advertisements and navigation bars.
*   Reading Metrics: Calculates word count and estimated reading time.
*   In-Page Highlighting: Optionally highlights key phrases from the summary directly on the webpage.
*   Local Caching: Saves summaries for 30 minutes per URL to optimize performance and reduce API costs.

## Installation
1.  Clone or download the repository to your local machine.
2.  Navigate to `chrome://extensions` in your Google Chrome browser.
3.  Enable "Developer mode" in the top-right corner.
4.  Click "Load unpacked" and select the project directory.

## Configuration
This extension requires an OpenRouter API key to function. OpenRouter is used as the unified gateway to ensure consistent performance across various AI models.

1.  Obtain an API key from [OpenRouter.ai](https://openrouter.ai/).
2.  Access the extension Settings by right-clicking the extension icon and selecting "Options".
3.  Enter your API key in the provided field and click "Save Settings".
4.  The default model is `google/gemini-2.0-flash-001`, but you may specify any OpenRouter-supported model in the settings.

## Architecture
The extension is built on the Manifest V3 standard, utilizing a modular service worker architecture:

*   Background Service Worker (background.js): Handles all network requests to the AI provider. This ensures that the API key is never exposed to the client-side content scripts or the DOM of the visited page.
*   Content Script (content.js): Responsible for DOM analysis and text extraction. It communicates with the background worker via secure message passing.
*   Popup UI: A vanilla HTML/CSS/JS interface that provides the primary user interaction point.
*   Options Page: A dedicated interface for persisting user configuration to `chrome.storage.local`.

## Security Implementation
Security is a core requirement of this project. The following measures have been implemented:

*   Secret Protection: API keys are stored exclusively in `chrome.storage.local`. They are never hardcoded in the source code or committed to version control (enforced via `.gitignore`).
*   Data Sanitization: All AI-generated content is sanitized before injection into the UI to prevent Cross-Site Scripting (XSS) attacks.
*   Origin Validation: The background worker validates the origin of all incoming messages to ensure they originate from within the extension.
*   Minimal Permissions: The extension requests only the necessary permissions (`activeTab`, `storage`, `scripting`) to maintain user privacy.

## Technical Decisions & Trade-offs
*   Unified API (OpenRouter): OpenRouter was selected to provide a single, stable interface for multiple models. This prevents the need for provider-specific dependencies and simplifies the maintenance of the extension.
*   Heuristic Analysis: Rather than relying on external libraries like Readability.js, the extension uses a custom heuristic extraction script. This minimizes the extension's footprint and improves performance while maintaining high accuracy for article-based content.
*   Local Caching: A 30-minute cache TTL was selected to balance content freshness with API efficiency.

