## Project Setup Summary – AI Knowledge Graph

This document summarizes the work done to prepare the AI Knowledge Graph browser extension for git tracking and deployment, and captures a high-level view of the architecture and data flow.

---

## Scope of This Task

- Add a clear, user-facing `README.md` describing:
  - What the extension does.
  - How to install it locally in development mode.
  - How to configure AI providers and routing.
  - How to use extraction, graph building, and graph management.
  - How to package and submit the extension to the Chrome Web Store.
- Add a `.gitignore` suitable for a JavaScript/extension project so the repo is clean and future-proof.
- Create lightweight internal docs:
  - `tasks/todo.md` – Checklist for this setup task.
  - `ProjectSetup_PSUEDOCODE.md` – Pseudocode and plan for git/deployment prep.
  - `ProjectSetup.md` – This summary.

No runtime logic was changed in `background.js`, `content/content.js`, `popup/popup.js`, or other JS/HTML/CSS files.

---

## Key Modules and Responsibilities

### `manifest.json`

- Defines the extension as a **Manifest V3** Chrome extension.
- Declares:
  - Popup entry point: `popup/popup.html`.
  - Background service worker: `background.js`.
  - Content scripts:
    - `content/Readability.js`
    - `content/content.js`
  - Permissions:
    - `activeTab`, `storage`
  - Host permissions:
    - `https://openrouter.ai/*`
    - `https://generativelanguage.googleapis.com/*`
    - Optional broad host permissions for future routing.

### `content/content.js` – Webpage Content Extractor

- Runs in the page context as a **content script**.
- Responsibilities:
  - **Extraction modes**:
    - `fullPage`: auto-scrolls to load long/infinite pages before extraction.
    - `standard`: focuses on article/main/body.
    - `chatTranscript`: heuristically detects chat/message layouts and builds a transcript.
  - **Readability integration**:
    - Uses Mozilla Readability (via `Readability.js`) when available.
    - Falls back to a custom manual extraction that strips navigation, ads, and other noise.
  - **HTML → markdown**:
    - Converts cleaned HTML into structured markdown, handling:
      - Headings, paragraphs, lists, links, images, code blocks, blockquotes, tables, and separators.
  - **Provenance capture**:
    - Extracts canonical vs. visited URL, meta tags, structured data, and basic metadata.
  - **Chat transcript handling**:
    - Scans for message-like elements with a set of selectors.
    - Infers roles (user/assistant/system) from attributes and class names.
    - Builds transcript markdown when enough messages are detected.
  - **Messaging**:
    - Listens for `EXTRACT` messages from the background script.
    - Responds with:
      - Markdown and plain text.
      - Provenance.
      - Stats (mode used, scroll stats, message count).
      - Warnings and timestamps.

### `background.js` – Service Worker

- Acts as a **router** between the popup and the active tab’s content script.
- Responsibilities:
  - Validates messages and senders.
  - For `EXTRACT_CONTENT`:
    - Looks up the active tab.
    - Sends an `EXTRACT` message to the corresponding content script.
    - Forwards the extraction result (or a structured error) back to the popup.
  - For `GET_PAGE_INFO`:
    - Returns the active tab’s URL and title to the popup.
  - On installation:
    - Seeds `chrome.storage.local` with:
      - An empty `graphs` array.
      - Default `settings` including AI provider, model, routing, and default extraction mode.

### `popup/popup.js` – Popup Controller & Graph Manager

- Runs in the extension popup and orchestrates:
  - UI interactions.
  - Storage of settings and graphs.
  - Communication with the background/content scripts.
  - AI calls for entity/relationship extraction.
  - Canvas-based graph visualization.
- Key responsibilities (selected, not exhaustive):
  - **State normalization**:
    - `DEFAULT_SETTINGS` object and `normalizeSettings` helper keep settings in a valid, safe shape.
    - `normalizeGraphs` and related functions sanitize loaded/imported graph data.
  - **Settings & permissions**:
    - Supports AI providers (`gemini`, `openai`, `anthropic`, `minimax`) and routes (`openrouter`, `aiGateway`, `direct`).
    - Uses `ensureGatewayPermission` to request appropriate origin permissions when using a custom AI gateway URL.
  - **Graph lifecycle**:
    - Creates empty graphs with metadata (id, name, timestamps, sources).
    - Adds nodes and edges based on AI output.
    - Normalizes provenance from extraction results and attaches it to graphs.
    - Tracks node/edge counts for UI display.
  - **Visualization**:
    - Renders graphs onto a `<canvas>` using type-based coloring.
    - Supports focusing/highlighting nodes and showing details in a side panel.
  - **Import/export**:
    - Serializes graphs to JSON for export.
    - Imports graphs with validation and normalization.
  - **Integration with content extraction**:
    - Sends `EXTRACT_CONTENT` and `GET_PAGE_INFO` requests to the background script.
    - Receives extraction payload, previews markdown, and then passes it (plus provenance) to the chosen AI backend for graph building.

