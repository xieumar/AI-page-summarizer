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
This extension requires an OpenRouter API key to function. OpenRouter is used as the unified gateway to ensure consistent performance across various AI models. There are two ways to configure your key:

### Option 1: Extension Settings (Recommended)
1.  Access the extension Settings by right-clicking the extension icon and selecting "Options".
2.  Enter your API key in the provided field and click "Save Settings".
3.  The key is stored securely in `chrome.storage.local`.

### Option 2: Local Configuration File
1.  In the project root, rename `config.example.js` to `config.js`.
2.  Open `config.js` and enter your API key:
    ```javascript
    export const OPENROUTER_API_KEY = "your-key-here";
    ```
3.  `config.js` is included in the `.gitignore` file, ensuring your key is never committed to version control.


## Architecture
The extension is built on the Manifest V3 standard, utilizing a modular service worker architecture:

*   Background Service Worker (background.js): Handles all network requests to the AI provider. This ensures that the API key is never exposed to the client-side content scripts or the DOM of the visited page.
*   Content Script (content.js): Responsible for DOM analysis and text extraction. It communicates with the background worker via secure message passing.
*   Popup UI: A vanilla HTML/CSS/JS interface that provides the primary user interaction point.
*   Options Page: A dedicated interface for persisting user configuration to `chrome.storage.local`.

## Security Implementation
Security is a core requirement of this project. The following measures have been implemented:

*   Secret Protection: API keys are handled via `chrome.storage.local` (UI-based) or a local `config.js` file (file-based). Both methods ensure that keys are never hardcoded in the primary source code or committed to version control (enforced via `.gitignore`).

*   Data Sanitization: All AI-generated content is sanitized before injection into the UI to prevent Cross-Site Scripting (XSS) attacks.
*   Origin Validation: The background worker validates the origin of all incoming messages to ensure they originate from within the extension.
*   Minimal Permissions: The extension requests only the necessary permissions (`activeTab`, `storage`, `scripting`) to maintain user privacy.

## Technical Decisions & Trade-offs
*   Unified API (OpenRouter): OpenRouter was selected to provide a single, stable interface for multiple models. This prevents the need for provider-specific dependencies and simplifies the maintenance of the extension.
*   Heuristic Analysis: Rather than relying on external libraries like Readability.js, the extension uses a custom heuristic extraction script. This minimizes the extension's footprint and improves performance while maintaining high accuracy for article-based content.
*   Local Caching: A 30-minute cache TTL was selected to balance content freshness with API efficiency.

