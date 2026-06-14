import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

export const newsRouter = Router();

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
