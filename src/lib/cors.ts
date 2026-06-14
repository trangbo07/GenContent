import type { CorsOptions } from 'cors';

/**
 * Parse allowed CORS origins from env.
 * FRONTEND_URL supports comma-separated values:
 *   FRONTEND_URL=http://localhost:5173,https://your-app.vercel.app
 */
function getAllowedOrigins(): string[] {
  const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;

  const allowed = getAllowedOrigins();
  if (allowed.includes('*') || allowed.includes(origin)) return true;

  if (process.env.CORS_ALLOW_VERCEL === 'true' && /\.vercel\.app$/i.test(origin)) {
    return true;
  }

  if (process.env.CORS_ALLOW_RENDER === 'true' && /\.onrender\.com$/i.test(origin)) {
    return true;
  }

  return false;
}

export function corsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Blocked origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
  };
}
