import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { refreshNewsFromFeeds } from '../services/newsService';

export const newsRouter = Router();

newsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, since, limit = '50', lang } = req.query;

    let query = supabase.from('news').select('*');

    if (category && typeof category === 'string') {
      query = query.eq('category', category);
    }

    if (lang && typeof lang === 'string') {
      query = query.eq('lang', lang);
    }

    if (since && typeof since === 'string') {
      query = query.gte('published_at', new Date(since).toISOString());
    } else {
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);
      query = query.gte('published_at', yesterday.toISOString());
    }

    const { data, error } = await query
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
      lang: row.lang || 'en',
      publishedAt: row.published_at,
      createdAt: row.created_at,
    }));

    res.json(news);
  } catch (err) {
    next(err);
  }
});

// POST /api/news/refresh  — fetch fresh news from all RSS feeds and sync to DB
newsRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await refreshNewsFromFeeds();
    res.json({ refreshed: items.length, message: 'News refreshed successfully' });
  } catch (err) {
    next(err);
  }
});
