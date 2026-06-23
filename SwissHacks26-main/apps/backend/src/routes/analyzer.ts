// Liquidity Analyzer endpoints (AI #2): structured overview (deterministic, fast) + redistribution
// suggestions with an LLM narrative.
import { Router, type Router as RouterType } from 'express';
import { overview, suggestions, analyze } from '../agents/analyzer.js';

export const analyzerRouter: RouterType = Router();

// fast, deterministic snapshot — no LLM call
analyzerRouter.get('/analyzer/overview', (_req, res) => res.json(overview()));

// just the proposed inter-company moves (deterministic)
analyzerRouter.get('/analyzer/suggestions', (_req, res) => res.json(suggestions()));

// full result incl. LLM narrative (or template fallback)
analyzerRouter.get('/analyzer', async (_req, res) => res.json(await analyze()));
