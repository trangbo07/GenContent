import axios from 'axios';
import JSZip from 'jszip';

export interface ImageOption {
  url: string;
  thumbnail: string;
  alt: string;
  source: string;
}

export interface SentenceImage {
  sentence: string;
  keywords: string;
  images: ImageOption[];
}

export interface SectionImages {
  title: string;
  items: SentenceImage[];
}

// Wikipedia API — free, no API key, relevant player/team/tournament images
async function searchWikipedia(query: string): Promise<ImageOption[]> {
  try {
    const { data } = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrlimit: 5,
        prop: 'pageimages|info',
        pithumbsize: 600,
        inprop: 'url',
        format: 'json',
        origin: '*',
      },
      timeout: 8000,
    });

    type WikiPage = { title: string; thumbnail?: { source: string }; fullurl?: string };
    const pages = Object.values(
      (data as { query?: { pages?: Record<string, WikiPage> } }).query?.pages ?? {},
    );

    return pages
      .filter((p) => p.thumbnail?.source)
      .slice(0, 3)
      .map((p) => ({
        url: p.thumbnail!.source.replace(/\/\d+px-/, '/800px-'),
        thumbnail: p.thumbnail!.source,
        alt: p.title,
        source: 'Wikipedia',
      }));
  } catch {
    return [];
  }
}

// ─── Script parsing ───────────────────────────────────────────────────────────

function parseScriptSections(content: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  const parts = content.split(/(?=^##\s*SECTION\s*\d+)/im);
  for (const part of parts) {
    const match = part.match(/^##\s*(SECTION\s*\d+[^\n]*)/i);
    if (!match) continue;
    sections.push({ title: match[1].trim(), body: part.slice(match[0].length).trim() });
  }
  return sections;
}

function extractUnits(body: string): string[] {
  const units: string[] = [];
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && l !== '---' && !l.startsWith('#'));

  for (const line of lines) {
    if (line.length < 160) {
      units.push(line);
    } else {
      units.push(...line.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.length > 15));
    }
  }
  return units;
}

function extractKeywords(sentence: string): string {
  const proper = (sentence.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,})*/g) || []).filter(
    (w) =>
      !['The','This','That','Welcome','And','But','Now','Here','Let','As','In','It','With','From','After'].includes(w),
  );
  // Use fewer, more specific terms so Wikipedia can find the right article
  const top = proper.slice(0, 2).join(' ');
  if (!top) return '2026 FIFA World Cup';
  // If only generic words remain, add World Cup context
  if (top.split(' ').every(w => ['World','Cup','Football','Soccer','Group','Match','Game','Team','Player'].includes(w))) {
    return '2026 FIFA World Cup';
  }
  return top;
}

// ─── AI Prompt Generation ────────────────────────────────────────────────────

export interface PromptItem {
  sentence: string;
  prompt: string;
}

export interface SectionPrompts {
  title: string;
  items: PromptItem[];
}

export async function generatePromptsForScript(content: string): Promise<SectionPrompts[]> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: process.env.AI_MODEL ?? 'gemini-2.5-flash' });

  const sections = parseScriptSections(content);
  const all: { sIdx: number; sentence: string }[] = [];
  sections.forEach((sec, sIdx) => extractUnits(sec.body).forEach((s) => all.push({ sIdx, sentence: s })));
  if (all.length === 0) return [];

  const numbered = all.map((s, i) => `${i + 1}. ${s.sentence}`).join('\n');
  const aiPrompt = `You are an expert AI image prompt engineer for Midjourney v6.1 and DALL-E 3.
For each numbered sentence from a FIFA World Cup 2026 sports news broadcast script, write ONE detailed image generation prompt.
Rules:
- Describe a specific vivid visual scene (subjects, actions, emotions, colors, setting, crowd, lighting)
- Always include "FIFA World Cup 2026" context
- Professional sports photography style, dramatic, cinematic
- End every prompt with: --ar 16:9 --v 6.1 --style raw
- Return ONLY the numbered list (1. ... 2. ... etc.), no markdown, no extra text

Sentences:
${numbered}`;

  let promptLines: string[] = [];
  try {
    const result = await model.generateContent(aiPrompt);
    promptLines = result.response
      .text()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+\./.test(l))
      .map((l) => l.replace(/^\d+\.\s*/, '').trim());
  } catch { /* fallback below */ }

  const sectionResults: SectionPrompts[] = sections.map((sec) => ({ title: sec.title, items: [] }));
  all.forEach(({ sIdx, sentence }, i) => {
    const p =
      promptLines[i] ??
      `${sentence.trim()}, FIFA World Cup 2026, professional sports photography, dramatic stadium lighting, packed crowd, cinematic, 8K HDR --ar 16:9 --v 6.1 --style raw`;
    sectionResults[sIdx].items.push({ sentence, prompt: p });
  });

  return sectionResults.filter((s) => s.items.length > 0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function findImagesForScript(content: string): Promise<SectionImages[]> {
  const sections = parseScriptSections(content);
  const result: SectionImages[] = [];

  for (const section of sections) {
    const units = extractUnits(section.body);
    const items: SentenceImage[] = [];

    for (let i = 0; i < units.length; i += 5) {
      const batch = units.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (sentence) => {
          const keywords = extractKeywords(sentence);
          const images = await searchWikipedia(keywords);
          return { sentence, keywords, images };
        }),
      );
      items.push(...batchResults);
      if (i + 5 < units.length) await new Promise((r) => setTimeout(r, 200));
    }

    result.push({ title: section.title, items });
  }

  return result;
}

export async function createImagesZip(
  selectedUrls: { url: string; filename: string }[],
): Promise<Buffer> {
  const zip = new JSZip();

  for (let i = 0; i < selectedUrls.length; i += 5) {
    await Promise.all(
      selectedUrls.slice(i, i + 5).map(async ({ url, filename }) => {
        try {
          const res = await axios.get<ArrayBuffer>(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          zip.file(filename, res.data);
        } catch { /* skip inaccessible */ }
      }),
    );
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}
