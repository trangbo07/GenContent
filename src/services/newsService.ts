import Parser from 'rss-parser';
import { supabase } from '../lib/supabase';
import { calculateHotScore } from './hotScoreEngine';

const FEED_TIMEOUT_MS = 8000;

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  customFields: { item: ['media:content', 'media:thumbnail'] },
});

const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',          source: 'BBC Sport' },
  { url: 'https://www.theguardian.com/football/rss',                  source: 'The Guardian' },
  { url: 'https://www.skysports.com/rss/12040',                       source: 'Sky Sports' },
  { url: 'https://www.espn.com/espn/rss/soccer/news',                 source: 'ESPN FC' },
  { url: 'https://www.mirror.co.uk/sport/football/rss.xml',           source: 'Mirror Football' },
  { url: 'https://talksport.com/football/feed/',                      source: 'talkSPORT' },
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

export async function fetchNewsFromFeeds(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const result = await withTimeout(parser.parseURL(feed.url), FEED_TIMEOUT_MS);
      const feedItems: NewsItem[] = [];

      for (const item of result.items.slice(0, 10)) {
        const title = item.title || '';
        const content = item.contentSnippet || item.content || '';
        if (!title) continue;

        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
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

      return feedItems;
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      console.warn(`[RSS] Failed: ${RSS_FEEDS[i].source} — ${r.reason?.message ?? r.reason}`);
    }
  }

  return items.sort((a, b) => b.hotScore - a.hotScore);
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
