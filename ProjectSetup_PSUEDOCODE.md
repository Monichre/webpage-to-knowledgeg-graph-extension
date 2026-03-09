## Project Setup Pseudocode – Git Tracking & Deployment

Goal: Prepare the AI Knowledge Graph browser extension for clean git tracking and straightforward local/developer deployment.

```text
1. Confirm workspace context
   - Assume project root is `webpage-to-knowledge-graph`
   - Note existing files: `manifest.json`, `background.js`, `content/content.js`, `popup/*`, `.git/`, `CLAUDE.md`, `.agents/`, `skills-lock.json`
   - Do NOT modify runtime JS logic for this task

2. Git tracking readiness
   - Detect that `.git/` already exists → repo initialized
   - Add `.gitignore` with:
     - OS noise: `.DS_Store`, `Thumbs.db`
     - Editor noise: `.vscode/`, `.idea/`
     - Node/JS defaults (future-proofing): `node_modules/`, `dist/`, `build/`, `coverage/`
     - Logs and environment files: `*.log`, `npm-debug.log*`, `.env*`
     - AI/tooling artifacts: `.cursor/`, `.cache/`, `*.tmp`
   - Leave commit/remote configuration to the user (do not create commits or remotes)

3. README authoring
   - Create `README.md` with sections:
     - Title + tagline
       - Use extension name from `manifest.json` (`AI Knowledge Graph`)
       - One-line description from manifest `description`
     - Features
       - Bullet points describing:
         - Full-page / article / chat transcript extraction (from `content/content.js` and popup UI)
         - Markdown output and provenance capture
         - AI-powered entity + relationship extraction to build knowledge graphs
         - Canvas-based interactive graph visualization
         - Graph persistence in `chrome.storage.local` with import/export
     - Project structure
       - Brief overview of:
         - `manifest.json`
         - `background.js`
         - `content/Readability.js` + `content/content.js`
         - `popup/popup.html` / `popup.css` / `popup.js`
         - `tasks/` and doc files (`ProjectSetup_PSUEDOCODE.md`, `ProjectSetup.md`)
     - Getting started (development install)
       - Prereqs: Chrome or Chromium-based browser
       - Steps:
         1. Clone repo
         2. Open `chrome://extensions`
         3. Enable Developer Mode
         4. Click “Load unpacked” and select project root
       - Note that icons referenced in `manifest.json` must be added for store submission, but Chrome will use a default icon in dev
     - Configuration
       - Describe settings in popup:
         - AI routing (`openrouter`, `aiGateway`, `direct`)
         - AI provider (`gemini`, `openai`, `anthropic`, `minimax`)
         - AI model (backed by `AI_MODEL_REGISTRY` in `popup.js`)
         - Provider API key and gateway base URL
         - Auto-extract toggle and default extraction mode
       - Mention that API keys are stored locally via `chrome.storage.local` and never leave the browser except when calling configured AI endpoints
       - Call out host permissions for:
         - `https://openrouter.ai/*`
         - `https://generativelanguage.googleapis.com/*`
         - Optional custom AI gateway origins
     - Usage
       - High-level flow:
         1. Open a page (article, doc, or chat)
         2. Open extension popup
         3. Choose extraction mode and parameters
         4. Click “Extract Page Content”
         5. Optionally select/create a graph and click “Analyze & Add to Graph”
         6. Inspect graph in the Graph tab; manage graphs and sources in Manage tab
     - Deployment / packaging
       - For manual install:
         - Zip the extension folder (excluding `.git`, `tasks/`, local tooling artifacts)
       - For Chrome Web Store:
         - Provide production-ready icons at `icons/icon16.png`, `icon48.png`, `icon128.png`
         - Ensure description, screenshots, and privacy policy explain AI calls and data handling
         - Upload zipped package via Developer Dashboard and follow store review guidelines
       - Mention that there is no build step yet; the extension is shipped as plain JS/HTML/CSS
     - Contributing
       - Recommend conventional git workflow:
         - Create feature branch
         - Run manual tests by reloading extension and exercising popup
         - Open PR or push per user’s workflow

4. Project summary documentation
   - Create `ProjectSetup.md` capturing:
     - Overview of this setup task and scope
     - Key modules and responsibilities:
       - `content/content.js`: extraction modes, provenance, auto-scroll, markdown conversion, chat transcript heuristic
       - `background.js`: message routing, tab lookup, default settings initialization
       - `popup/popup.js`: UI wiring, settings management, AI call orchestration, graph storage and visualization
     - Data flow:
       - Popup → Background → Content script (EXTRACT_CONTENT / EXTRACT)
       - Content script → Popup (extracted markdown + provenance)
       - Popup ↔ `chrome.storage.local` for `graphs` and `settings`
       - Popup → external AI APIs via selected routing
     - Git and deployment notes:
       - `.gitignore` rationale
       - Recommended dev vs. packaged usage

5. Verification (manual)
   - Ensure extension still loads via `chrome://extensions` → “Load unpacked”
   - Open popup and verify:
     - Settings panel opens and persists values between popup opens
     - Extraction still works on a sample article
     - Graph creation, node visualization, and export still function
   - Confirm:
     - `README.md`, `.gitignore`, `tasks/todo.md`, `ProjectSetup_PSUEDOCODE.md`, and `ProjectSetup.md` exist and are tracked by git
```