### `popup/popup.html` & `popup/popup.css`

- Provide the UI shell:
  - Header with title and settings button.
  - Tabs: **Extract**, **Graph**, **Manage**, **Settings**.
  - Panels for:
    - Configuring extraction.
    - Viewing extracted markdown and warnings.
    - Selecting/creating graphs and triggering AI analysis.
    - Visualizing and inspecting graphs.
    - Managing graphs and inspecting sources.
    - Configuring AI provider/routing, API key, gateway URL, auto-extract, and default extraction mode.

---

## Data Flow Overview

High-level data flow for a typical “extract and analyze” operation:

1. **User opens popup on a page**
   - Popup requests page info via `GET_PAGE_INFO`.
   - Background service worker returns URL and title.

2. **User triggers extraction**
   - Popup validates settings and extraction mode.
   - Popup sends `EXTRACT_CONTENT` to `background.js` with:
     - Mode (`fullPage`, `standard`, `chatTranscript`).
     - Scroll configuration.
     - Chat extraction options (if applicable).

3. **Background → Content script**
   - `background.js` locates the active tab.
   - Sends `EXTRACT` to `content/content.js` in that tab.

4. **Content script extraction**
   - Auto-scroll (for `fullPage`) if requested.
   - Attempts Readability-based extraction; falls back to manual if needed.
   - Optionally runs chat transcript detection/formatting.
   - Returns:
     - Markdown and plain text content.
     - Provenance and metadata.
     - Stats and warnings.

5. **Popup receives extraction result**
   - Shows markdown preview and any warnings.
   - Lets the user pick or create a graph.

6. **AI graph analysis**
   - When the user clicks “Analyze & Add to Graph”:
     - Popup constructs an AI request with the extracted markdown and provenance.
     - Sends the request via the selected routing:
       - Direct provider API.
       - OpenRouter.
       - Custom AI gateway.
     - Receives entities/relationships and normalizes them into nodes and edges.
   - Stores updated graphs and sources in `chrome.storage.local`.

7. **Graph visualization & management**
   - Graph tab renders the graph on canvas.
   - Manage tab provides CRUD and import/export for graphs.

---

## Git & Deployment Notes

### Git

- This repo already contains a `.git` directory; no `git init` was run as part of this task.
- A `.gitignore` was added to exclude:
  - OS cruft (`.DS_Store`, `Thumbs.db`).
  - Editor/IDE directories (`.vscode/`, `.idea/`).
  - Node/JS tooling directories (`node_modules/`, `dist/`, `build/`, `coverage/`, etc.).
  - Logs and environment files (`*.log`, `.env*`).
  - Tooling caches (e.g. `.cursor/`, `.cache/`).
- You remain in full control of:
  - When to create commits.
  - How to structure branches.
  - Which remote(s) to attach.

### Deployment

- There is no bundling/build step; the extension runs directly from the source files.
- For **local development**:
  - Use `chrome://extensions` → **Developer mode** → **Load unpacked** pointing at this project directory.
- For **Chrome Web Store**:
  - Add proper icons under `icons/` to match the paths in `manifest.json`.
  - Optionally copy the extension into a clean folder and remove non-runtime files (git metadata, internal docs, etc.).
  - Zip the folder and upload through the Chrome Web Store Developer Dashboard.
  - Provide a clear description, screenshots, and a privacy policy covering page data and AI API usage.

---

## Files Added by This Task

- `tasks/todo.md`
  - Checkable plan for this setup work.
- `ProjectSetup_PSUEDOCODE.md`
  - Pseudocode describing how git/deployment prep should be performed.
- `README.md`
  - User-facing documentation for installation, configuration, usage, and deployment.
- `.gitignore`
  - Git hygiene for this project and likely future Node/JS tooling.
- `ProjectSetup.md`
  - This summary and architecture/data-flow overview.

