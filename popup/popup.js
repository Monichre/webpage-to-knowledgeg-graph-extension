/**
 * Popup Script — AI Knowledge Graph Extension
 * =============================================
 * Handles UI interactions, content extraction, AI processing,
 * graph management, and canvas-based graph visualization.
 */

(function() {
  'use strict';

  const DEFAULT_SETTINGS = {
    useAI: false,
    apiKey: '',
    autoExtract: false,
    aiProvider: 'gemini',
    aiModel: 'gemini-2.5-pro',
    aiRouting: 'openrouter',
    gatewayBaseUrl: '',
    defaultExtractMode: 'fullPage',
  };
  const EXTRACT_PREVIEW_LIMIT = 14000;
  const AI_MODEL_REGISTRY = {
    gemini: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        directModel: 'gemini-2.5-pro-preview-05-06',
        openrouterModel: 'google/gemini-2.5-pro-preview',
        gatewayModel: 'google/gemini-2.5-pro-preview',
      },
      {
        id: 'gemini-2.0-flash',
        label: 'Gemini 2.0 Flash',
        directModel: 'gemini-2.0-flash',
        openrouterModel: 'google/gemini-2.0-flash-001',
        gatewayModel: 'google/gemini-2.0-flash-001',
      },
    ],
    openai: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        openrouterModel: 'openai/gpt-4o',
        gatewayModel: 'gpt-4o',
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        openrouterModel: 'openai/gpt-4o-mini',
        gatewayModel: 'gpt-4o-mini',
      },
    ],
    anthropic: [
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        openrouterModel: 'anthropic/claude-sonnet-4-6',
        gatewayModel: 'anthropic/claude-sonnet-4-6',
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        openrouterModel: 'anthropic/claude-haiku-4-5',
        gatewayModel: 'anthropic/claude-haiku-4-5',
      },
    ],
    minimax: [
      {
        id: 'minimax-01',
        label: 'MiniMax-01',
        openrouterModel: 'minimax/minimax-01',
        gatewayModel: 'minimax/minimax-01',
      },
    ],
  };

  // ===== State =====
  let graphs = [];
  let activeGraphId = null;
  let extractedData = null;
  let settings = { ...DEFAULT_SETTINGS };
  let currentTab = 'extract';

  // Node colors by type
  const NODE_COLORS = {
    person:       '#8A7A9B',  // Purple for people
    organization: '#6B8A9B',  // Blue for organizations
    location:     '#6B9B8A',  // Teal for locations
    concept:      '#8A969B',  // Gray for concepts
    event:        '#9B8A6B',  // Gold for events
    technology:   '#7B8A9B',  // Steel blue for technology
    topic:        '#6B8A7B',  // Green for topics
  };

  function sanitizeText(value, maxLength = 200) {
    const safeValue = typeof value === 'string' ? value : '';
    return safeValue.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function sanitizeGraphName(value) {
    return sanitizeText(value, 80);
  }

  function sanitizeNodeType(value) {
    const validTypes = ['person', 'organization', 'location', 'concept', 'event', 'technology', 'topic'];
    return validTypes.includes(value) ? value : 'concept';
  }

  function sanitizeBaseUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return '';
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      return '';
    }
  }

  function ensureGatewayPermission(baseUrl) {
    return new Promise((resolve) => {
      if (!baseUrl || !chrome.permissions) {
        resolve(true);
        return;
      }
      let originPattern = '';
      try {
        originPattern = `${new URL(baseUrl).origin}/*`;
      } catch (error) {
        resolve(false);
        return;
      }
      chrome.permissions.contains({ origins: [originPattern] }, (contains) => {
        if (contains) {
          resolve(true);
          return;
        }
        chrome.permissions.request({ origins: [originPattern] }, (granted) => {
          resolve(!!granted);
        });
      });
    });
  }

  function createEmptyGraph(name) {
    const now = new Date().toISOString();
    return {
      id: generateId(),
      name: sanitizeGraphName(name) || 'Untitled Graph',
      description: '',
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
      sources: [],
    };
  }

  function normalizeProvenance(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const sanitizeUrl = (v) => (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://')) ? v : '');
    return {
      canonicalUrl: sanitizeUrl(raw.canonicalUrl),
      visitedUrl: sanitizeUrl(raw.visitedUrl),
      canonicalMatchesVisited: !!raw.canonicalMatchesVisited,
      title: sanitizeText(raw.title, 200),
      description: sanitizeText(raw.description, 400),
      siteName: sanitizeText(raw.siteName, 120),
      author: sanitizeText(raw.author, 120),
      publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
      keywords: sanitizeText(raw.keywords, 200),
      ogImage: sanitizeUrl(raw.ogImage),
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
      extractionMode: sanitizeText(raw.extractionMode, 40),
      nodeCount: typeof raw.nodeCount === 'number' ? raw.nodeCount : 0,
      edgeCount: typeof raw.edgeCount === 'number' ? raw.edgeCount : 0,
    };
  }

  function normalizeSettings(raw) {
    const next = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    next.useAI = !!next.useAI;
    next.apiKey = sanitizeText(next.apiKey, 200);
    next.autoExtract = !!next.autoExtract;
    next.aiProvider = Object.prototype.hasOwnProperty.call(AI_MODEL_REGISTRY, next.aiProvider) ? next.aiProvider : 'gemini';
    next.aiRouting = ['openrouter', 'aiGateway', 'direct'].includes(next.aiRouting) ? next.aiRouting : 'openrouter';
    next.gatewayBaseUrl = sanitizeBaseUrl(next.gatewayBaseUrl);
    const providerModels = AI_MODEL_REGISTRY[next.aiProvider] || [];
    const modelExists = providerModels.some((m) => m.id === next.aiModel);
    next.aiModel = modelExists ? next.aiModel : (providerModels[0]?.id || DEFAULT_SETTINGS.aiModel);
    next.defaultExtractMode = ['fullPage', 'standard', 'chatTranscript'].includes(next.defaultExtractMode)
      ? next.defaultExtractMode
      : DEFAULT_SETTINGS.defaultExtractMode;
    return next;
  }

  function normalizeGraph(rawGraph) {
    if (!rawGraph || typeof rawGraph !== 'object') return null;
    const graph = createEmptyGraph(rawGraph.name);
    graph.description = sanitizeText(rawGraph.description, 500);
    graph.createdAt = typeof rawGraph.createdAt === 'string' ? rawGraph.createdAt : graph.createdAt;
    graph.updatedAt = typeof rawGraph.updatedAt === 'string' ? rawGraph.updatedAt : graph.updatedAt;
    const rawSources = Array.isArray(rawGraph.sources)
      ? rawGraph.sources
      : Array.isArray(rawGraph.sourceUrls)
        ? rawGraph.sourceUrls.map((url) => ({ canonicalUrl: url, visitedUrl: url, title: '', timestamp: '' }))
        : [];
    graph.sources = rawSources
      .slice(0, 200)
      .map(normalizeProvenance)
      .filter(Boolean);

    const rawNodes = Array.isArray(rawGraph.nodes) ? rawGraph.nodes : [];
    const rawEdges = Array.isArray(rawGraph.edges) ? rawGraph.edges : [];

    const nodeIdMap = new Map();
    graph.nodes = rawNodes
      .slice(0, 500)
      .map((node) => {
        if (!node || typeof node !== 'object') return null;
        const label = sanitizeText(node.label, 120);
        if (!label) return null;
        const id = generateId();
        const normalizedNode = {
          id,
          label,
          type: sanitizeNodeType(node.type),
          description: sanitizeText(node.description, 400),
          sourceUrl: typeof node.sourceUrl === 'string' ? node.sourceUrl : '',
          sourceTitle: sanitizeText(node.sourceTitle, 200),
          // Preserve new metadata fields
          aliases: Array.isArray(node.aliases)
            ? node.aliases.map(a => sanitizeText(a, 120)).filter(Boolean).slice(0, 10)
            : [],
          confidence: typeof node.confidence === 'number'
            ? Math.max(0, Math.min(1, node.confidence))
            : 0.8,
        };
        nodeIdMap.set(node.id, id);
        return normalizedNode;
      })
      .filter(Boolean);

    graph.edges = rawEdges
      .slice(0, 1500)
      .map((edge) => {
        if (!edge || typeof edge !== 'object') return null;
        const mappedSource = nodeIdMap.get(edge.source);
        const mappedTarget = nodeIdMap.get(edge.target);
        if (!mappedSource || !mappedTarget || mappedSource === mappedTarget) return null;
        return {
          id: generateId(),
          source: mappedSource,
          target: mappedTarget,
          relationship: sanitizeText(edge.relationship, 80) || 'related to',
          weight: typeof edge.weight === 'number' ? Math.max(0, Math.min(1, edge.weight)) : 0.7,
          // Preserve new metadata fields
          confidence: typeof edge.confidence === 'number'
            ? Math.max(0, Math.min(1, edge.confidence))
            : (typeof edge.weight === 'number' ? edge.weight : 0.7),
          bidirectional: !!edge.bidirectional,
        };
      })
      .filter(Boolean);

    return graph;
  }

  function normalizeGraphs(rawGraphs) {
    if (!Array.isArray(rawGraphs)) return [];
    return rawGraphs.map(normalizeGraph).filter(Boolean);
  }

  // ===== Storage =====
  function loadData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['graphs', 'settings', 'activeGraphId'], (data) => {
        graphs = normalizeGraphs(data.graphs);
        const persistedSettings = normalizeSettings(data.settings);
        chrome.storage.session.get(['apiKey'], (sessionData) => {
          settings = {
            ...persistedSettings,
            apiKey: sanitizeText(sessionData?.apiKey, 200),
          };
          settings.useAI = !!settings.apiKey;

          activeGraphId = data.activeGraphId || (graphs.length > 0 ? graphs[0].id : null);
          if (activeGraphId && !graphs.some((graph) => graph.id === activeGraphId)) {
            activeGraphId = graphs.length > 0 ? graphs[0].id : null;
          }
          resolve();
        });
      });
    });
  }

  function saveData() {
    settings = normalizeSettings(settings);
    const persistedSettings = {
      ...settings,
      apiKey: '',
      useAI: false,
    };
    chrome.storage.local.set({ graphs, settings: persistedSettings, activeGraphId });
    chrome.storage.session.set({ apiKey: settings.apiKey || '' });
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  // ===== Toast =====
  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  // ===== Page Info =====
  function updatePageInfo() {
    chrome.runtime.sendMessage({ type: 'GET_PAGE_INFO' }, (response) => {
      if (chrome.runtime.lastError) {
        document.getElementById('pageUrl').textContent = 'Unavailable';
        document.getElementById('pageTitle').textContent = '';
        return;
      }
      if (response?.success && response.data) {
        document.getElementById('pageUrl').textContent = response.data.url || 'Unknown';
        document.getElementById('pageTitle').textContent = response.data.title || '';
      } else {
        document.getElementById('pageUrl').textContent = 'Unknown';
        document.getElementById('pageTitle').textContent = '';
      }
    });
  }

  // ===== Tab Navigation =====
  function switchTab(tabName) {
    currentTab = tabName;
    if (tabName !== 'graph' && graphAnimFrameId) {
      cancelAnimationFrame(graphAnimFrameId);
      graphAnimFrameId = null;
    }
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}Panel`).classList.add('active');
    document.getElementById('settingsPanel').classList.remove('active');

    if (tabName === 'graph') renderGraph();
    if (tabName === 'manage') {
      renderGraphList();
      renderSourcesForGraph(graphs.find((g) => g.id === activeGraphId) || null);
    }
  }

  function getExtractionRequestPayload() {
    const modeSelect = document.getElementById('extractModeSelect');
    const maxPassesInput = document.getElementById('scrollMaxPasses');
    const timeoutInput = document.getElementById('scrollTimeoutMs');
    const waitInput = document.getElementById('scrollWaitMs');
    const mode = modeSelect?.value || settings.defaultExtractMode || 'fullPage';

    return {
      type: 'EXTRACT_CONTENT',
      mode,
      scrollOptions: {
        maxPasses: Number(maxPassesInput?.value || 24),
        timeoutMs: Number(timeoutInput?.value || 20000),
        waitMs: Number(waitInput?.value || 450),
        noGrowthThreshold: 3,
      },
      chatOptions: {
        minMessages: 3,
      },
    };
  }

  function normalizeExtractionData(data) {
    const markdown = typeof data?.markdown === 'string' ? data.markdown : (data?.content?.markdown || '');
    const plainText = typeof data?.plainText === 'string' ? data.plainText : (data?.content?.plainText || '');
    const provenance = data?.provenance ? normalizeProvenance({
      ...data.provenance,
      extractionMode: data.mode || data?.stats?.modeUsed || 'fullPage',
    }) : null;
    return {
      ...data,
      markdown,
      plainText,
      provenance,
      content: {
        markdown,
        plainText,
      },
    };
  }

  function getMarkdownPreview(markdown) {
    if (markdown.length <= EXTRACT_PREVIEW_LIMIT) return markdown;
    return `${markdown.slice(0, EXTRACT_PREVIEW_LIMIT)}\n\n[Preview truncated. Full extracted content is preserved for analysis/export.]`;
  }

  // ===== Content Extraction =====
  function extractContent() {
    const statusEl = document.getElementById('extractStatus');
    const resultEl = document.getElementById('extractResult');
    const btn = document.getElementById('extractBtn');
    const warningsEl = document.getElementById('extractWarnings');

    statusEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
    warningsEl.classList.add('hidden');
    warningsEl.textContent = '';
    btn.disabled = true;

    chrome.runtime.sendMessage(getExtractionRequestPayload(), (response) => {
      statusEl.classList.add('hidden');
      btn.disabled = false;

      if (chrome.runtime.lastError) {
        showToast('Extraction failed: page communication error');
        return;
      }

      if (response?.success) {
        extractedData = normalizeExtractionData(response.data || {});
        document.getElementById('markdownOutput').textContent = getMarkdownPreview(extractedData.markdown || '');
        if (Array.isArray(extractedData.warnings) && extractedData.warnings.length > 0) {
          warningsEl.textContent = extractedData.warnings.join(' | ');
          warningsEl.classList.remove('hidden');
        }
        resultEl.classList.remove('hidden');
        updateGraphSelect();
        showToast('Content extracted successfully');
      } else {
        const message = response?.error?.message || 'Extraction failed. Try refreshing the page.';
        showToast(message);
      }
    });
  }

  // ===== Entity Extraction =====
  function extractEntitiesLocal(text) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    // Extract capitalized phrases
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    const stopWords = new Set(['The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Which', 'While', 'With', 'From', 'Into', 'About', 'After', 'Before', 'Between', 'Through', 'During', 'Without', 'Within', 'Along', 'Following', 'Across', 'Behind', 'Beyond', 'Plus', 'Except', 'But', 'Not', 'Only', 'Own', 'Same', 'Than', 'Too', 'Very', 'Just', 'Because', 'And', 'Also', 'However', 'Although', 'Though', 'Since', 'Until', 'Unless', 'For', 'Are', 'Was', 'Were', 'Been', 'Being', 'Have', 'Has', 'Had', 'Does', 'Did', 'Will', 'Would', 'Could', 'Should', 'May', 'Might', 'Must', 'Shall', 'Can', 'Need', 'Here', 'There', 'Some', 'Any', 'Each', 'Every', 'All', 'Both', 'Few', 'More', 'Most', 'Other', 'New', 'Old', 'Many', 'Much', 'Such']);
    const matches = new Set();
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const phrase = match[1];
      if (phrase.length > 2 && !stopWords.has(phrase)) {
        matches.add(phrase);
      }
    }

    const matchArray = Array.from(matches).slice(0, 30);

    // Enhanced heuristics for entity type classification
    const techTerms = ['API', 'AI', 'ML', 'NLP', 'GPU', 'CPU', 'SDK', 'REST', 'HTTP', 'SQL', 'CSS', 'HTML', 'JavaScript', 'Python', 'React', 'Database', 'Server', 'Framework', 'Algorithm', 'Model', 'Network', 'System', 'Platform', 'Software', 'Data', 'Cloud', 'Machine Learning', 'Deep Learning', 'Blockchain', 'Docker', 'Kubernetes'];
    const orgIndicators = ['Inc', 'Corp', 'LLC', 'Ltd', 'Company', 'Foundation', 'Institute', 'University', 'Department', 'Agency'];
    const locationIndicators = ['City', 'State', 'Country', 'County', 'Province', 'District', 'Region', 'Valley', 'Bay', 'Island', 'Mountain'];

    matchArray.forEach((label, i) => {
      const id = generateId();
      let type = 'concept'; // default

      // Classify by heuristics
      if (techTerms.some(t => label.toLowerCase().includes(t.toLowerCase()))) {
        type = 'technology';
      } else if (orgIndicators.some(ind => label.includes(ind))) {
        type = 'organization';
      } else if (locationIndicators.some(ind => label.includes(ind))) {
        type = 'location';
      } else if (label.split(' ').length === 2 && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(label)) {
        // Two capitalized words might be a person
        type = 'person';
      } else if (i < matchArray.length * 0.2) {
        type = 'topic';
      } else if (label.split(' ').length >= 3) {
        type = 'concept';
      }

      nodes.push({
        id,
        label,
        type,
        description: '',
        aliases: [],
        confidence: 0.6, // Lower confidence for local extraction
      });
      nodeMap.set(label, id);
    });

    // Create edges from co-occurrence
    const sentences = text.split(/[.!?]+/);
    const edgeSet = new Set();
    sentences.forEach(sentence => {
      const found = matchArray.filter(l => sentence.includes(l));
      for (let i = 0; i < found.length; i++) {
        for (let j = i + 1; j < found.length; j++) {
          const key = `${found[i]}-${found[j]}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            const sid = nodeMap.get(found[i]);
            const tid = nodeMap.get(found[j]);
            if (sid && tid) {
              edges.push({
                id: generateId(),
                source: sid,
                target: tid,
                relationship: 'related to',
                confidence: 0.5,
                bidirectional: true,
                weight: 0.5,
              });
            }
          }
        }
      }
    });

    return { nodes, edges, warnings: ['Used local extraction (no AI configured)'] };
  }

  // Maximum characters sent to the AI per chunk.
  // ~60K chars ≈ ~15K tokens — fits comfortably in all supported models.
  const AI_CONTENT_CHAR_LIMIT = 60000;

  /**
   * Truncate text at a sentence boundary rather than mid-word.
   * Falls back to hard slice if no boundary is found nearby.
   */
  function truncateAtSentence(text, limit) {
    if (text.length <= limit) return text;
    const slice = text.slice(0, limit);
    const lastBoundary = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('.\n'),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
    );
    return lastBoundary > limit * 0.75
      ? slice.slice(0, lastBoundary + 1).trim()
      : slice.trim();
  }

  function buildKnowledgePrompt(text) {
    const safeText = truncateAtSentence(text, AI_CONTENT_CHAR_LIMIT);
    return `You are an expert knowledge graph extraction system. Analyze the content below and extract a high-quality, structured knowledge graph with entities, relationships, and metadata.

Return a single JSON object — no markdown fences, no explanation — with exactly this structure:

{
  "nodes": [
    {
      "label": "string (canonical name - use full, unambiguous form)",
      "type": "person|organization|location|concept|event|technology|topic",
      "description": "string (1-2 detailed sentences explaining this entity)",
      "aliases": ["array", "of", "alternative names or synonyms"],
      "confidence": number (0.0-1.0, how confident you are this is a distinct entity)
    }
  ],
  "edges": [
    {
      "sourceLabel": "exact node label (must match a node's label field)",
      "targetLabel": "exact node label (must match a node's label field)",
      "relationship": "specific verb phrase describing the relationship",
      "confidence": number (0.0-1.0, confidence in this relationship),
      "bidirectional": boolean (true if relationship works both ways)
    }
  ]
}

**Entity Type Definitions:**
- person: Named individuals (e.g. "Tim Berners-Lee", "Marie Curie")
- organization: Companies, institutions, groups (e.g. "OpenAI", "United Nations", "MIT")
- location: Geographic places (e.g. "San Francisco", "Amazon Rainforest")
- concept: Abstract ideas, theories, principles (e.g. "Photosynthesis", "Supply and Demand", "Recursion")
- event: Specific occurrences, milestones (e.g. "Apollo 11 Moon Landing", "Industrial Revolution")
- technology: Tools, systems, platforms, methods (e.g. "React Framework", "CRISPR", "Blockchain")
- topic: Subject domains, fields of study (e.g. "Machine Learning", "Quantum Physics", "Economics")

**Extraction Guidelines:**

1. **Entity Resolution**: Use canonical, unambiguous names. If "NASA" and "National Aeronautics and Space Administration" appear, choose one as the label and list the other in aliases.

2. **Quality over Quantity**: Extract 10-30 of the MOST important entities. Focus on:
   - Central topics and themes
   - Key people, organizations, or places mentioned multiple times
   - Core concepts that are explained or defined
   - Avoid trivial mentions

3. **Relationship Quality**: Create relationships that are:
   - Specific and informative (prefer "founded in 1998" over "related to")
   - Factually grounded in the text
   - Semantically meaningful (avoid generic "related to" when possible)
   - Examples: "developed by", "located in", "specializes in", "invented", "acquired", "based on"

4. **Confidence Scoring**:
   - 0.9-1.0: Explicitly stated, unambiguous
   - 0.7-0.89: Clearly implied or strongly supported
   - 0.5-0.69: Reasonably inferred from context
   - Below 0.5: Uncertain or speculative

5. **Aliases**: Include common abbreviations, acronyms, alternative names, or synonyms that appear in the text.

6. **Validation**: Every edge must connect two nodes that exist in the nodes array using exact label matches.

Return ONLY the JSON object. No other text.

Content:
${safeText}`;
  }

  function parseAiGraphResponse(jsonText) {
    let content = (jsonText || '').trim();

    // Strip markdown code fences if present
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) content = fenceMatch[1].trim();

    // Strip leading/trailing non-JSON chars (some models add commentary)
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      content = content.slice(jsonStart, jsonEnd + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error(`AI returned unparseable JSON: ${e.message}`);
    }

    const nodeMap = new Map();
    // Build case-insensitive lookup and alias map for entity resolution
    const nodeMapLower = new Map();
    const aliasMap = new Map(); // Maps aliases to canonical node ID

    const nodes = (parsed.nodes || [])
      .map((node) => {
        const label = sanitizeText(node.label, 120);
        if (!label) return null;
        const id = generateId();

        // Store main label mapping
        nodeMap.set(label, id);
        nodeMapLower.set(label.toLowerCase(), id);

        // Store alias mappings for entity resolution
        const aliases = Array.isArray(node.aliases)
          ? node.aliases.map(a => sanitizeText(a, 120)).filter(Boolean).slice(0, 10)
          : [];
        aliases.forEach(alias => {
          aliasMap.set(alias.toLowerCase(), id);
        });

        return {
          id,
          label,
          type: sanitizeNodeType(node.type),
          description: sanitizeText(node.description, 300),
          aliases,
          confidence: typeof node.confidence === 'number'
            ? Math.max(0, Math.min(1, node.confidence))
            : 0.8,
        };
      })
      .filter(Boolean);

    const edgeSet = new Set();
    const edges = (parsed.edges || [])
      .map((edge) => {
        const srcLabel = sanitizeText(edge.sourceLabel, 120);
        const tgtLabel = sanitizeText(edge.targetLabel, 120);

        // Try exact match first, then case-insensitive, then alias lookup
        let sid = nodeMap.get(srcLabel)
          || nodeMapLower.get(srcLabel.toLowerCase())
          || aliasMap.get(srcLabel.toLowerCase());
        let tid = nodeMap.get(tgtLabel)
          || nodeMapLower.get(tgtLabel.toLowerCase())
          || aliasMap.get(tgtLabel.toLowerCase());

        if (!sid || !tid || sid === tid) return null;

        const key = `${sid}|${tid}`;
        if (edgeSet.has(key)) return null;
        edgeSet.add(key);

        return {
          id: generateId(),
          source: sid,
          target: tid,
          relationship: sanitizeText(edge.relationship, 80) || 'related to',
          confidence: typeof edge.confidence === 'number'
            ? Math.max(0, Math.min(1, edge.confidence))
            : 0.7,
          bidirectional: !!edge.bidirectional,
          weight: typeof edge.confidence === 'number' ? edge.confidence : 0.7,
        };
      })
      .filter(Boolean);

    // Calculate quality metrics
    const avgNodeConfidence = nodes.length > 0
      ? nodes.reduce((sum, n) => sum + n.confidence, 0) / nodes.length
      : 0;
    const avgEdgeConfidence = edges.length > 0
      ? edges.reduce((sum, e) => sum + e.confidence, 0) / edges.length
      : 0;

    return {
      nodes,
      edges,
      warnings: [],
      metrics: {
        avgNodeConfidence: Math.round(avgNodeConfidence * 100) / 100,
        avgEdgeConfidence: Math.round(avgEdgeConfidence * 100) / 100,
        totalAliases: nodes.reduce((sum, n) => sum + (n.aliases?.length || 0), 0),
      }
    };
  }

  async function runGeminiExtraction(text, apiKey, modelId) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildKnowledgePrompt(text) }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.text().catch(() => response.status);
      throw new Error(`Gemini request failed (${response.status}): ${err}`);
    }
    const data = await response.json();
    const modelText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAiGraphResponse(modelText);
  }

  async function runOpenAiCompatibleExtraction(text, apiKey, baseUrl, modelId, extraHeaders = {}) {
    const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
    if (!normalizedBaseUrl) {
      throw new Error('A valid HTTPS gateway URL is required');
    }
    const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.2,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: buildKnowledgePrompt(text),
          },
        ],
      }),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => response.status);
      throw new Error(`API request failed (${response.status}): ${err}`);
    }
    const data = await response.json();
    const messageContent = data?.choices?.[0]?.message?.content;
    const modelText = typeof messageContent === 'string'
      ? messageContent
      : Array.isArray(messageContent)
        ? messageContent.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
        : '';
    return parseAiGraphResponse(modelText);
  }

  function getModelConfig(provider, modelId) {
    const options = AI_MODEL_REGISTRY[provider] || [];
    return options.find((model) => model.id === modelId) || options[0] || null;
  }

  function resolveModelForRouting(providerSettings) {
    const modelConfig = getModelConfig(providerSettings.aiProvider, providerSettings.aiModel);
    if (!modelConfig) return null;
    if (providerSettings.aiRouting === 'direct') return modelConfig.directModel || modelConfig.id;
    if (providerSettings.aiRouting === 'aiGateway') return modelConfig.gatewayModel || modelConfig.id;
    return modelConfig.openrouterModel || modelConfig.id;
  }

  async function extractEntitiesWithAI(text, providerSettings) {
    const provider = providerSettings.aiProvider || 'gemini';
    const routing = providerSettings.aiRouting || 'openrouter';
    const modelId = resolveModelForRouting(providerSettings);
    if (!modelId) {
      return {
        ...extractEntitiesLocal(text),
        warnings: ['No valid model is selected. Used local extraction instead.'],
      };
    }

    try {
      if (routing === 'direct') {
        if (provider !== 'gemini') {
          throw new Error('Direct mode currently supports only Gemini. Use OpenRouter or AI Gateway for this provider');
        }
        return await runGeminiExtraction(text, providerSettings.apiKey, modelId);
      }

      if (routing === 'aiGateway') {
        if (!providerSettings.gatewayBaseUrl) {
          throw new Error('Set a Gateway Base URL to use AI Gateway routing');
        }
        return await runOpenAiCompatibleExtraction(
          text,
          providerSettings.apiKey,
          providerSettings.gatewayBaseUrl,
          modelId
        );
      }

      return await runOpenAiCompatibleExtraction(
        text,
        providerSettings.apiKey,
        'https://openrouter.ai/api/v1',
        modelId,
        {
          'HTTP-Referer': 'https://ai-knowledge-graph.local',
          'X-Title': 'AI Knowledge Graph Extension',
        }
      );
    } catch (error) {
      return {
        ...extractEntitiesLocal(text),
        warnings: [`${error.message}. Used local extraction instead.`],
      };
    }
  }

  // ===== Add to Graph =====
  async function addToGraph() {
    if (!extractedData) return;
    const graphId = document.getElementById('graphSelect').value;
    if (!graphId) {
      showToast('Select a graph first');
      return;
    }

    const btn = document.getElementById('addToGraphBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Analyzing...';

    let result;
    if (settings.useAI && settings.apiKey) {
      result = await extractEntitiesWithAI(extractedData.markdown, settings);
    } else {
      result = extractEntitiesLocal(extractedData.plainText || extractedData.markdown);
    }

    const canonicalUrl = extractedData.provenance?.canonicalUrl || extractedData.url || '';
    const visitedUrl = extractedData.url || '';

    // Add source info to nodes
    result.nodes.forEach(n => {
      n.sourceUrl = visitedUrl;
      n.sourceCanonicalUrl = canonicalUrl;
      n.sourceTitle = extractedData.title;
    });

    // Merge into graph
    const graph = graphs.find(g => g.id === graphId);
    if (graph) {
      const existingMap = new Map(graph.nodes.map(n => [n.label.toLowerCase() + '-' + n.type, n]));
      const idMap = new Map();

      result.nodes.forEach(node => {
        const key = node.label.toLowerCase() + '-' + node.type;
        if (existingMap.has(key)) {
          idMap.set(node.id, existingMap.get(key).id);
        } else {
          existingMap.set(key, node);
          graph.nodes.push(node);
          idMap.set(node.id, node.id);
        }
      });

      const edgeSet = new Set(graph.edges.map(e => `${e.source}-${e.target}-${e.relationship}`));
      result.edges.forEach(edge => {
        const src = idMap.get(edge.source) || edge.source;
        const tgt = idMap.get(edge.target) || edge.target;
        const key = `${src}-${tgt}-${edge.relationship}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graph.edges.push({ ...edge, source: src, target: tgt });
        }
      });

      if (!Array.isArray(graph.sources)) graph.sources = [];
      const isDuplicate = graph.sources.some((src) => src.canonicalUrl === canonicalUrl && src.canonicalUrl !== '');
      if (!isDuplicate) {
        const provenanceRecord = normalizeProvenance({
          ...(extractedData.provenance || {}),
          canonicalUrl,
          visitedUrl,
          title: extractedData.title || '',
          extractionMode: extractedData.mode || 'fullPage',
          timestamp: extractedData.timestamp || new Date().toISOString(),
          nodeCount: result.nodes.length,
          edgeCount: result.edges.length,
        });
        if (provenanceRecord) graph.sources.push(provenanceRecord);
      }

      graph.updatedAt = new Date().toISOString();
      activeGraphId = graphId;
      saveData();
    }

    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v8M8 12h8"/></svg> Analyze & Add to Graph`;
    renderSourcesForGraph(graphs.find((g) => g.id === graphId) || null);

    // Build success message with quality metrics
    let message = `Added ${result.nodes.length} entities and ${result.edges.length} relationships`;
    if (result.metrics) {
      const metricsDetails = [];
      if (result.metrics.avgNodeConfidence) {
        metricsDetails.push(`Node confidence: ${(result.metrics.avgNodeConfidence * 100).toFixed(0)}%`);
      }
      if (result.metrics.avgEdgeConfidence) {
        metricsDetails.push(`Edge confidence: ${(result.metrics.avgEdgeConfidence * 100).toFixed(0)}%`);
      }
      if (result.metrics.totalAliases > 0) {
        metricsDetails.push(`${result.metrics.totalAliases} aliases resolved`);
      }
      if (metricsDetails.length > 0) {
        message += ` • ` + metricsDetails.join(' • ');
      }
    }
    showToast(message);

    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      showToast(result.warnings[0]);
    }
    switchTab('graph');
  }

  // ===== Graph Select =====
  function updateGraphSelect() {
    const select = document.getElementById('graphSelect');
    select.innerHTML = '<option value="">Select a graph...</option>';
    graphs.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.nodes.length} nodes)`;
      if (g.id === activeGraphId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // ===== Graph Visualization (Canvas) =====
  let graphNodes = [];
  let graphEdges = [];
  let selectedNodeId = null;
  let dragNode = null;
  let canvasOffset = { x: 0, y: 0 };
  let canvasScale = 1;
  let graphAnimFrameId = null;

  function renderGraph() {
    const graph = graphs.find(g => g.id === activeGraphId);
    if (!graph) {
      if (graphAnimFrameId) {
        cancelAnimationFrame(graphAnimFrameId);
        graphAnimFrameId = null;
      }
      document.getElementById('nodeCount').textContent = '0 nodes';
      document.getElementById('edgeCount').textContent = '0 edges';
      return;
    }

    document.getElementById('nodeCount').textContent = `${graph.nodes.length} nodes`;
    document.getElementById('edgeCount').textContent = `${graph.edges.length} edges`;

    const canvas = document.getElementById('graphCanvas');
    const container = document.getElementById('graphContainer');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Initialize positions
    graphNodes = graph.nodes.map((n, i) => ({
      ...n,
      x: n.x || canvas.width / 2 + Math.cos(i * 2.4) * (100 + Math.random() * 100),
      y: n.y || canvas.height / 2 + Math.sin(i * 2.4) * (100 + Math.random() * 100),
      vx: 0,
      vy: 0,
    }));

    const nodeIdSet = new Set(graphNodes.map(n => n.id));
    graphEdges = graph.edges.filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
    const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
    const degreeByNodeId = new Map(graphNodes.map((node) => [node.id, 0]));
    graphEdges.forEach((edge) => {
      degreeByNodeId.set(edge.source, (degreeByNodeId.get(edge.source) || 0) + 1);
      degreeByNodeId.set(edge.target, (degreeByNodeId.get(edge.target) || 0) + 1);
    });

    // Simple force simulation
    function simulate() {
      const alpha = 0.1;

      // Repulsion
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const dx = graphNodes[j].x - graphNodes[i].x;
          const dy = graphNodes[j].y - graphNodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          graphNodes[i].vx -= fx * alpha;
          graphNodes[i].vy -= fy * alpha;
          graphNodes[j].vx += fx * alpha;
          graphNodes[j].vy += fy * alpha;
        }
      }

      // Attraction (edges)
      graphEdges.forEach(e => {
        const source = nodeById.get(e.source);
        const target = nodeById.get(e.target);
        if (!source || !target) return;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx * alpha;
        source.vy += fy * alpha;
        target.vx -= fx * alpha;
        target.vy -= fy * alpha;
      });

      // Center gravity
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      graphNodes.forEach(n => {
        if (n === dragNode) return;
        n.vx += (cx - n.x) * 0.001;
        n.vy += (cy - n.y) * 0.001;
        n.vx *= 0.9;
        n.vy *= 0.9;
        n.x += n.vx;
        n.y += n.vy;
      });
    }

    function draw() {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(canvasOffset.x, canvasOffset.y);
      ctx.scale(canvasScale, canvasScale);

      // Draw grid
      ctx.strokeStyle = 'rgba(138, 150, 155, 0.06)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < canvas.width / canvasScale; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height / canvasScale);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height / canvasScale; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width / canvasScale, y);
        ctx.stroke();
      }

      // Draw edges
      graphEdges.forEach(e => {
        const source = nodeById.get(e.source);
        const target = nodeById.get(e.target);
        if (!source || !target) return;

        const isHighlighted = selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = isHighlighted
          ? NODE_COLORS[nodeById.get(selectedNodeId)?.type || 'topic'] + '55'
          : 'rgba(138, 150, 155, 0.12)';
        ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
        ctx.stroke();

        // Edge label
        if (isHighlighted) {
          const mx = (source.x + target.x) / 2;
          const my = (source.y + target.y) / 2;
          ctx.font = '9px "Space Grotesk"';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.textAlign = 'center';
          ctx.fillText(e.relationship, mx, my - 4);
        }
      });

      // Draw nodes
      graphNodes.forEach(n => {
        const color = NODE_COLORS[n.type] || '#8A969B';
        const isSelected = n.id === selectedNodeId;
        const connectionCount = degreeByNodeId.get(n.id) || 0;
        const radius = Math.max(5, Math.min(14, 5 + connectionCount * 1.5));

        // Glow
        const gradient = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, radius * 3);
        gradient.addColorStop(0, color + (isSelected ? '40' : '20'));
        gradient.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Node circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = isSelected ? 1 : 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Inner core
        ctx.beginPath();
        ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label
        ctx.font = `${isSelected ? '600' : '500'} 10px "Space Grotesk"`;
        ctx.fillStyle = color;
        ctx.globalAlpha = isSelected ? 1 : 0.7;
        ctx.textAlign = 'center';
        const label = n.label.length > 18 ? n.label.substring(0, 16) + '...' : n.label;
        ctx.fillText(label, n.x, n.y + radius + 14);
        ctx.globalAlpha = 1;
      });

      ctx.restore();
    }

    function loop() {
      simulate();
      draw();
      graphAnimFrameId = requestAnimationFrame(loop);
    }
    if (graphAnimFrameId) cancelAnimationFrame(graphAnimFrameId);
    loop();

    // Mouse interaction
    canvas.onmousedown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - canvasOffset.x) / canvasScale;
      const my = (e.clientY - rect.top - canvasOffset.y) / canvasScale;

      const clicked = graphNodes.find(n => {
        const dx = n.x - mx;
        const dy = n.y - my;
        return Math.sqrt(dx * dx + dy * dy) < 15;
      });

      if (clicked) {
        dragNode = clicked;
        selectedNodeId = clicked.id;
        showNodeDetail(clicked);
      } else {
        selectedNodeId = null;
        document.getElementById('nodeDetail').classList.add('hidden');
      }
    };

    canvas.onmousemove = (e) => {
      if (dragNode) {
        const rect = canvas.getBoundingClientRect();
        dragNode.x = (e.clientX - rect.left - canvasOffset.x) / canvasScale;
        dragNode.y = (e.clientY - rect.top - canvasOffset.y) / canvasScale;
        dragNode.vx = 0;
        dragNode.vy = 0;
      }
    };

    canvas.onmouseup = () => { dragNode = null; };
    canvas.onmouseleave = () => { dragNode = null; };

    canvas.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      canvasScale *= delta;
      canvasScale = Math.max(0.3, Math.min(3, canvasScale));
    };
  }

  function showNodeDetail(node) {
    const detail = document.getElementById('nodeDetail');
    detail.classList.remove('hidden');

    const badge = document.getElementById('nodeTypeBadge');
    badge.textContent = node.type;
    badge.className = 'node-type-badge ' + node.type;

    document.getElementById('nodeLabel').textContent = node.label;
    document.getElementById('nodeDescription').textContent = node.description || 'No description available';

    const connectionsEl = document.getElementById('nodeConnections');
    connectionsEl.innerHTML = '';
    const connected = graphEdges
      .filter(e => e.source === node.id || e.target === node.id)
      .map(e => {
        const otherId = e.source === node.id ? e.target : e.source;
        const other = graphNodes.find(n => n.id === otherId);
        return other ? `${other.label} (${e.relationship})` : null;
      })
      .filter(Boolean);

    connected.forEach(c => {
      const tag = document.createElement('span');
      tag.className = 'connection-tag';
      tag.textContent = c;
      connectionsEl.appendChild(tag);
    });
  }

  // ===== Graph List =====
  function renderGraphList() {
    const list = document.getElementById('graphList');
    list.innerHTML = '';

    graphs.forEach((g) => {
      const item = document.createElement('div');
      item.className = 'graph-item' + (g.id === activeGraphId ? ' active' : '');
      const header = document.createElement('div');
      header.className = 'graph-item-header';

      const name = document.createElement('span');
      name.className = 'graph-item-name';
      name.textContent = sanitizeGraphName(g.name) || 'Untitled Graph';
      header.appendChild(name);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'graph-item-delete';
      deleteBtn.dataset.id = g.id;
      deleteBtn.title = 'Delete';
      deleteBtn.setAttribute('aria-label', 'Delete graph');
      deleteBtn.textContent = 'Delete';
      header.appendChild(deleteBtn);

      const stats = document.createElement('div');
      stats.className = 'graph-item-stats';
      const nodeCount = Array.isArray(g.nodes) ? g.nodes.length : 0;
      const edgeCount = Array.isArray(g.edges) ? g.edges.length : 0;
      const sourceCount = Array.isArray(g.sources) ? g.sources.length : 0;
      stats.textContent = `${nodeCount} nodes · ${edgeCount} edges · ${sourceCount} sources`;

      item.appendChild(header);
      item.appendChild(stats);

      item.addEventListener('click', (e) => {
        if (e.target.closest('.graph-item-delete')) {
          graphs = graphs.filter(gr => gr.id !== g.id);
          if (activeGraphId === g.id) {
            activeGraphId = graphs.length > 0 ? graphs[0].id : null;
          }
          saveData();
          renderGraphList();
          showToast('Graph deleted');
          return;
        }
        activeGraphId = g.id;
        saveData();
        renderGraphList();
        renderSourcesForGraph(graphs.find((gr) => gr.id === activeGraphId) || null);
        switchTab('graph');
      });

      list.appendChild(item);
    });
  }

  function renderSourcesForGraph(graph) {
    const container = document.getElementById('sourcesList');
    const title = document.getElementById('sourcesGraphTitle');
    const empty = document.getElementById('sourcesEmpty');
    if (!container || !title || !empty) return;

    const sources = Array.isArray(graph?.sources) ? graph.sources : [];
    title.textContent = graph ? `Sources — ${sanitizeGraphName(graph.name) || 'Untitled'}` : 'Sources';
    container.innerHTML = '';

    if (sources.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    sources.slice().reverse().forEach((src) => {
      const item = document.createElement('div');
      item.className = 'source-item';

      const headerRow = document.createElement('div');
      headerRow.className = 'source-item-header';

      const titleEl = document.createElement('span');
      titleEl.className = 'source-item-title';
      titleEl.textContent = src.title || src.canonicalUrl || 'Untitled';
      headerRow.appendChild(titleEl);

      const statsEl = document.createElement('span');
      statsEl.className = 'source-item-stats';
      statsEl.textContent = [
        src.nodeCount != null ? `${src.nodeCount}N` : null,
        src.edgeCount != null ? `${src.edgeCount}E` : null,
      ].filter(Boolean).join(' · ');
      headerRow.appendChild(statsEl);

      item.appendChild(headerRow);

      if (src.siteName || src.author) {
        const metaEl = document.createElement('div');
        metaEl.className = 'source-item-meta';
        metaEl.textContent = [src.siteName, src.author].filter(Boolean).join(' · ');
        item.appendChild(metaEl);
      }

      const urlRow = document.createElement('div');
      urlRow.className = 'source-item-url';

      const canonicalLink = document.createElement('a');
      canonicalLink.className = 'source-link';
      canonicalLink.textContent = src.canonicalUrl || src.visitedUrl || '—';
      canonicalLink.title = src.canonicalUrl || '';
      canonicalLink.setAttribute('data-url', src.canonicalUrl || src.visitedUrl || '');
      canonicalLink.addEventListener('click', (e) => {
        e.preventDefault();
        const url = e.currentTarget.getAttribute('data-url');
        if (url) chrome.tabs.create({ url });
      });
      urlRow.appendChild(canonicalLink);

      if (!src.canonicalMatchesVisited && src.visitedUrl && src.visitedUrl !== src.canonicalUrl) {
        const visitedLabel = document.createElement('span');
        visitedLabel.className = 'source-visited-label';
        visitedLabel.textContent = 'visited ≠ canonical';
        urlRow.appendChild(visitedLabel);
      }

      item.appendChild(urlRow);

      const footerRow = document.createElement('div');
      footerRow.className = 'source-item-footer';

      const modeTag = document.createElement('span');
      modeTag.className = 'source-mode-tag';
      modeTag.textContent = src.extractionMode || 'fullPage';
      footerRow.appendChild(modeTag);

      if (src.publishedAt) {
        const pubEl = document.createElement('span');
        pubEl.className = 'source-item-meta';
        pubEl.textContent = `Published: ${src.publishedAt.slice(0, 10)}`;
        footerRow.appendChild(pubEl);
      }

      const tsEl = document.createElement('span');
      tsEl.className = 'source-item-meta';
      tsEl.textContent = src.timestamp ? new Date(src.timestamp).toLocaleString() : '';
      footerRow.appendChild(tsEl);

      item.appendChild(footerRow);
      container.appendChild(item);
    });
  }

  function populateModelOptions() {
    const providerSelect = document.getElementById('aiProviderSelect');
    const modelSelect = document.getElementById('aiModelSelect');
    if (!providerSelect || !modelSelect) return;

    const provider = providerSelect.value || 'gemini';
    const models = AI_MODEL_REGISTRY[provider] || [];
    modelSelect.innerHTML = '';
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.label;
      modelSelect.appendChild(option);
    });

    if (models.some((model) => model.id === settings.aiModel)) {
      modelSelect.value = settings.aiModel;
    } else if (models[0]) {
      modelSelect.value = models[0].id;
      settings.aiModel = models[0].id;
    }
  }

  function updateRoutingUi() {
    const routingSelect = document.getElementById('aiRoutingSelect');
    const gatewayInput = document.getElementById('gatewayBaseUrlInput');
    const providerSelect = document.getElementById('aiProviderSelect');
    if (!routingSelect || !gatewayInput || !providerSelect) return;
    const routing = routingSelect.value || settings.aiRouting || 'openrouter';
    gatewayInput.disabled = routing !== 'aiGateway';
    gatewayInput.placeholder = routing === 'aiGateway'
      ? 'https://your-gateway.example.com/v1'
      : 'Gateway URL only needed for AI Gateway mode';

    if (routing === 'direct') {
      providerSelect.value = 'gemini';
      providerSelect.disabled = true;
      settings.aiProvider = 'gemini';
      populateModelOptions();
    } else {
      providerSelect.disabled = false;
    }
  }

  function syncSettingsToUi() {
    const modeSelect = document.getElementById('extractModeSelect');
    if (modeSelect) modeSelect.value = settings.defaultExtractMode || 'fullPage';
    const apiKeyInput = document.getElementById('apiKeyInput');
    if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';
    const routingSelect = document.getElementById('aiRoutingSelect');
    if (routingSelect) routingSelect.value = settings.aiRouting || 'openrouter';
    const gatewayInput = document.getElementById('gatewayBaseUrlInput');
    if (gatewayInput) gatewayInput.value = settings.gatewayBaseUrl || '';
    const autoExtractToggle = document.getElementById('autoExtractToggle');
    if (autoExtractToggle) autoExtractToggle.checked = settings.autoExtract || false;
    const providerSelect = document.getElementById('aiProviderSelect');
    if (providerSelect) providerSelect.value = settings.aiProvider || 'gemini';
    populateModelOptions();
    const modelSelect = document.getElementById('aiModelSelect');
    if (modelSelect) modelSelect.value = settings.aiModel || modelSelect.value;
    updateRoutingUi();
  }

  // ===== Event Listeners =====
  function init() {
    loadData().then(() => {
      updatePageInfo();
      updateGraphSelect();
      renderSourcesForGraph(graphs.find((g) => g.id === activeGraphId) || null);

      // Tabs
      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
      });

      // Extract
      document.getElementById('extractBtn').addEventListener('click', extractContent);
      document.getElementById('addToGraphBtn').addEventListener('click', addToGraph);

      // Copy markdown
      document.getElementById('copyMarkdownBtn').addEventListener('click', () => {
        if (extractedData) {
          navigator.clipboard.writeText(extractedData.markdown)
            .then(() => {
              showToast('Markdown copied to clipboard');
            })
            .catch(() => {
              showToast('Copy failed. Please copy manually.');
            });
        }
      });

      // New graph from popup
      document.getElementById('newGraphBtn').addEventListener('click', () => {
        const inputName = prompt('Enter graph name:');
        const name = sanitizeGraphName(inputName);
        if (name) {
          const graph = createEmptyGraph(name);
          graphs.push(graph);
          activeGraphId = graph.id;
          saveData();
          updateGraphSelect();
          renderGraphList();
          showToast(`Graph "${name}" created`);
        }
      });

      // Create graph from manage
      document.getElementById('createGraphBtn').addEventListener('click', () => {
        const input = document.getElementById('newGraphInput');
        const name = sanitizeGraphName(input.value);
        if (!name) return;
        const graph = createEmptyGraph(name);
        graphs.push(graph);
        activeGraphId = graph.id;
        input.value = '';
        saveData();
        renderGraphList();
        updateGraphSelect();
        showToast(`Graph "${name}" created`);
      });

      // Settings
      document.getElementById('settingsBtn').addEventListener('click', () => {
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById('settingsPanel').classList.add('active');
        syncSettingsToUi();
      });

      document.getElementById('saveApiKeyBtn').addEventListener('click', async () => {
        settings.apiKey = sanitizeText(document.getElementById('apiKeyInput').value, 200);
        settings.useAI = !!settings.apiKey;
        settings.aiRouting = document.getElementById('aiRoutingSelect').value;
        settings.aiProvider = document.getElementById('aiProviderSelect').value;
        settings.aiModel = document.getElementById('aiModelSelect').value;
        settings.gatewayBaseUrl = sanitizeBaseUrl(document.getElementById('gatewayBaseUrlInput').value);

        if (settings.aiRouting === 'aiGateway') {
          if (!settings.gatewayBaseUrl) {
            showToast('Add a valid HTTPS Gateway Base URL');
            return;
          }
          const granted = await ensureGatewayPermission(settings.gatewayBaseUrl);
          if (!granted) {
            showToast('Gateway domain permission is required to use AI Gateway');
            return;
          }
        }

        saveData();
        showToast(settings.useAI ? 'API key saved. AI mode enabled.' : 'API key cleared.');
      });

      document.getElementById('aiRoutingSelect').addEventListener('change', (e) => {
        settings.aiRouting = e.target.value;
        updateRoutingUi();
      });

      document.getElementById('aiProviderSelect').addEventListener('change', (e) => {
        settings.aiProvider = e.target.value;
        populateModelOptions();
      });

      document.getElementById('aiModelSelect').addEventListener('change', (e) => {
        settings.aiModel = e.target.value;
      });

      document.getElementById('autoExtractToggle').addEventListener('change', (e) => {
        settings.autoExtract = e.target.checked;
        saveData();
      });

      document.getElementById('extractModeSelect').addEventListener('change', (e) => {
        settings.defaultExtractMode = e.target.value;
        saveData();
      });

      // Export all
      document.getElementById('exportAllBtn').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(graphs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'knowledge-graphs-export.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('All graphs exported');
      });

      // Import
      document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
      });

      document.getElementById('importFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          showToast('Import file too large (max 5 MB)');
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const imported = JSON.parse(ev.target.result);
            const importedGraphs = Array.isArray(imported) ? imported : [imported];
            const normalized = normalizeGraphs(importedGraphs);
            if (normalized.length === 0) {
              throw new Error('No valid graph records found');
            }
            if (Array.isArray(imported)) {
              graphs = [...graphs, ...normalized];
            } else if (normalized[0]) {
              graphs.push(normalized[0]);
            }
            if (!activeGraphId && graphs.length > 0) {
              activeGraphId = graphs[0].id;
            }
            saveData();
            renderGraphList();
            updateGraphSelect();
            showToast(`Imported ${normalized.length} graph${normalized.length > 1 ? 's' : ''}`);
          } catch (err) {
            showToast('Invalid file format');
          }
          e.target.value = '';
        };
        reader.readAsText(file);
      });

      // Close node detail
      document.getElementById('closeDetailBtn').addEventListener('click', () => {
        document.getElementById('nodeDetail').classList.add('hidden');
        selectedNodeId = null;
      });

      window.addEventListener('unload', () => {
        if (graphAnimFrameId) {
          cancelAnimationFrame(graphAnimFrameId);
          graphAnimFrameId = null;
        }
      });

      // Load API key
      syncSettingsToUi();
    });
  }

  init();
})();
