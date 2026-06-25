import axios from 'axios';

const PEXELS_KEY = process.env.PEXELS_API_KEY || '';

export interface SentenceImage {
  sentence: string;
  keywords: string;
  imageUrl: string | null;
  imageAlt: string;
  photographer: string;
  pexelsUrl: string;
}

export interface SectionImages {
  title: string;
  items: SentenceImage[];
}

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
  const proper = (
    sentence.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,})*/g) || []
  ).filter(
    (w) =>
      ![
        'The', 'This', 'That', 'These', 'Welcome', 'And', 'But', 'Now',
        'Here', 'Let', 'As', 'In', 'It', 'World', 'Cup', 'Section',
      ].includes(w),
  );

  const top = proper.slice(0, 2).join(' ');
  return top ? `${top} football` : 'FIFA World Cup 2026 football';
}

async function searchPexels(
  query: string,
): Promise<{ url: string; alt: string; photographer: string; pexelsUrl: string } | null> {
  if (!PEXELS_KEY) return null;
  try {
    const { data } = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 1, orientation: 'landscape' },
      headers: { Authorization: PEXELS_KEY },
      timeout: 6000,
    });
    const p = data.photos?.[0];
    if (!p) return null;
    return {
      url: p.src.large as string,
      alt: (p.alt as string) || query,
      photographer: p.photographer as string,
      pexelsUrl: p.url as string,
    };
  } catch {
    return null;
  }
}

export async function findImagesForScript(content: string): Promise<SectionImages[]> {
  const sections = parseScriptSections(content);
  const result: SectionImages[] = [];

  for (const section of sections) {
    const units = extractUnits(section.body);
    const items: SentenceImage[] = [];

    // Process in batches of 5 to stay within rate limits
    for (let i = 0; i < units.length; i += 5) {
      const batch = units.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (sentence) => {
          const keywords = extractKeywords(sentence);
          const img = await searchPexels(keywords);
          return {
            sentence,
            keywords,
            imageUrl: img?.url ?? null,
            imageAlt: img?.alt ?? keywords,
            photographer: img?.photographer ?? '',
            pexelsUrl: img?.pexelsUrl ?? '',
          };
        }),
      );
      items.push(...batchResults);
      if (i + 5 < units.length) await new Promise((r) => setTimeout(r, 150));
    }

    result.push({ title: section.title, items });
  }

  return result;
}
