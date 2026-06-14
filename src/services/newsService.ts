import Parser from 'rss-parser';
import { supabase } from '../lib/supabase';
import { calculateHotScore } from './hotScoreEngine';

const FEED_TIMEOUT_MS = 10000;
const MAX_AGE_HOURS = 48;
const ITEMS_PER_FEED = 15;

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  customFields: { item: ['media:content', 'media:thumbnail'] },
});

interface RssFeed {
  url: string;
  source: string;
  /** Higher = trusted / faster wire-style outlet */
  priority: number;
}

/** International sports news — wire services + major global outlets */
const RSS_FEEDS: RssFeed[] = [
  { url: 'https://feeds.apnews.com/apf-sports',           source: 'AP Sports',            priority: 10 },
  { url: 'https://www.reuters.com/rssFeed/sportsNews',   source: 'Reuters Sports',       priority: 10 },
  { url: 'https://www.fifa.com/fifaplus/en/rss/news',    source: 'FIFA',                 priority: 10 },
  { url: 'https://www.espn.com/espn/rss/soccer/news',    source: 'ESPN FC',              priority: 9 },
  { url: 'https://www.espn.com/espn/rss/news',           source: 'ESPN',                 priority: 8 },
  { url: 'https://www.goal.com/feeds/en/news',           source: 'Goal.com',             priority: 9 },
  { url: 'https://www.cbssports.com/rss/headlines/',     source: 'CBS Sports',           priority: 8 },
  { url: 'https://sports.yahoo.com/rss/',                source: 'Yahoo Sports',         priority: 8 },
  { url: 'https://www.si.com/rss/si_topnews.rss',        source: 'Sports Illustrated',   priority: 7 },
  { url: 'https://feeds.bbci.co.uk/sport/rss.xml',       source: 'BBC Sport',            priority: 8 },
  { url: 'https://www.theguardian.com/sport/rss',        source: 'The Guardian Sport',   priority: 8 },
  { url: 'https://www.marca.com/en/rss.html',            source: 'MARCA',                priority: 7 },
  { url: 'https://rss.dw.com/rdf/rss-en-sports',         source: 'DW Sports',            priority: 6 },
  { url: 'https://www.football365.com/feed',             source: 'Football365',          priority: 7 },
];

export interface NewsItem {
  title: string;
  content: string;
  source: string;
  url: string;
  publishedAt: Date;
  hotScore: number;
  category: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Feed timeout')), ms),
    ),
  ]);
}

function parsePublishedAt(item: Parser.Item): Date {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return new Date();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooOld(publishedAt: Date): boolean {
  const ageHours = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
  return ageHours > MAX_AGE_HOURS;
}

function rankScore(item: NewsItem, feedPriority: number): number {
  const ageHours = (Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60);
  const freshness = ageHours < 1 ? 30 : ageHours < 3 ? 25 : ageHours < 6 ? 18 : ageHours < 12 ? 10 : 0;
  return item.hotScore + freshness + feedPriority * 2;
}

function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>();

  for (const item of items) {
    const key = normalizeTitle(item.title);
    const existing = seen.get(key);
    if (!existing || item.hotScore > existing.hotScore) {
      seen.set(key, item);
    }
  }

  return [...seen.values()];
}

export async function fetchNewsFromFeeds(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const result = await withTimeout(parser.parseURL(feed.url), FEED_TIMEOUT_MS);
      const feedItems: NewsItem[] = [];

      for (const item of result.items.slice(0, ITEMS_PER_FEED)) {
        const title = item.title?.trim() || '';
        const content = (item.contentSnippet || item.content || '').trim();
        if (!title) continue;

        const publishedAt = parsePublishedAt(item);
        if (isTooOld(publishedAt)) continue;

        const hotScore = calculateHotScore({ title, content, publishedAt });

        feedItems.push({
          title,
          content,
          source: feed.source,
          url: item.link || '',
          publishedAt,
          hotScore,
          category: classifyNewsCategory(title + ' ' + content),
        });
      }

      return { feed, feedItems };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      items.push(...r.value.feedItems);
    } else {
      console.warn(`[RSS] Failed: ${RSS_FEEDS[i].source} — ${r.reason?.message ?? r.reason}`);
    }
  }

  const priorityMap = new Map(RSS_FEEDS.map((f) => [f.source, f.priority]));

  return dedupeNewsItems(items).sort((a, b) => {
    const scoreA = rankScore(a, priorityMap.get(a.source) ?? 5);
    const scoreB = rankScore(b, priorityMap.get(b.source) ?? 5);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });
}

function classifyNewsCategory(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('injur'))                                              return 'injury';
  if (t.includes('suspend') || t.includes('ban') || t.includes(' card')) return 'suspension';
  if (t.includes('goal') || t.includes('score') || t.includes('result')) return 'match';
  if (t.includes('record') || t.includes('milestone') || t.includes('histor')) return 'record';
  if (t.includes('transfer') || t.includes('squad') || t.includes('lineup'))  return 'squad';
  if (t.includes('fan') || t.includes('culture') || t.includes('atmosphere'))  return 'human-interest';
  return 'general';
}

export async function syncNewsToDB(newsItems: NewsItem[]): Promise<void> {
  for (const item of newsItems) {
    const { data: existing } = await supabase
      .from('news')
      .select('id')
      .eq('title', item.title)
      .eq('source', item.source)
      .maybeSingle();

    if (!existing) {
      await supabase.from('news').insert({
        id: crypto.randomUUID(),
        title: item.title,
        content: item.content,
        source: item.source,
        url: item.url,
        hot_score: item.hotScore,
        category: item.category,
        published_at: item.publishedAt.toISOString(),
      });
    }
  }
}

export async function getTopNews(limit = 20): Promise<NewsItem[]> {
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const { data } = await supabase
    .from('news')
    .select('*')
    .gte('published_at', since.toISOString())
    .order('published_at', { ascending: false })
    .order('hot_score', { ascending: false })
    .limit(limit);

  return (data || []).map((n) => ({
    title: n.title,
    content: n.content,
    source: n.source,
    url: n.url || '',
    publishedAt: new Date(n.published_at),
    hotScore: n.hot_score,
    category: n.category || 'general',
  }));
}
