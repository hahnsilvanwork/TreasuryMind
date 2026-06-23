// Provider-agnostic LLM layer. Default = Groq (free, OpenAI-compatible). Switch provider purely via
// .env — no code change — to xAI Grok, OpenAI, Gemini (OpenAI-compat), a local server, or Anthropic.
//   AI_PROVIDER : "openai" (any OpenAI-compatible endpoint) | "anthropic"   (auto-detected if unset)
//   AI_API_BASE : base URL for the OpenAI-compatible API (default Groq)
//   AI_API_KEY  : the key
//   AI_MODEL    : model id (default a Groq Llama model)
// Every AI feature degrades to a deterministic rule-based path when no key is set, so the app always works.
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_OPENAI_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_OPENAI_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

interface Cfg {
  provider: 'openai' | 'anthropic' | 'none';
  base: string;
  model: string;
  key: string | undefined;
}

function cfg(): Cfg {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  const openaiKey = process.env.AI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const provider = (explicit as Cfg['provider']) || (openaiKey ? 'openai' : anthropicKey ? 'anthropic' : 'none');
  const base = process.env.AI_API_BASE?.trim() || DEFAULT_OPENAI_BASE;
  const model =
    process.env.AI_MODEL?.trim() ||
    process.env.CLAUDE_MODEL?.trim() ||
    (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL);
  const key = provider === 'anthropic' ? anthropicKey : openaiKey || anthropicKey;
  return { provider, base, model, key };
}

export interface AiInfo {
  enabled: boolean;
  provider: string;
  model: string;
}

export function aiInfo(): AiInfo {
  const c = cfg();
  return { enabled: Boolean(c.key) && c.provider !== 'none', provider: c.provider, model: c.model };
}

export function aiEnabled(): boolean {
  return aiInfo().enabled;
}

export interface CompleteArgs {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
}

/** Single entry point for all LLM calls. Throws on any error so callers fall back to rules. */
export async function complete(args: CompleteArgs): Promise<string> {
  const c = cfg();
  if (!c.key || c.provider === 'none') throw new Error('no AI key configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    if (c.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: c.key });
      const res = await client.messages.create({
        model: c.model,
        max_tokens: args.maxTokens ?? 1600,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      });
      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }

    // OpenAI-compatible (Groq / xAI / OpenAI / Gemini-openai / local)
    const res = await fetch(`${c.base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model,
        temperature: 0.3,
        max_tokens: args.maxTokens ?? 1600,
        ...(args.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI ${c.provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('AI returned no content');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/** Tolerant JSON extraction — strips code fences and grabs the outermost object. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as T;
}
