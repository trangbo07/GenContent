import type { MatchData } from './footballService';

export interface MatchResultEntry {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string;
  matchTime: string;
  status: string;
}

export interface MatchResultsSummary {
  date: string;
  finished: MatchResultEntry[];
  live: MatchResultEntry[];
  upcoming: MatchResultEntry[];
  totalGoals: number;
  finishedCount: number;
  liveCount: number;
  headline: string;
}

function toEntry(m: MatchData): MatchResultEntry {
  return {
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    venue: m.venue,
    matchTime: m.matchTime.toISOString(),
    status: m.status,
  };
}

function formatScoreline(m: MatchResultEntry): string {
  if (m.homeScore === null || m.awayScore === null) {
    return `${m.homeTeam} vs ${m.awayTeam}`;
  }
  return `${m.homeTeam} ${m.homeScore}–${m.awayScore} ${m.awayTeam}`;
}

export function buildMatchResultsSummary(matches: MatchData[]): MatchResultsSummary {
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/London',
  });

  const finished = matches.filter((m) => m.status === 'FINISHED').map(toEntry);
  const live = matches.filter((m) => m.status === 'LIVE').map(toEntry);
  const upcoming = matches.filter((m) => m.status === 'SCHEDULED').map(toEntry);

  const totalGoals = finished.reduce(
    (sum, m) => sum + (m.homeScore ?? 0) + (m.awayScore ?? 0),
    0,
  );

  let headline: string;
  if (finished.length === 0 && live.length === 0) {
    headline = upcoming.length
      ? `${upcoming.length} match${upcoming.length > 1 ? 'es' : ''} scheduled today — no final results yet.`
      : 'No World Cup matches scheduled for today.';
  } else if (live.length > 0 && finished.length === 0) {
    headline = `${live.length} match${live.length > 1 ? 'es' : ''} live right now.`;
  } else {
    headline = `${finished.length} result${finished.length > 1 ? 's' : ''} in — ${totalGoals} goal${totalGoals !== 1 ? 's' : ''} scored today.`;
    if (live.length > 0) {
      headline += ` ${live.length} still live.`;
    }
  }

  return {
    date,
    finished,
    live,
    upcoming,
    totalGoals,
    finishedCount: finished.length,
    liveCount: live.length,
    headline,
  };
}

export function formatSummaryForPrompt(summary: MatchResultsSummary): string {
  const lines: string[] = [
    `Date: ${summary.date}`,
    `Overview: ${summary.headline}`,
    '',
  ];

  if (summary.live.length) {
    lines.push('━━━ LIVE NOW ━━━');
    for (const m of summary.live) {
      lines.push(`  ${formatScoreline(m)} [LIVE]${m.venue ? ` — ${m.venue}` : ''}`);
    }
    lines.push('');
  }

  if (summary.finished.length) {
    lines.push('━━━ FULL-TIME RESULTS ━━━');
    for (const m of summary.finished) {
      const time = new Date(m.matchTime).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London',
      });
      lines.push(`  ${formatScoreline(m)} (${time} UK)${m.venue ? ` — ${m.venue}` : ''}`);
    }
    lines.push(`  Total goals today: ${summary.totalGoals}`);
    lines.push('');
  }

  if (summary.upcoming.length) {
    lines.push('━━━ STILL TO COME TODAY ━━━');
    for (const m of summary.upcoming.slice(0, 6)) {
      const time = new Date(m.matchTime).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London',
      });
      lines.push(`  ${m.homeTeam} vs ${m.awayTeam} — ${time} UK${m.venue ? `, ${m.venue}` : ''}`);
    }
  }

  if (!summary.finished.length && !summary.live.length && !summary.upcoming.length) {
    lines.push('  No match data available for today.');
  }

  return lines.join('\n');
}
