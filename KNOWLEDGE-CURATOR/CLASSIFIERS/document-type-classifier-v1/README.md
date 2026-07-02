# Document Type Classifier V1

## Purpose

Deterministic document type classification for the Knowledge Pipeline.

## Runtime module

Code:

- `backend/services/knowledge/document-type-classifier.js`

Rules:

- `backend/services/knowledge/document-type-classifier-rules.js`

## Output

The classifier returns:

- `type`
- `confidence`
- `reasons`
- `signals`

## Supported types

- Governance
- Roadmap
- Documentation
- Learning
- Meeting
- Notes
- Email
- Generic

## Rules

V1 uses traceable deterministic signals only:

- file name
- path
- extension
- titles or headings
- structural keywords

No AI, no agents, and no generated Knowledge Objects are stored in this lab folder.
