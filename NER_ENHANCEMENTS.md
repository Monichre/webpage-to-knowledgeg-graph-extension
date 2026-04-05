# NER Extraction Quality Enhancements

This document describes the knowledge graph extraction improvements implemented following the [Claude Knowledge Graph Guide](https://platform.claude.com/cookbook/capabilities-knowledge-graph-guide).

## Overview

The extension now uses advanced NER (Named Entity Recognition) and relationship extraction techniques to produce higher-quality knowledge graphs with better entity resolution, richer metadata, and quality metrics.

## Key Enhancements

### 1. Expanded Entity Type System

**Before:** 4 entity types (topic, entity, association, concept)

**After:** 7 specialized entity types aligned with Claude's recommendations:

- **person**: Named individuals (e.g., "Tim Berners-Lee", "Marie Curie")
- **organization**: Companies, institutions, groups (e.g., "OpenAI", "MIT")
- **location**: Geographic places (e.g., "San Francisco", "Amazon Rainforest")
- **concept**: Abstract ideas, theories, principles (e.g., "Photosynthesis", "Recursion")
- **event**: Specific occurrences, milestones (e.g., "Apollo 11 Moon Landing")
- **technology**: Tools, systems, platforms (e.g., "React Framework", "CRISPR")
- **topic**: Subject domains, fields of study (e.g., "Machine Learning", "Economics")

This provides better semantic clarity and enables more precise knowledge representation.

### 2. Entity Resolution with Aliases

**Implementation:** The AI now extracts both canonical entity names and their aliases/synonyms.

**Example:**
```json
{
  "label": "National Aeronautics and Space Administration",
  "aliases": ["NASA", "US Space Agency"]
}
```

**Benefits:**
- Prevents duplicate nodes for the same entity with different names
- Enables flexible edge resolution (edges can reference entities by label or alias)
- Improves graph coherence when content uses multiple terms for the same entity

**Resolution Strategy:**
1. Exact label match
2. Case-insensitive label match
3. Alias lookup (case-insensitive)

### 3. Confidence Scoring

Both nodes and edges now include confidence scores (0.0-1.0) indicating extraction quality:

**Node Confidence Levels:**
- **0.9-1.0**: Explicitly stated, unambiguous
- **0.7-0.89**: Clearly implied or strongly supported
- **0.5-0.69**: Reasonably inferred from context
- **Below 0.5**: Uncertain or speculative

**Edge Confidence:** Similar scale, reflecting certainty in the relationship

**Usage:**
- Helps identify high-quality vs. speculative extractions
- Enables confidence-based filtering or ranking
- Provides transparency about extraction quality

### 4. Enhanced Relationship Extraction

**Improvements:**
- More specific verb phrases (e.g., "founded in 1998" vs. "related to")
- Bidirectional relationship tracking (indicates if relationship works both ways)
- Better semantic grounding in source text

**Example:**
```json
{
  "sourceLabel": "Tim Berners-Lee",
  "targetLabel": "World Wide Web",
  "relationship": "invented",
  "confidence": 0.95,
  "bidirectional": false
}
```

### 5. Quality Metrics

Each extraction now calculates quality metrics:

- **avgNodeConfidence**: Average confidence across all extracted nodes
- **avgEdgeConfidence**: Average confidence across all relationships
- **totalAliases**: Number of entity aliases identified (indicates entity resolution activity)

These metrics are:
- Returned with extraction results
- Displayed in success messages
- Available for quality assessment and debugging

### 6. Improved Prompt Engineering

The extraction prompt now includes:

1. **Structured Schema**: Clear JSON structure with all required fields
2. **Detailed Type Definitions**: Examples and descriptions for each entity type
3. **Extraction Guidelines**:
   - Entity resolution instructions
   - Quality over quantity emphasis (10-30 entities)
   - Relationship quality criteria
   - Confidence scoring rubric
   - Alias extraction guidance
4. **Validation Rules**: Ensures all edges connect valid nodes

### 7. Enhanced Local Fallback

When AI is unavailable, the local extraction fallback now:

- Extracts up to 30 entities (vs. 25)
- Uses improved heuristics for entity type classification:
  - Technology keywords (expanded list)
  - Organization indicators (Inc, Corp, Foundation, etc.)
  - Location indicators (City, State, Region, etc.)
  - Person name patterns (two capitalized words)
- Includes confidence scores (0.6 for nodes, 0.5 for edges)
- Adds aliases field (empty, but structure-compatible)
- Marks extractions as bidirectional relationships

## Technical Implementation

### Modified Functions

1. **`buildKnowledgePrompt(text)`** (popup.js:510-576)
   - Completely redesigned prompt with structured schema
   - Added 7 entity types, confidence scoring, aliases
   - Included detailed extraction guidelines

2. **`parseAiGraphResponse(jsonText)`** (popup.js:582-691)
   - Implements three-tier entity resolution (exact, case-insensitive, alias)
   - Extracts and stores aliases
   - Calculates quality metrics
   - Validates confidence scores

3. **`sanitizeNodeType(value)`** (popup.js:101-104)
   - Updated to validate 7 entity types

4. **`normalizeGraph(rawGraph)`** (popup.js:217-265)
   - Preserves aliases and confidence scores during normalization
   - Handles bidirectional edge metadata

5. **`extractEntitiesLocal(text)`** (popup.js:448-533)
   - Enhanced heuristics for entity classification
   - Adds confidence scores and aliases structure
   - Expanded to 30 entities

6. **`addToGraph()`** (popup.js:948-965)
   - Displays quality metrics in success messages

### Color Scheme

Updated NODE_COLORS to visually distinguish entity types:

```javascript
person:       '#8A7A9B'  // Purple
organization: '#6B8A9B'  // Blue
location:     '#6B9B8A'  // Teal
concept:      '#8A969B'  // Gray
event:        '#9B8A6B'  // Gold
technology:   '#7B8A9B'  // Steel blue
topic:        '#6B8A7B'  // Green
```

## Usage Examples

### High-Quality Extraction (AI-powered)

Extracting from a Wikipedia article about Claude Shannon:

```json
{
  "nodes": [
    {
      "label": "Claude Shannon",
      "type": "person",
      "description": "American mathematician and electrical engineer known as the father of information theory.",
      "aliases": ["Claude Elwood Shannon"],
      "confidence": 0.95
    },
    {
      "label": "Information Theory",
      "type": "concept",
      "description": "Mathematical study of quantifying, storing, and communicating information.",
      "aliases": ["Shannon's Theory", "Mathematical Theory of Communication"],
      "confidence": 0.92
    }
  ],
  "edges": [
    {
      "sourceLabel": "Claude Shannon",
      "targetLabel": "Information Theory",
      "relationship": "founded",
      "confidence": 0.94,
      "bidirectional": false
    }
  ]
}
```

**Metrics:**
- Node confidence: 94%
- Edge confidence: 94%
- 3 aliases resolved

### Fallback Extraction (Local)

When AI is unavailable, the system still extracts entities using pattern matching:

- Identifies capitalized phrases
- Classifies using heuristics
- Lower confidence scores (0.6 for nodes, 0.5 for edges)
- Generic "related to" relationships
- All relationships marked as bidirectional

## Best Practices

1. **Use AI extraction when possible**: AI-powered extraction produces significantly higher quality results with proper entity typing, relationships, and aliases.

2. **Monitor quality metrics**: Pay attention to confidence scores. Consistently low confidence may indicate:
   - Content that's difficult to extract from
   - Need for prompt tuning
   - Issues with the source material

3. **Review alias resolution**: Check that aliases are being properly identified. High alias counts indicate good entity resolution.

4. **Leverage entity types**: The 7-type system enables better organization and filtering. Use type information when visualizing or querying graphs.

5. **Confidence-based filtering**: For critical applications, consider filtering or flagging low-confidence extractions for manual review.

## Future Enhancements

Potential improvements aligned with Claude's knowledge graph guide:

1. **Multi-chunk processing**: For very large documents (>60K chars), implement chunked extraction with cross-chunk entity resolution
2. **Iterative refinement**: Use Claude to review and improve extracted graphs
3. **Graph querying**: Enable natural language queries over the knowledge graph
4. **Quality evaluation**: Implement precision/recall metrics using gold-standard datasets
5. **Entity linking**: Connect entities to external knowledge bases (Wikipedia, Wikidata)
6. **Temporal relationships**: Add support for time-based relationships and event sequencing

## References

- [Claude Knowledge Graph Guide](https://platform.claude.com/cookbook/capabilities-knowledge-graph-guide)
- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)
- [Claude Prompt Engineering](https://docs.anthropic.com/en/docs/prompt-engineering)

## Version History

- **v1.1.0** (2026-04-05): Implemented enhanced NER extraction following Claude guide
  - 7 entity types
  - Entity resolution with aliases
  - Confidence scoring
  - Quality metrics
  - Improved prompts and local fallback
