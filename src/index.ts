import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { scriptsRouter } from './routes/scripts';
import { newsRouter } from './routes/news';
import { matchesRouter } from './routes/matches';
import { jobsRouter } from './routes/jobs';
import { errorHandler } from './middleware/errorHandler';
import { initScheduler } from './schedulers/cronJobs';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/scripts', scriptsRouter);
app.use('/api/news', newsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/jobs', jobsRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on https://gencontent-zpei.onrender.com`);
  initScheduler();
});

export default app;
