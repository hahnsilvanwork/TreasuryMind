// AI advisor endpoints: questions → recommend (Claude) → execute a chosen option.
import { Router, type Router as RouterType } from 'express';
import { getQuestions, advise, executeOption, type AdvisorOption } from '../agents/advisor.js';

export const advisorRouter: RouterType = Router();

advisorRouter.get('/advisor/questions', (_req, res) => res.json(getQuestions()));

advisorRouter.post('/advisor/recommend', async (req, res) => {
  const answers = (req.body?.answers ?? {}) as Record<string, string>;
  try {
    res.json(await advise(answers));
  } catch (e) {
    res.status(502).json({ error: 'advisor failed', detail: (e as Error).message });
  }
});

advisorRouter.post('/advisor/execute', async (req, res) => {
  const opt = req.body?.option as AdvisorOption | undefined;
  if (!opt) return res.status(400).json({ error: 'option required' });
  try {
    res.json(await executeOption(opt));
  } catch (e) {
    res.status(502).json({ error: 'execution failed', detail: (e as Error).message });
  }
});
