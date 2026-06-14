import { supabase } from '../lib/supabase';
import { generateScript } from './aiService';
import { fetchTodayMatches, fetchStandings, syncMatchesToDB } from './footballService';
import { fetchNewsFromFeeds, syncNewsToDB, getTopNews, type NewsItem } from './newsService';
import { rankNewsItems } from './hotScoreEngine';
import { buildMatchResultsSummary, formatSummaryForPrompt } from './matchSummaryService';

export type EditionType = 'MORNING' | 'EVENING' | 'MANUAL';

const SYSTEM_PROMPT = `You are the lead scriptwriter for a world-class FIFA World Cup 2026 daily news show — the broadcast standard of Sky Sports News meets ESPN FC meets BBC Sport.

ROLE
You write scripts that presenters read on camera. Every word must feel natural, confident, and authoritative when spoken aloud — not written. This is NOT an article. This is a performance.

VOICE & RHYTHM
- Write in presenter voice: "Welcome back", "Let's get into it", "Now, here's one that caught everyone's attention..."
- Vary sentence length. Short punchy sentences for impact. Longer flowing ones for narrative depth. Never the same rhythm twice in a row.
- Use active voice and present tense for current events. Past tense only for completed results.
- Be specific: name players, cite scorelines, reference exact moments. Vagueness kills broadcast energy.
- Build drama. Every story has a hook, a twist, and a payoff.
- End each section with a verbal bridge that pulls viewers into the next one.

TONE
Authoritative but warm. Excited but not hysterical. This is a premium show — not a local radio station.

HARD RULES
- Zero bullet points or numbered lists anywhere in the script
- Zero passive voice ("was scored by" → "scored")
- Zero robotic filler: "It is worth noting", "As mentioned", "In conclusion", "Moving on to our next topic"
- Zero stage directions, brackets, or meta-text
- Never start two consecutive sentences with the same word
- No repetition of the same phrase within 200 words

OUTPUT FORMAT
Pure script text only. Section headers exactly as instructed. Nothing else.
Total length: 1,500–2,000 words. Broadcast reading pace: ~9–12 minutes.

CRITICAL: You must complete ALL 9 sections before stopping. Never truncate mid-sentence or mid-section. Be concise — quality over quantity. Every section must be present and finished.`;

interface ScriptContext {
  editionType: EditionType;
  date: string;
  news: Awaited<ReturnType<typeof getTopNews>>;
  editorPicks: NewsItem[];
  todayMatches: Awaited<ReturnType<typeof fetchTodayMatches>>;
  standings: Awaited<ReturnType<typeof fetchStandings>>;
  previousRecap: string | null;
  matchSummary: ReturnType<typeof buildMatchResultsSummary>;
}

export interface GenerateScriptOptions {
  selectedNewsIds?: string[];
}

async function fetchPreviousRecap(): Promise<string | null> {
  const { data, error } = await supabase
    .from('scripts')
    .select('title, content, edition_type, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const content = data.content as string;
  const section2Match = content.match(
    /##\s*SECTION\s*2[^\n]*\n([\s\S]*?)(?=##\s*SECTION\s*3|$)/i,
  );

  const excerpt = section2Match
    ? section2Match[1].trim().slice(0, 600)
    : content.slice(0, 600);

  const editionType = data.edition_type as string;
  const editionLabel = editionType === 'MORNING' ? 'Morning Edition'
    : editionType === 'EVENING' ? 'Evening Edition'
    : 'Special Report';

  const dateStr = new Date(data.created_at as string).toLocaleDateString('en-GB', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'Europe/London',
  });

  return `Previous edition: ${editionLabel} — ${dateStr}\n${excerpt}`;
}

