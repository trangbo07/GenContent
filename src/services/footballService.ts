import axios from 'axios';
import { supabase } from '../lib/supabase';

const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-apisports-key': process.env.APISPORTS_KEY || '',
  },
});

const LEAGUE_ID = parseInt(process.env.WORLD_CUP_LEAGUE_ID || '1');
const SEASON = parseInt(process.env.WORLD_CUP_SEASON || '2026');

export interface MatchData {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  matchTime: Date;
  status: string;
  competition: string;
  venue: string;
  statistics: Record<string, unknown>;
  events: Record<string, unknown>[];
}

export interface StandingsData {
  group: string;
  rank: number;
  team: string;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

function mapStatus(apiStatus: string): string {
  const map: Record<string, string> = {
    'NS': 'SCHEDULED',
    '1H': 'LIVE',
    'HT': 'LIVE',
    '2H': 'LIVE',
    'ET': 'LIVE',
    'PEN': 'LIVE',
    'FT': 'FINISHED',
    'AET': 'FINISHED',
    'PEN_FT': 'FINISHED',
    'PST': 'POSTPONED',
    'CANC': 'CANCELLED',
    'ABD': 'CANCELLED',
  };
  return map[apiStatus] || 'SCHEDULED';
}

export async function fetchTodayMatches(): Promise<MatchData[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await api.get('/fixtures', {
    params: { league: LEAGUE_ID, season: SEASON, date: today },
  });

  return (data.response || []).map((f: Record<string, unknown>) => {
    const fixture = f.fixture as Record<string, unknown>;
    const teams = f.teams as Record<string, { name: string }>;
    const goals = f.goals as { home: number | null; away: number | null };
    const fixtureStatus = fixture.status as { short: string };
    const venue = fixture.venue as { name: string };

    return {
      externalId: String(fixture.id),
      homeTeam: teams.home.name,
      awayTeam: teams.away.name,
      homeScore: goals.home,
      awayScore: goals.away,
      matchTime: new Date(fixture.date as string),
      status: mapStatus(fixtureStatus.short),
      competition: 'FIFA World Cup 2026',
      venue: venue?.name || '',
      statistics: {},
      events: [],
    };
  });
}

export async function fetchMatchStatistics(fixtureId: string): Promise<Record<string, unknown>> {
  const { data } = await api.get('/fixtures/statistics', {
    params: { fixture: fixtureId },
  });
  return data.response || {};
}

export async function fetchStandings(): Promise<StandingsData[]> {
  const { data } = await api.get('/standings', {
    params: { league: LEAGUE_ID, season: SEASON },
  });

  const standings: StandingsData[] = [];
  const leagues = data.response || [];

  for (const league of leagues) {
    const leagueData = league.league as { standings: unknown[][] };
    for (const group of leagueData.standings || []) {
      for (const entry of group) {
        const e = entry as Record<string, unknown>;
        const team = e.team as { name: string };
        const all = e.all as { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
        standings.push({
          group: String(e.group || 'A'),
          rank: e.rank as number,
          team: team.name,
          points: e.points as number,
          played: all.played,
          won: all.win,
          drawn: all.draw,
          lost: all.lose,
          goalsFor: all.goals.for,
          goalsAgainst: all.goals.against,
        });
      }
    }
  }
  return standings;
}

export async function fetchUpcomingFixtures(days = 3): Promise<MatchData[]> {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + days);

  const { data } = await api.get('/fixtures', {
    params: {
      league: LEAGUE_ID,
      season: SEASON,
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
      status: 'NS',
    },
  });

  return (data.response || []).map((f: Record<string, unknown>) => {
    const fixture = f.fixture as Record<string, unknown>;
    const teams = f.teams as Record<string, { name: string }>;
    const goals = f.goals as { home: number | null; away: number | null };
    const fixtureStatus = fixture.status as { short: string };
    const venue = fixture.venue as { name: string };

    return {
      externalId: String(fixture.id),
      homeTeam: teams.home.name,
      awayTeam: teams.away.name,
      homeScore: goals.home,
      awayScore: goals.away,
      matchTime: new Date(fixture.date as string),
      status: mapStatus(fixtureStatus.short),
      competition: 'FIFA World Cup 2026',
      venue: venue?.name || '',
      statistics: {},
      events: [],
    };
  });
}

export async function syncMatchesToDB(matches: MatchData[]): Promise<void> {
  for (const match of matches) {
    await supabase.from('matches').upsert(
      {
        external_id: match.externalId,
        home_team: match.homeTeam,
        away_team: match.awayTeam,
        home_score: match.homeScore,
        away_score: match.awayScore,
        match_time: match.matchTime.toISOString(),
        status: match.status,
        competition: match.competition,
        venue: match.venue,
        statistics: match.statistics,
        events: match.events,
      },
      { onConflict: 'external_id' },
    );
  }
}
