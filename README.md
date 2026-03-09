## AI Knowledge Graph – Browser Extension

Extract rich context from any webpage and turn it into an interactive knowledge graph with AI-powered entity and relationship extraction.

This extension powers up reading, research, and sense‑making workflows by:

- **Extracting clean markdown** from articles, docs, and chats using Mozilla Readability and custom fallbacks
- **Capturing provenance** (URLs, titles, metadata, timestamps) alongside the extracted content
- **Building knowledge graphs** from text with AI entity/relationship detection
- **Visualizing graphs** in a canvas-based UI for exploration
- **Persisting graphs** locally with import/export for backup and sharing

---

## Features

- **Flexible extraction modes**
  - **Full Document (Auto-scroll)**: Scrolls the page to load dynamic content, then extracts the full document.
  - **Standard (Main Article/Body)**: Focuses on the main article or body region.
  - **Chat Transcript (Heuristic)**: Detects chat-style layouts and converts conversations into a structured transcript.
- **High-quality markdown output**
  - Uses Mozilla Readability (bundled) where possible.
  - Falls back to a custom HTML → markdown converter for non-article pages.
  - Preserves headings, lists, code blocks, tables, links, and images where possible.
- **Provenance & metadata**
  - Tracks canonical vs. visited URL, title, description, site name, author, publish date, keywords, and OG image.
  - Embeds provenance into the extracted markdown and makes it available for downstream processing.
- **AI-powered graph building**
  - Uses your chosen AI provider to detect entities, topics, and relationships.
  - Builds a graph of nodes and edges representing concepts and how they connect.
  - Stores graphs in `chrome.storage.local` so they persist between sessions.
- **Interactive visualization**
  - Canvas-based graph viewer with node highlighting and detail view.
  - Node detail panel shows type, description, and connections.
- **Graph management**
  - Multiple named graphs.
  - Source list per graph so you can see which pages contributed.
  - JSON import/export for backup and sharing.

---

## Project Structure

At a high level:

- `manifest.json` – Chrome Manifest V3 configuration.
- `background.js` – Service worker that routes messages and initializes default settings.
- `content/Readability.js` – Bundled Mozilla Readability library.
- `content/content.js` – Content script that:
  - Auto-scrolls the page for full extraction.
  - Runs Readability or a manual extraction fallback.
  - Detects chat transcripts when requested.
  - Returns markdown, plain text, provenance, stats, and warnings.
- `popup/popup.html` – Popup UI shell (tabs, layout, settings).
- `popup/popup.css` – Styling for the popup.
- `popup/popup.js` – Popup logic:
  - Manages settings and storage.
  - Calls the background script for extraction.
  - Sends extracted content to AI providers.
  - Manages graphs, nodes, edges, and visualization.
- `background.js` – Bridges popup ↔ content script and manages initial storage.
- `tasks/todo.md` – High-level task list for project setup and maintenance.
- `ProjectSetup_PSUEDOCODE.md` – Pseudocode for this git/deployment setup task.
- `ProjectSetup.md` – (Created by this task) Human-readable summary of setup and architecture.

> **Note on icons**: `manifest.json` references icons under `icons/` (e.g. `icons/icon16.png`). For local development Chrome will fall back to a default icon if these are missing, but you will need to provide real icons for store submission.

---

## Getting Started (Development Install)

### Prerequisites

- **Browser**: Latest Chrome or any Chromium-based browser that supports Manifest V3.

### Clone and load the extension

1. **Clone the repo**
   ```bash
   git clone <your-repo-url> webpage-to-knowledge-graph
   cd webpage-to-knowledge-graph
   ```
2. **Open the Extensions page**
   - Navigate to `chrome://extensions` in Chrome.
3. **Enable Developer Mode**
   - Toggle **Developer mode** on (top-right of the page).
4. **Load unpacked**
   - Click **“Load unpacked”**.
   - Select the `webpage-to-knowledge-graph` directory.
5. **Pin the extension (optional)**
   - Click the puzzle-piece icon in the Chrome toolbar.
   - Pin **AI Knowledge Graph** for faster access.

Whenever you modify the source files, click **“Reload”** on the extension card in `chrome://extensions` to pick up changes.

---

## Configuration & Settings

All settings are stored locally via `chrome.storage.local` and are scoped to your browser profile. They are only used to call the AI endpoints you configure; they are not sent anywhere else by the extension itself.

Open the popup and click the **settings icon** in the header to configure:

- **AI Routing**
  - `openrouter` – Send AI calls via `https://openrouter.ai/` using your OpenRouter API key.
  - `aiGateway` – Use a custom OpenAI-compatible gateway (e.g. self-hosted proxy).
  - `direct` – Call provider APIs directly (e.g. Gemini).
- **AI Provider**
  - `gemini`
  - `openai`
  - `anthropic`
  - `minimax`
- **AI Model**
  - Backed by `AI_MODEL_REGISTRY` in `popup.js`.
  - Example options (subject to change as code evolves):
    - Gemini 2.5 Pro / 2.0 Flash
    - GPT-4o / GPT-4o Mini
    - Claude Sonnet / Haiku
    - MiniMax-01
- **Provider API Key**
  - Required for any AI-based graph analysis.
  - Stored in `chrome.storage.local` for your current browser profile.
- **Gateway Base URL**
  - Only used when `aiRouting = aiGateway`.
  - Must be an HTTPS URL; the popup validates and normalizes this.
