import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { supabase } from '../lib/supabase';
import { generateNewsScript, generateCustomScript, CustomSectionNews } from '../services/scriptGenerator';
import { exportToDocx, exportToPdf } from '../services/exportService';
import { findImagesForScript, createImagesZip, type SectionImages } from '../services/imageService';
import { AppError } from '../middleware/errorHandler';

async function translateChunk(text: string): Promise<string> {
  const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
    params: { client: 'gtx', sl: 'en', tl: 'vi', dt: 't', q: text },
  });
  return (data[0] as string[][]).map((item) => item[0]).join('');
}

async function translateToVietnamese(content: string): Promise<string> {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let buf = '';

  for (const line of lines) {
    if (buf.length + line.length > 3000 && buf.length > 0) {
      chunks.push(buf);
      buf = line;
    } else {
      buf += (buf ? '\n' : '') + line;
    }
  }
  if (buf) chunks.push(buf);

  const results: string[] = [];
  for (const chunk of chunks) {
    results.push(await translateChunk(chunk));
  }
  return results.join('\n');
}

export const scriptsRouter = Router();

function mapScript(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    editionType: row.edition_type,
    content: row.content,
    wordCount: row.word_count,
    version: row.version,
    status: row.status,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/scripts
scriptsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { edition, date, search, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(String(page));
    const limitNum = parseInt(String(limit));
    const skip = (pageNum - 1) * limitNum;

    let query = supabase
      .from('scripts')
      .select('id, title, edition_type, word_count, version, status, ai_provider, created_at, updated_at');
    let countQuery = supabase.from('scripts').select('*', { count: 'exact', head: true });

    if (edition && typeof edition === 'string') {
      query = query.eq('edition_type', edition.toUpperCase());
      countQuery = countQuery.eq('edition_type', edition.toUpperCase());
    }

    if (date && typeof date === 'string') {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
      countQuery = countQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
    }

    if (search && typeof search === 'string') {
      query = query.ilike('title', `%${search}%`);
      countQuery = countQuery.ilike('title', `%${search}%`);
    }

    query = query.order('created_at', { ascending: false }).range(skip, skip + limitNum - 1);

    const [{ data: rows, error }, { count, error: countError }] = await Promise.all([query, countQuery]);

    if (error) throw new AppError(error.message, 500);
    if (countError) throw new AppError(countError.message, 500);

    const scripts = (rows || []).map((r) => mapScript(r as Record<string, unknown>));
    res.json({ scripts, total: count ?? 0, page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

// GET /api/scripts/:id
scriptsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('scripts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) throw new AppError('Script not found', 404);
    res.json(mapScript(data as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// GET /api/scripts/:id/export?format=docx|pdf
scriptsRouter.get('/:id/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { format = 'docx' } = req.query;
    const { data, error } = await supabase
      .from('scripts')
      .select('title, content')
      .eq('id', req.params.id)
      .single();
    if (error || !data) throw new AppError('Script not found', 404);

    const row = data as Record<string, unknown>;
    const title = row.title as string;
    const content = row.content as string;

    const safeFilename = title
      .replace(/[^a-z0-9\s\-_]/gi, '')
      .trim()
      .slice(0, 80)
      .replace(/\s+/g, '_');

    if (format === 'pdf') {
      const buffer = await exportToPdf(title, content);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
      res.send(buffer);
    } else {
      const buffer = await exportToDocx(title, content);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.docx"`);
      res.send(buffer);
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /api/scripts/:id
scriptsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      title: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
    });
    const { title, content } = schema.parse(req.body);

    const { data: existing, error: fetchError } = await supabase
      .from('scripts')
      .select('word_count')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !existing) throw new AppError('Script not found', 404);

    const wordCount = content
      ? content.split(/\s+/).filter(Boolean).length
      : (existing as Record<string, unknown>).word_count as number;

    const updates: Record<string, unknown> = {};
    if (title) updates.title = title;
    if (content) { updates.content = content; updates.word_count = wordCount; }

    const { data, error } = await supabase
      .from('scripts')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) throw new AppError('Update failed', 500);

    res.json(mapScript(data as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// POST /api/scripts/generate
scriptsRouter.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      editionType: z.enum(['MORNING', 'EVENING', 'MANUAL']).default('MANUAL'),
    });
    const { editionType } = schema.parse(req.body);
    res.json({ message: 'Script generation started', editionType });
    generateNewsScript(editionType).catch((err) => console.error('[Generate] Error:', err));
  } catch (err) {
    next(err);
  }
});

// POST /api/scripts/generate/sync
scriptsRouter.post('/generate/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      editionType: z.enum(['MORNING', 'EVENING', 'MANUAL']).default('MANUAL'),
    });
    const { editionType } = schema.parse(req.body);
    const scriptId = await generateNewsScript(editionType);
    const { data, error } = await supabase.from('scripts').select('*').eq('id', scriptId).single();
    if (error || !data) throw new AppError('Script not found after generation', 500);
    res.json(mapScript(data as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// POST /api/scripts/generate/custom
scriptsRouter.post('/generate/custom', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const selectedNewsItem = z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      source: z.string(),
      lang: z.string().optional(),
    });
    const schema = z.object({
      editionType: z.enum(['MORNING', 'EVENING', 'MANUAL']).default('MANUAL'),
      headlines: z.array(selectedNewsItem).min(1).max(4),
      matchResults: z.array(selectedNewsItem),
      matchOfDay: selectedNewsItem,
      includeSection5: z.boolean().default(true),
    });
    const { editionType, headlines, matchResults, matchOfDay, includeSection5 } = schema.parse(req.body);
    const sections: CustomSectionNews = { headlines, matchResults, matchOfDay, includeSection5 };
    const scriptId = await generateCustomScript(editionType, sections);
    const { data, error } = await supabase.from('scripts').select('*').eq('id', scriptId).single();
    if (error || !data) throw new AppError('Script not found after generation', 500);
    res.json(mapScript(data as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// POST /api/scripts/regenerate
scriptsRouter.post('/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ id: z.string() });
    const { id } = schema.parse(req.body);

    const { data: existing, error } = await supabase
      .from('scripts')
      .select('edition_type')
      .eq('id', id)
      .single();
    if (error || !existing) throw new AppError('Script not found', 404);

    const scriptId = await generateNewsScript(
      (existing as Record<string, unknown>).edition_type as 'MORNING' | 'EVENING' | 'MANUAL',
    );
    const { data, error: fetchError } = await supabase.from('scripts').select('*').eq('id', scriptId).single();
    if (fetchError || !data) throw new AppError('Script not found after regeneration', 500);
    res.json(mapScript(data as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// POST /api/scripts/:id/find-images
scriptsRouter.post('/:id/find-images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('scripts')
      .select('content')
      .eq('id', req.params.id)
      .single();
    if (error || !data) throw new AppError('Script not found', 404);

    const sections = await findImagesForScript((data as Record<string, unknown>).content as string);
    const total = sections.reduce((sum, s) => sum + s.items.filter((i) => i.imageUrl).length, 0);
    res.json({ sections, total });
  } catch (err) {
    next(err);
  }
});

// POST /api/scripts/:id/download-images  — download all images as ZIP
scriptsRouter.post('/:id/download-images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sections } = req.body as { sections: SectionImages[] };
    if (!sections || !Array.isArray(sections)) throw new AppError('sections required', 400);

    const zipBuffer = await createImagesZip(sections);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="images_${req.params.id}.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    next(err);
  }
});

// GET /api/scripts/:id/translate
scriptsRouter.get('/:id/translate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('scripts')
      .select('content, metadata')
      .eq('id', req.params.id)
      .single();
    if (error || !data) throw new AppError('Script not found', 404);

    const row = data as Record<string, unknown>;
    const meta = (row.metadata as Record<string, unknown>) || {};

    if (meta.contentVi) {
      return res.json({ contentVi: meta.contentVi });
    }

    const contentVi = await translateToVietnamese(row.content as string);

    await supabase
      .from('scripts')
      .update({ metadata: { ...meta, contentVi } })
      .eq('id', req.params.id);

    res.json({ contentVi });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scripts/:id
scriptsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('scripts')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !existing) throw new AppError('Script not found', 404);

    const { error } = await supabase.from('scripts').delete().eq('id', req.params.id);
    if (error) throw new AppError('Delete failed', 500);
    res.json({ message: 'Script deleted' });
  } catch (err) {
    next(err);
  }
});
