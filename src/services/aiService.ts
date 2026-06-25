import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

export interface GenerationResult {
  content: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// 2,500 words ≈ 3,500 tokens. Set ceiling well above to guarantee a full script.
const GEMINI_MAX_OUTPUT_TOKENS = 16384;
const CLAUDE_MAX_OUTPUT_TOKENS = 16000;

// ── Gemini ─────────────────────────────────────────────────────────────────
async function generateWithGemini(
  prompt: string,
  systemPrompt: string,
): Promise<GenerationResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const primaryModel = process.env.AI_MODEL || 'gemini-2.5-flash';
  const fallbackModel = 'gemini-2.0-flash';

  const modelsToTry = primaryModel !== fallbackModel
    ? [primaryModel, fallbackModel]
    : [primaryModel];

  let lastError: unknown;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const geminiModel = genAI.getGenerativeModel({
          model,
          systemInstruction: systemPrompt,
          generationConfig: {
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            temperature: 0.85,
          },
        });

        const result = await geminiModel.generateContent(prompt);
        const response = result.response;

        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
          console.warn(`[Gemini] Unexpected finish reason: ${finishReason}`);
        }

        const content = response.text();
        const usage = response.usageMetadata;

        if (model !== primaryModel) {
          console.warn(`[Gemini] Used fallback model: ${model}`);
        }

        return {
          content,
          provider: 'gemini',
          model,
          inputTokens: usage?.promptTokenCount || 0,
          outputTokens: usage?.candidatesTokenCount || 0,
        };
      } catch (err: unknown) {
        lastError = err;
        const status = (err as { status?: number }).status;
        if (status === 503 || status === 429) {
          const delay = attempt * 5000;
          console.warn(`[Gemini] ${status} on ${model} — retry ${attempt}/3 in ${delay / 1000}s`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          break;
        }
      }
    }
  }

  throw lastError;
}

// ── Claude ──────────────────────────────────────────────────────────────────
async function generateWithClaude(
  prompt: string,
  systemPrompt: string,
): Promise<GenerationResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.AI_MODEL || 'claude-opus-4-8';

  const response = await anthropic.messages.create({
    model,
    max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn('[Claude] Script was cut off at max_tokens — consider raising the limit.');
  }

  const content = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');

  return {
    content,
    provider: 'claude',
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── Router ──────────────────────────────────────────────────────────────────
export async function generateScript(
  prompt: string,
  systemPrompt: string,
): Promise<GenerationResult> {
  const provider = process.env.AI_PROVIDER || 'gemini';

  if (provider === 'gemini') return generateWithGemini(prompt, systemPrompt);
  if (provider === 'claude') return generateWithClaude(prompt, systemPrompt);

  throw new Error(`Unsupported AI_PROVIDER: "${provider}". Use "gemini" or "claude".`);
}
