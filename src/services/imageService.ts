import axios from 'axios';
import JSZip from 'jszip';

export interface SentenceImage {
  sentence: string;
  keywords: string;
  imageUrl: string | null;
  thumbnail: string | null;
  imageAlt: string;
}

export interface SectionImages {
  title: string;
  items: SentenceImage[];
}

const DDG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0',
  'Accept-Language': 'en-US,en;q=0.5',
};

async function getDDGVqd(query: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>('https://duckduckgo.com/', {
      params: { q: query, iax: 'images', ia: 'images' },
      headers: DDG_HEADERS,
      timeout: 8000,
    });
    const match =
      data.match(/vqd=['"]([^'"]+)['"]/) ||
      data.match(/vqd=([^&\s"']+)/) ||
      data.match(/data-vqd=['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function searchDDG(
  query: string,
): Promise<{ url: string; thumbnail: string; alt: string } | null> {
  const vqd = await getDDGVqd(query);
  if (!vqd) return null;

  try {
    const { data } = await axios.get('https://duckduckgo.com/i.js', {
      params: { q: query, o: 'json', p: 1, s: 0, u: 'bing', f: ',,,', l: 'us-en', vqd },
      headers: { ...DDG_HEADERS, Referer: 'https://duckduckgo.com/' },
      timeout: 8000,
    });

    type DDGPhoto = { image: string; thumbnail: string; title: string };
    const results = (data as { results: DDGPhoto[] }).results;
    const first = results?.[0];
    if (!first?.image) return null;

    return { url: first.image, thumbnail: first.thumbnail, alt: first.title || query };
  } catch {
    return null;
  }
}

// ─── Script parsing ───────────────────────────────────────────────────────────

function parseScriptSections(content: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  const parts = content.split(/(?=^##\s*SECTION\s*\d+)/im);

  for (const part of parts) {
    const match = part.match(/^##\s*(SECTION\s*\d+[^\n]*)/i);
    if (!match) continue;
    const title = match[1].trim();
    const body = part.slice(match[0].length).trim();
    sections.push({ title, body });
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
      const sentences = line
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .filter((s) => s.length > 15);
      units.push(...sentences);
    }
  }
  return units;
}

function extractKeywords(sentence: string): string {
  const proper = (sentence.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,})*/g) || []).filter(
    (w) =>
      !['The', 'This', 'That', 'Welcome', 'And', 'But', 'Now', 'Here', 'Let', 'As', 'In', 'It', 'World', 'Cup'].includes(w),
  );
  const top = proper.slice(0, 2).join(' ');
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
          const img = await searchDDG(keywords);
          return {
            sentence,
            keywords,
            imageUrl: img?.url ?? null,
            thumbnail: img?.thumbnail ?? null,
            imageAlt: img?.alt ?? keywords,
          };
        }),
      );
      items.push(...batchResults);
      if (i + 5 < units.length) await new Promise((r) => setTimeout(r, 300));
    }

    result.push({ title: section.title, items });
  }

  return result;
}

export async function createImagesZip(sections: SectionImages[]): Promise<Buffer> {
  const zip = new JSZip();

  const tasks: { url: string; path: string }[] = [];
  sections.forEach((section, sIdx) => {
    const folder = `S${sIdx + 1}_${section.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
    section.items.forEach((item, iIdx) => {
      if (item.imageUrl) {
        const ext = item.imageUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] ?? 'jpg';
        tasks.push({
          url: item.imageUrl,
          path: `${folder}/${String(iIdx + 1).padStart(2, '0')}.${ext}`,
        });
      }
    });
  });

  for (let i = 0; i < tasks.length; i += 5) {
    await Promise.all(
      tasks.slice(i, i + 5).map(async ({ url, path }) => {
        try {
          const res = await axios.get<ArrayBuffer>(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          zip.file(path, res.data);
        } catch { /* skip inaccessible images */ }
      }),
    );
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}
