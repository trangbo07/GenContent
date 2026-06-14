interface ScoringInput {
  title: string;
  content: string;
  publishedAt: Date;
  teamRelevance?: string[];
}

const HIGH_IMPACT_PLAYERS = [
  'mbappe', 'messi', 'ronaldo', 'neymar', 'vinicius', 'bellingham',
  'haaland', 'saka', 'pedri', 'rodri', 'salah', 'osimhen',
];

const HIGH_IMPACT_TERMS = [
  'hat-trick', 'hat trick', 'world record', 'golden boot', 'golden ball',
  'final', 'semi-final', 'quarter-final', 'penalty shootout',
  'injury', 'suspended', 'banned', 'disqualified',
  'goal of the tournament', 'save of the tournament',
];

const MODERATE_TERMS = [
  'squad', 'lineup', 'tactics', 'press conference', 'training',
  'preview', 'prediction', 'analysis',
];

export function calculateHotScore(input: ScoringInput): number {
  const text = `${input.title} ${input.content}`.toLowerCase();
  let score = 30; // base

  // Recency scoring (0-20 points)
  const ageHours = (Date.now() - input.publishedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours < 1) score += 20;
  else if (ageHours < 3) score += 15;
  else if (ageHours < 6) score += 10;
  else if (ageHours < 12) score += 5;
  else if (ageHours > 24) score -= 10;

  // High-impact player mentions (up to 20 points)
  const playerMentions = HIGH_IMPACT_PLAYERS.filter((p) => text.includes(p));
  score += Math.min(playerMentions.length * 7, 20);

  // High-impact terms (up to 25 points)
  const highImpactMatches = HIGH_IMPACT_TERMS.filter((t) => text.includes(t));
  score += Math.min(highImpactMatches.length * 10, 25);

  // Moderate terms (up to 5 points)
  const moderateMatches = MODERATE_TERMS.filter((t) => text.includes(t));
  score += Math.min(moderateMatches.length * 2, 5);

  // Football / World Cup relevance boost
  const footballTerms = [
    'world cup', 'fifa', '2026', 'soccer', 'football', 'premier league',
    'champions league', 'la liga', 'bundesliga', 'serie a', 'mls',
    'qualifier', 'knockout', 'penalty', 'striker', 'midfielder',
  ];
  const footballHits = footballTerms.filter((t) => text.includes(t));
  score += Math.min(footballHits.length * 4, 15);

  if (text.includes('world cup') || text.includes('fifa') || text.includes('2026')) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

export interface ScoredNewsItem {
  title: string;
  content: string;
  source: string;
  hotScore: number;
  category: string;
}

export function rankNewsItems<T extends ScoredNewsItem>(items: T[]): T[] {
  return [...items].sort((a, b) => b.hotScore - a.hotScore);
}