- **Auto-extract on page load**
  - If enabled, the extension can automatically kick off extraction when you open pages.
- **Default Extraction Mode**
  - One of `fullPage`, `standard`, or `chatTranscript`.

### Permissions & Host Access

From `manifest.json`:

- `"permissions"`:
  - `activeTab` – Needed to read the current page when you click the popup.
  - `storage` – Used for storing graphs and extension settings.
- `"host_permissions"`:
  - `https://openrouter.ai/*`
  - `https://generativelanguage.googleapis.com/*`
- `"optional_host_permissions"`:
  - `https://*/*` – Allows requesting additional origins at runtime (e.g. for a custom AI gateway).

The popup may request additional origins when you configure a custom gateway URL so it can make fetch calls there.

---

## Usage

### 1. Extract content

1. Navigate to a page you care about:
   - Article, blog post, research paper.
   - Long-form documentation or knowledge base page.
   - AI/chat interface (for transcript mode).
2. Open the **AI Knowledge Graph** popup.
3. In the **Extract** tab:
   - Choose an **Extraction Mode**:
     - **Full Document (Auto-scroll)** for infinite scroll or long pages.
     - **Standard (Main Article/Body)** for typical articles.
     - **Chat Transcript (Heuristic)** for chat UIs.
   - (Optional) Adjust scroll parameters for full-page extraction:
     - Max passes, wait time, timeout.
4. Click **“Extract Page Content”**.
5. Wait for extraction to complete:
   - The status area shows progress and any warnings.
   - Extracted markdown is shown in the `Extracted Markdown` panel.
   - You can click **Copy** to copy the markdown to your clipboard.

### 2. Analyze with AI and add to a graph

1. In the **Extract** tab, after extraction:
   - Choose an existing graph from the **graph selector**, or
   - Click **“+”** to create a new graph name.
2. Click **“Analyze & Add to Graph”**:
   - The popup sends the markdown, along with provenance info, to the configured AI provider.
   - The AI returns entities, topics, and relationships.
   - The extension normalizes and stores these as nodes and edges in the selected graph.

### 3. Explore the graph

1. Switch to the **Graph** tab:
   - View the graph on a canvas.
   - Hover/click nodes to focus them.
2. Use the **Node Detail** panel:
   - See node type, label, description, and connections.
3. Watch **node/edge counts** in the graph stats bar.

### 4. Manage graphs and sources

1. Switch to the **Manage** tab:
   - Create new graphs.
   - View a list of existing graphs.
2. Inspect **Sources**:
   - See which URLs and titles contributed to the active graph.
3. Use **Export All Graphs** to download a JSON backup.
4. Use **Import Graphs** to restore from a previous export.

---

## Git Tracking Setup

This project is already initialized as a git repository (`.git/` exists). To make tracking cleaner:

- A `.gitignore` file (added by this setup task) is recommended to exclude:
  - OS files (e.g. `.DS_Store`)
  - Editor/project files (e.g. `.vscode/`, `.idea/`)
  - Node artifacts (e.g. `node_modules/`, `dist/`, `build/`, `coverage/`)
  - Logs and environment files (e.g. `*.log`, `.env*`)
  - Tooling caches (e.g. `.cursor/`, `.cache/`)

### Example initial setup

```bash
git status       # Review tracked/untracked files
git add .        # Stage files you want to track
git commit -m "chore: initialize AI Knowledge Graph extension"
git remote add origin <your-remote-url>   # if not already set
git push -u origin main                   # or your preferred branch
```

> **Note**: This repository intentionally does not create commits or configure remotes for you. You remain in full control of your git history and hosting.

---

## Deployment & Packaging

There is no build step today; the extension is shipped as plain HTML/CSS/JS with a Manifest V3 config. Packaging is therefore straightforward.

### Local manual install (unpacked)

Follow the **Getting Started** steps above and use **“Load unpacked”** in `chrome://extensions`.

### Chrome Web Store submission

1. **Add icons**
   - Provide icon PNGs at the paths referenced in `manifest.json`:
     - `icons/icon16.png`
     - `icons/icon48.png`
     - `icons/icon128.png`
   - Use a transparent background and follow Chrome’s icon guidelines.
2. **Prepare a production build folder**
   - Copy the project into a clean folder.
   - Remove non-extension files if desired:
     - `.git/`, `.gitignore`
     - `tasks/`, `ProjectSetup_PSUEDOCODE.md`, `ProjectSetup.md`
     - Any local tooling artifacts that are not needed at runtime.
3. **Create a ZIP package**
   - From inside the extension folder:
     ```bash
     zip -r ai-knowledge-graph.zip .
     ```
4. **Submit to the Chrome Web Store**
   - Create a developer account if you don’t already have one.
   - Upload the ZIP package via the Developer Dashboard.
   - Provide:
     - Clear description and screenshots.
     - A privacy policy describing how page content and API keys are used.
     - Any additional information required by the store.
5. **Review & updates**
   - After approval, publish the extension.
   - For updates, bump the `version` in `manifest.json`, re‑zip, and upload a new package.

---

## Contributing

- Fork or clone this repository.
- Use feature branches for work:
  - `git checkout -b feat/better-graph-layout`
- Test changes manually:
  - Reload the extension in `chrome://extensions`.
  - Exercise extraction, AI analysis, and graph visualization.
- Open a pull request or push to your chosen remote.

Please keep changes focused and small, and favor clarity over cleverness—especially in content extraction and AI wiring logic.

