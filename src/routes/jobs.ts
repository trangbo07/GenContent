import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

export const jobsRouter = Router();

jobsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const jobs = (data || []).map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));

    res.json(jobs);
  } catch (err) {
    next(err);
  }
});