function buildPrompt(ctx: ScriptContext): string {
  const isEvening = ctx.editionType === 'EVENING';
  const isMorning = ctx.editionType === 'MORNING';

  const editionLabel = isMorning ? 'MORNING EDITION — 07:00 UK'
    : isEvening ? 'EVENING EDITION — 20:00 UK'
    : 'SPECIAL REPORT';

  const liveMatches    = ctx.todayMatches.filter((m) => m.status === 'LIVE');
  const topNews        = rankNewsItems(ctx.news).slice(0, 10);
  const editorPicks    = ctx.editorPicks;

  const matchSummaryBlock = formatSummaryForPrompt(ctx.matchSummary);

  const liveBlock = liveMatches.length
    ? liveMatches.map((m) => `  • ${m.homeTeam} vs ${m.awayTeam} [LIVE NOW]`).join('\n')
    : '  None currently.';

  const standingsBlock = ctx.standings.length
    ? ctx.standings.slice(0, 16).map((s) =>
        `  Group ${s.group} | #${s.rank} ${s.team} — ${s.points}pts  W${s.won} D${s.drawn} L${s.lost}  GF${s.goalsFor} GA${s.goalsAgainst}`,
      ).join('\n')
    : '  Not yet available.';

  const newsBlock = topNews.length
    ? topNews.map((n, i) => [
        `  [${i + 1}] ★ ${n.hotScore}/100  |  ${n.source}`,
        `  Headline: ${n.title}`,
        `  Detail: ${n.content.slice(0, 300).replace(/\n/g, ' ')}`,
      ].join('\n')).join('\n\n')
    : '  No news data available — draw on your World Cup 2026 knowledge.';

  const editorPicksBlock = editorPicks.length
    ? editorPicks.map((n, i) => [
        `  [PICK ${i + 1}] ★ ${n.hotScore}/100  |  ${n.source}`,
        `  Headline: ${n.title}`,
        `  Detail: ${n.content.slice(0, 400).replace(/\n/g, ' ')}`,
        n.url ? `  Source URL: ${n.url}` : '',
      ].join('\n')).join('\n\n')
    : '  No editor picks — use the 3 highest hot-score stories from TOP NEWS above.';

  const recapBlock = ctx.previousRecap
    ? `YES — previous edition content below. In SECTION 1, weave in 2–3 of the biggest stories as a natural "In Case You Missed It" handoff (4–6 sentences max, no list format):
${ctx.previousRecap}`
    : 'NO — this is the first edition. Skip the recap entirely.';

  return `=== WORLD CUP 2026 SCRIPT BRIEF ===
Edition : ${editionLabel}
Date    : ${ctx.date}

━━━ LIVE RIGHT NOW ━━━
${liveBlock}

━━━ MATCH RESULTS SUMMARY (use for SECTION 3) ━━━
${matchSummaryBlock}

━━━ GROUP STANDINGS (top 16) ━━━
${standingsBlock}

━━━ TOP NEWS STORIES (hot score ★/100, highest = most important) ━━━
${newsBlock}

━━━ EDITOR'S PICKS — MUST READ ALOUD IN SECTION 4 ━━━
${editorPicksBlock}

━━━ PREVIOUS EDITION RECAP ━━━
Include recap? ${recapBlock}

═══════════════════════════════════════
WRITE THE SCRIPT BELOW — 9 SECTIONS
Use these exact headers. Strict word targets.
═══════════════════════════════════════

## SECTION 1: OPENING
Open with EXACTLY this line (fill in the date): "Welcome to World Cup Diary — the hottest stories of ${ctx.date}, here's what's breaking:"
Then list exactly 3–4 of today's hottest headlines — each as a single standalone line, headline title only, NO explanation, NO detail. Just the raw headline.
Then one short bridge sentence into the show. ${ctx.previousRecap ? 'Then 2 sentences max recapping the previous edition.' : ''} Total section: under 80 words.

## SECTION 2: TOP WORLD CUP HEADLINES
~280 words. Deliver the full stories teased in Section 1, in the same order. One paragraph per story — hook, facts, significance. No filler.

## SECTION 3: MATCH RESULTS ROUNDUP
~250 words. Complete scoreboard summary for the presenter to read on air. Cover EVERY finished match from MATCH RESULTS SUMMARY — home team, away team, exact scoreline, venue if known. Mention live matches in progress with current score if any. If no results yet, preview upcoming fixtures with kick-off times. Fast, authoritative, broadcast-ready — like a sports desk results bulletin.

## SECTION 4: EDITOR'S NEWS DESK
~300 words. Read the EDITOR'S PICKS stories aloud as a news anchor. ${editorPicks.length ? `Cover all ${editorPicks.length} editor-selected stories — one flowing paragraph per pick.` : 'Pick the 3 most compelling stories from TOP NEWS and deliver them with broadcast energy.'} Attribute the source naturally ("According to ESPN...", "Reuters reports..."). Make each story feel hand-picked because it matters to World Cup fans.

## SECTION 5: MATCH OF THE DAY
~350 words. The most important match. Scene-setting, key moments, turning point, standout player, tournament implications. Make the listener feel like they were there.

## SECTION 6: TEAMS & PLAYERS SPOTLIGHT
~200 words. 2 player/team stories. One sharp paragraph each — specific names, specific moments.

## SECTION 7: AROUND THE TOURNAMENT
~150 words. 1 human-interest story. Lighter tone — the show's emotional breath before the finale.

## SECTION 8: WORLD CUP STORY OF THE DAY
~250 words. One great moment from World Cup history. Connect it naturally to something happening in 2026. This is the signature segment — make it memorable.

## SECTION 9: CLOSING
~90 words. Warm, personal, genuine sign-off. Tease the next edition. End on one great line.
The very last sentence must be a standalone "Thank you" — a broadcaster's farewell.

═══════════════════════════════════════
NOW WRITE. Headers exactly as above. No stage directions. No brackets. Pure script.
═══════════════════════════════════════`;
}

