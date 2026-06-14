import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { fetchNewsFromFeeds, syncNewsToDB } from '../services/newsService';

export const newsRouter = Router();

newsRouter.post('/sync', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const fresh = await fetchNewsFromFeeds();
    await syncNewsToDB(fresh);

    const since = new Date();
    since.setHours(since.getHours() - 24);

    const { data, error } = await supabase
      .from('news')
      .select('*')
      .gte('published_at', since.toISOString())
      .order('published_at', { ascending: false })
      .order('hot_score', { ascending: false })
      .limit(30);

    if (error) throw error;

    const news = (data || []).map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      url: row.url,
      hotScore: row.hot_score,
      category: row.category,
      publishedAt: row.published_at,
      createdAt: row.created_at,
    }));

    res.json({ synced: fresh.length, news });
  } catch (err) {
    next(err);
  }
});

newsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, since, limit = '20' } = req.query;

    let query = supabase.from('news').select('*');

    if (category && typeof category === 'string') {
      query = query.eq('category', category);
    }

    if (since && typeof since === 'string') {
      query = query.gte('published_at', new Date(since).toISOString());
    } else {
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);
      query = query.gte('published_at', yesterday.toISOString());
    }

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .order('hot_score', { ascending: false })
      .limit(parseInt(String(limit)));

    if (error) throw error;

    const news = (data || []).map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      url: row.url,
      hotScore: row.hot_score,
      category: row.category,
      publishedAt: row.published_at,
      createdAt: row.created_at,
    }));

    res.json(news);
  } catch (err) {
    next(err);
  }
});
