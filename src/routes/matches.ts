import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

export const matchesRouter = Router();

matchesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, date } = req.query;

    let query = supabase.from('matches').select('*').ilike('competition', '%World Cup%');

    if (status && typeof status === 'string') {
      query = query.eq('status', status.toUpperCase());
    }

    if (date && typeof date === 'string') {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query = query.gte('match_time', start.toISOString()).lte('match_time', end.toISOString());
    }

    const { data, error } = await query.order('match_time', { ascending: false }).limit(50);

    if (error) throw error;

    const matches = (data || []).map((row) => ({
      id: row.id,
      externalId: row.external_id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeScore: row.home_score,
      awayScore: row.away_score,
      matchTime: row.match_time,
      status: row.status,
      competition: row.competition,
      venue: row.venue,
      referee: row.referee,
      statistics: row.statistics,
      events: row.events,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json(matches);
  } catch (err) {
    next(err);
  }
});
