// Agent layer endpoints (AG1–AG4): forecast, radar, watchlist, recommendations, autonomous sweep.
import { Router, type Router as RouterType } from 'express';
import { forecastAll, snapshotForecasts } from '../agents/forecast.js';
import { radarAll } from '../agents/radar.js';
import { watchlist, runAutonomousSweeps } from '../agents/sweep.js';
import { recommendations } from '../agents/fundingRouter.js';

export const agentRouter: RouterType = Router();

agentRouter.get('/agent/forecast', (_req, res) => res.json(forecastAll()));
agentRouter.get('/agent/radar', (_req, res) => res.json(radarAll()));
agentRouter.get('/agent/watchlist', (_req, res) => res.json(watchlist()));
agentRouter.get('/agent/recommendations', (_req, res) => res.json(recommendations()));

// persist a ForecastSnapshot set (typed contract records)
agentRouter.post('/agent/snapshot-forecasts', (_req, res) => res.json(snapshotForecasts()));

// AG3 — fire all auto-eligible sweeps unattended (the demo triggers this after advancing the clock)
agentRouter.post('/agent/run-sweep', async (_req, res) => res.json(await runAutonomousSweeps()));