export async function generateNewsScript(
  editionType: EditionType,
  options: GenerateScriptOptions = {},
): Promise<string> {
  const jobId = await createJob(editionType);

  try {
    await updateJob(jobId, 'RUNNING');

    const [todayMatches, standings, freshNews, previousRecap] = await Promise.allSettled([
      fetchTodayMatches(),
      fetchStandings(),
      fetchNewsFromFeeds(),
      fetchPreviousRecap(),
    ]);

    const matches = todayMatches.status === 'fulfilled' ? todayMatches.value : [];
    const standingsData = standings.status === 'fulfilled' ? standings.value : [];
    const newsData = freshNews.status === 'fulfilled' ? freshNews.value : [];
    const recap = previousRecap.status === 'fulfilled' ? previousRecap.value : null;

    Promise.allSettled([
      syncMatchesToDB(matches),
      syncNewsToDB(newsData),
    ]).catch(console.error);

    const topNews = newsData.length > 0 ? newsData : await getTopNews(20);

    let editorPicks: NewsItem[] = [];
    if (options.selectedNewsIds?.length) {
      const { data: picked } = await supabase
        .from('news')
        .select('*')
        .in('id', options.selectedNewsIds);

      editorPicks = (picked || []).map((n) => ({
        title: n.title,
        content: n.content,
        source: n.source,
        url: n.url || '',
        publishedAt: new Date(n.published_at),
        hotScore: n.hot_score,
        category: n.category || 'general',
      }));
    }

    const matchSummary = buildMatchResultsSummary(matches);

    const ctx: ScriptContext = {
      editionType,
      date: new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Europe/London',
      }),
      news: topNews,
      editorPicks,
      todayMatches: matches,
      standings: standingsData,
      previousRecap: recap,
      matchSummary,
    };

    const prompt = buildPrompt(ctx);
    const result = await generateScript(prompt, SYSTEM_PROMPT);

    const wordCount = result.content.split(/\s+/).filter(Boolean).length;
    const title = buildTitle(editionType, new Date());

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: existingVersion } = await supabase
      .from('scripts')
      .select('*', { count: 'exact', head: true })
      .eq('edition_type', editionType)
      .gte('created_at', todayStart.toISOString());

    const now = new Date().toISOString();
    const { data: script, error: insertError } = await supabase
      .from('scripts')
      .insert({
        id: crypto.randomUUID(),
        title,
        edition_type: editionType,
        content: result.content,
        word_count: wordCount,
        version: (existingVersion ?? 0) + 1,
        status: 'PUBLISHED',
        ai_provider: result.provider,
        ai_model: result.model,
        metadata: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          matchCount: matches.length,
          newsCount: topNews.length,
          editorPickCount: editorPicks.length,
          hasPreviousRecap: recap !== null,
        },
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (insertError || !script) throw new Error(insertError?.message ?? 'Failed to save script');

    await updateJob(jobId, 'COMPLETED');
    return (script as Record<string, unknown>).id as string;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, 'FAILED', message);
    throw err;
  }
}

function buildTitle(edition: EditionType, date: Date): string {
  const dateStr = date.toLocaleDateString('en-GB', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Europe/London',
  });
  const labels: Record<EditionType, string> = {
    MORNING: 'Morning Edition',
    EVENING: 'Evening Edition',
    MANUAL: 'Special Report',
  };
  return `World Cup 2026 — ${labels[edition]} | ${dateStr}`;
}

async function createJob(editionType: EditionType): Promise<string> {
  const jobTypeMap: Record<EditionType, string> = {
    MORNING: 'MORNING_EDITION',
    EVENING: 'EVENING_EDITION',
    MANUAL: 'MANUAL_GENERATION',
  };
  const { data, error } = await supabase
    .from('jobs')
    .insert({ id: crypto.randomUUID(), job_type: jobTypeMap[editionType], status: 'PENDING' })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create job');
  return (data as Record<string, unknown>).id as string;
}

async function updateJob(
  id: string,
  status: 'RUNNING' | 'COMPLETED' | 'FAILED',
  errorMessage?: string,
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'RUNNING') updates.started_at = new Date().toISOString();
  if (status === 'COMPLETED' || status === 'FAILED') updates.finished_at = new Date().toISOString();
  if (errorMessage) updates.error_message = errorMessage;

  await supabase.from('jobs').update(updates).eq('id', id);
}
