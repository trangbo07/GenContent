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

async function searchSerper(query: string, num = 3): Promise<ImageOption[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  try {
    const { data } = await axios.post(
      'https://google.serper.dev/images',
      { q: query, num },
      {
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        timeout: 8000,
      },
    );

    type SerperImg = { imageUrl: string; thumbnailUrl: string; title: string; source: string };
    return ((data as { images: SerperImg[] }).images || []).map((img) => ({
      url: img.imageUrl,
      thumbnail: img.thumbnailUrl,
      alt: img.title || query,
      source: img.source || '',
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
      !['The','This','That','Welcome','And','But','Now','Here','Let','As','In','It','World','Cup'].includes(w),
  );
  const top = proper.slice(0, 3).join(' ');
  return top ? `${top} football` : 'FIFA World Cup 2026 football';
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
          const images = await searchSerper(keywords, 3);
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
