import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  GRIDSTREAM_PLAYERS_MOCK_DATA,
  type GridstreamPlayerGamelogPage,
  type GridstreamPlayerProfile,
  fetchGridstreamPlayerGamelogPage,
  fetchGridstreamPlayerProfile,
  fetchGridstreamPlayerSplits,
  findGridstreamPlayerByRouteId,
  formatGridstreamDraftLabel,
  formatGridstreamSeasonRange,
  resolveGridstreamApiBase,
} from '@atlas/sdk/gridstream';
import PlayerStatsTabs from './PlayerStatsTabs';
import ContractDetails from './ContractDetails';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);
const EMPTY_SPLIT_AGG = {
  games: 0,
  passYds: 0,
  passTds: 0,
  passFirstDowns: 0,
  rushYds: 0,
  rushTds: 0,
  rushFirstDowns: 0,
  recYds: 0,
  recTds: 0,
  recFirstDowns: 0,
  fumbles: 0,
  fumblesLost: 0,
  forcedFumbles: 0,
  ppr: 0,
  defTackles: 0,
  defSacks: 0,
  defQbHits: 0,
  defPd: 0,
  defInts: 0,
  defIntTds: 0,
  defTds: 0,
};
const EMPTY_SPLITS = {
  home: { ...EMPTY_SPLIT_AGG },
  away: { ...EMPTY_SPLIT_AGG },
  regular: { ...EMPTY_SPLIT_AGG },
  postseason: { ...EMPTY_SPLIT_AGG },
  grass: { ...EMPTY_SPLIT_AGG },
  turf: { ...EMPTY_SPLIT_AGG },
  wins: { ...EMPTY_SPLIT_AGG },
  losses: { ...EMPTY_SPLIT_AGG },
  division: { ...EMPTY_SPLIT_AGG },
  nondivision: { ...EMPTY_SPLIT_AGG },
};
const EMPTY_GAMELOG: GridstreamPlayerGamelogPage = {
  items: [],
  count: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  next: null,
  previous: null,
};

interface GridstreamPlayerDetailPageProps {
  params: Promise<{ playerId: string }> | { playerId: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFallbackProfile(routeId: string): GridstreamPlayerProfile | null {
  const player = findGridstreamPlayerByRouteId(GRIDSTREAM_PLAYERS_MOCK_DATA, routeId);
  if (!player) return null;
  return {
    ...player,
    isActive: player.rosterStatus.toLowerCase() !== 'free agent',
  };
}

function maddenOvrTier(ovr: number): 'mythic' | 'elite' | 'good' | 'average' | 'below' | 'poor' {
  if (ovr >= 95) return 'mythic';
  if (ovr >= 88) return 'elite';
  if (ovr >= 78) return 'good';
  if (ovr >= 68) return 'average';
  if (ovr >= 55) return 'below';
  return 'poor';
}

function formatHeightWeight(height?: string, weight?: number | null): string {
  const parts = [height, weight != null ? `${weight} lb` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '—';
}

function formatSocialPlatformLabel(platform: string | null | undefined): string {
  const map: Record<string, string> = {
    twitter: 'Twitter/X',
    x: 'Twitter/X',
    instagram: 'Instagram',
    facebook: 'Facebook',
    youtube: 'YouTube',
    tiktok: 'TikTok',
  };
  if (!platform) return 'Social';
  return map[platform.toLowerCase()] ?? platform;
}

const CONF_ABBR: Record<string, string> = {
  'southeastern conference': 'SEC',
  'atlantic coast conference': 'ACC',
  'big ten conference': 'Big Ten',
  'big 12 conference': 'Big 12',
  'pac-12 conference': 'Pac-12',
  'pac-10 conference': 'Pac-10',
  'american athletic conference': 'AAC',
  'mountain west conference': 'MWC',
  'sun belt conference': 'Sun Belt',
  'conference usa': 'CUSA',
  'mid-american conference': 'MAC',
  'big east conference': 'Big East',
  'western athletic conference': 'WAC',
  'southern conference': 'SoCon',
  'ivy league': 'Ivy',
  'missouri valley conference': 'MVC',
  'ohio valley conference': 'OVC',
  'big west conference': 'Big West',
  'colonial athletic association': 'CAA',
  'southland conference': 'Southland',
};

function abbreviateConference(conf: string | null | undefined): string | null {
  if (!conf) return null;
  return CONF_ABBR[conf.toLowerCase()] ?? conf;
}

// School-name → conference abbreviation for common programs. Used when the
// DB college_history table doesn't have conference data for a given school.
const SCHOOL_CONF: Record<string, string> = {
  // SEC
  alabama: 'SEC',
  lsu: 'SEC',
  georgia: 'SEC',
  florida: 'SEC',
  auburn: 'SEC',
  tennessee: 'SEC',
  'mississippi state': 'SEC',
  'ole miss': 'SEC',
  'south carolina': 'SEC',
  kentucky: 'SEC',
  vanderbilt: 'SEC',
  arkansas: 'SEC',
  missouri: 'SEC',
  texas: 'SEC',
  oklahoma: 'SEC',
  'texas a&m': 'SEC',
  // Big Ten
  'ohio state': 'Big Ten',
  michigan: 'Big Ten',
  'penn state': 'Big Ten',
  'michigan state': 'Big Ten',
  wisconsin: 'Big Ten',
  iowa: 'Big Ten',
  minnesota: 'Big Ten',
  nebraska: 'Big Ten',
  illinois: 'Big Ten',
  indiana: 'Big Ten',
  purdue: 'Big Ten',
  rutgers: 'Big Ten',
  maryland: 'Big Ten',
  northwestern: 'Big Ten',
  ucla: 'Big Ten',
  usc: 'Big Ten',
  washington: 'Big Ten',
  oregon: 'Big Ten',
  // ACC
  clemson: 'ACC',
  'florida state': 'ACC',
  miami: 'ACC',
  'north carolina': 'ACC',
  'nc state': 'ACC',
  'virginia tech': 'ACC',
  virginia: 'ACC',
  'wake forest': 'ACC',
  duke: 'ACC',
  'boston college': 'ACC',
  syracuse: 'ACC',
  pittsburgh: 'ACC',
  'georgia tech': 'ACC',
  louisville: 'ACC',
  cal: 'ACC',
  stanford: 'ACC',
  smu: 'ACC',
  // Big 12 (current + recent)
  'oklahoma state': 'Big 12',
  'kansas state': 'Big 12',
  kansas: 'Big 12',
  baylor: 'Big 12',
  tcu: 'Big 12',
  'texas tech': 'Big 12',
  'iowa state': 'Big 12',
  'west virginia': 'Big 12',
  cincinnati: 'Big 12',
  ucf: 'Big 12',
  houston: 'Big 12',
  byu: 'Big 12',
  'arizona state': 'Big 12',
  arizona: 'Big 12',
  utah: 'Big 12',
  colorado: 'Big 12',
  // Pac-12 (pre-2024 era)
  'washington state': 'Pac-12',
  'oregon state': 'Pac-12',
  // MWC
  'boise state': 'MWC',
  'fresno state': 'MWC',
  nevada: 'MWC',
  'utah state': 'MWC',
  wyoming: 'MWC',
  'san diego state': 'MWC',
  'air force': 'MWC',
  unlv: 'MWC',
  'colorado state': 'MWC',
  // AAC
  memphis: 'AAC',
  tulsa: 'AAC',
  tulane: 'AAC',
  // Independents / others
  'notre dame': 'Ind.',
  army: 'Ind.',
  navy: 'Ind.',
  liberty: 'CUSA',
  'james madison': 'Sun Belt',
};

function inferConference(school: string | null | undefined): string | null {
  if (!school) return null;
  return SCHOOL_CONF[school.toLowerCase()] ?? null;
}

/** Build a college list for display when the DB college_history table is empty.
 *  Falls back to splitting the raw `college` field on semicolons. */
function buildCollegeEntries(
  profile: GridstreamPlayerProfile
): Array<{ school: string; conf: string | null }> {
  if (profile.collegeHistory && profile.collegeHistory.length > 0) return [];
  if (!profile.college) return [];
  const schools = profile.college
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (schools.length === 0) return [];
  return schools.map((school, i) => ({
    school,
    // First school uses the stored conference_conference field; remaining schools
    // fall back to the school→conference lookup table.
    conf:
      i === 0
        ? (abbreviateConference(profile.collegeConference) ?? inferConference(school))
        : inferConference(school),
  }));
}

export default async function GridstreamPlayerDetailPage({
  params,
  searchParams,
}: GridstreamPlayerDetailPageProps) {
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = searchParams ? await Promise.resolve(searchParams) : {};
  const routeId = decodeURIComponent(resolvedParams.playerId);
  const rawSeason = pickFirst(resolvedSearchParams.season);
  const isCareer = rawSeason === 'all';
  const seasonParam = isCareer ? null : toPositiveInt(rawSeason, 0) || null;
  const gamelogPageParam = toPositiveInt(pickFirst(resolvedSearchParams.gamelog_page), 1);

  const numericPlayerId = /^\d+$/.test(routeId) ? routeId : null;
  let profile: GridstreamPlayerProfile | null = null;
  let gamelog = EMPTY_GAMELOG;
  let splits = EMPTY_SPLITS;
  let dataWarning: string | null = null;

  if (numericPlayerId) {
    try {
      profile = await fetchGridstreamPlayerProfile({
        apiBase: API_BASE,
        playerId: numericPlayerId,
      });
    } catch (error) {
      dataWarning = error instanceof Error ? error.message : 'Failed to load live profile.';
    }

    if (profile) {
      const latestSeason = profile.seasonsPlayed.length ? Math.max(...profile.seasonsPlayed) : null;
      const selectedSeason = isCareer ? null : (seasonParam ?? latestSeason);
      try {
        const [gamelogData, splitsData] = await Promise.all([
          fetchGridstreamPlayerGamelogPage({
            apiBase: API_BASE,
            playerId: numericPlayerId,
            season: selectedSeason,
            page: gamelogPageParam,
            pageSize: 20,
          }),
          fetchGridstreamPlayerSplits({
            apiBase: API_BASE,
            playerId: numericPlayerId,
            season: selectedSeason,
          }),
        ]);
        gamelog = gamelogData;
        splits = splitsData;
      } catch (error) {
        dataWarning = error instanceof Error ? error.message : 'Failed to load gamelog/splits.';
      }
    }
  }

  if (!profile) {
    profile = toFallbackProfile(routeId);
    if (!profile) notFound();
    dataWarning = dataWarning ?? 'Live API profile unavailable. Showing SDK fallback profile.';
  }

  const selectedSeason = isCareer
    ? null
    : (seasonParam ?? (profile.seasonsPlayed.length ? Math.max(...profile.seasonsPlayed) : null));
  const seasonOptions = profile.seasonsPlayed.length
    ? Array.from(new Set(profile.seasonsPlayed)).sort((a, b) => b - a)
    : [];

  const statusTone = profile.isActive ? 'active' : 'inactive';

  return (
    <main className="gs-players-page">
      <div className="gs-players-shell">
        <header className="gs-players-header gs-player-detail-header">
          {profile.headshotUrl && (
            <div
              className="gs-player-detail-headshot-wrap"
              style={
                profile.currentTeamColors?.primary
                  ? {
                      borderColor: `#${profile.currentTeamColors.primary}`,
                      boxShadow: `0 0 20px #${profile.currentTeamColors.primary}55, 0 0 6px #${profile.currentTeamColors.primary}33`,
                    }
                  : undefined
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profile.headshotUrl}
                alt={profile.displayName}
                className="gs-player-detail-headshot"
              />
            </div>
          )}
          <div className="gs-player-detail-header-text">
            <div className="gs-players-kicker">Gridstream / Players / Profile</div>
            <h1 className="gs-players-title">{profile.displayName}</h1>
            <div className="gs-player-detail-badge-row">
              {profile.jerseyNumber && (
                <span className="gs-player-detail-hero-jersey">#{profile.jerseyNumber}</span>
              )}
              {profile.position && (
                <span className="gs-player-detail-hero-pos">{profile.position}</span>
              )}
              {profile.depthChartPosition && profile.depthChartPosition !== profile.position && (
                <span className="gs-player-detail-hero-depth">{profile.depthChartPosition}</span>
              )}
              {profile.teamAbbr && (
                <span
                  className="gs-player-detail-hero-team"
                  style={
                    profile.currentTeamColors?.primary
                      ? {
                          backgroundColor: `#${profile.currentTeamColors.primary}28`,
                          borderColor: `#${profile.currentTeamColors.primary}70`,
                          color: profile.currentTeamColors.secondary
                            ? `#${profile.currentTeamColors.secondary}`
                            : `#${profile.currentTeamColors.primary}`,
                        }
                      : undefined
                  }
                >
                  {profile.teamAbbr}
                </span>
              )}
              <span className={`gs-players-status-pill is-${statusTone}`}>
                {profile.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <Link href="/gridstream/players" className="gs-players-link gs-player-detail-back">
            ← Back To Players
          </Link>
        </header>

        {dataWarning && <section className="hud-panel gs-players-notice">{dataWarning}</section>}

        {/* ── Two-column layout: profile info left, contract right ─────────── */}
        <div className="gs-player-detail-panels-grid">
          {/* Left column: profile snapshot + secondary info */}
          <div className="gs-player-detail-panels-left">
            {/* Profile snapshot items */}
            <details className="hud-panel gs-player-detail-main" open>
              <summary className="gs-players-kicker">
                Profile Snapshot
                <span className="gs-panel-toggle-icon" aria-hidden="true" />
              </summary>
              <div className="gs-player-detail-meta">
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Age</div>
                  <div className="gs-player-detail-item-value">
                    {profile.age ?? '—'}
                    {profile.birthDate && (
                      <span className="gs-player-detail-item-sub">
                        {new Date(`${profile.birthDate}T00:00:00Z`).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </span>
                    )}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Height / Weight</div>
                  <div className="gs-player-detail-item-value">
                    {formatHeightWeight(profile.height, profile.weight)}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Draft</div>
                  <div className="gs-player-detail-item-value">
                    {formatGridstreamDraftLabel(profile)}
                    {profile.draftOverall != null && (
                      <span className="gs-player-detail-item-sub">
                        #{profile.draftOverall} overall
                      </span>
                    )}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Experience</div>
                  <div className="gs-player-detail-item-value">
                    {profile.yearsExperience != null
                      ? `${profile.yearsExperience} yr${profile.yearsExperience !== 1 ? 's' : ''}`
                      : '—'}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Seasons</div>
                  <div className="gs-player-detail-item-value">
                    {formatGridstreamSeasonRange(profile.seasonsPlayed)}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Games Played</div>
                  <div className="gs-player-detail-item-value">
                    {profile.gamesPlayed > 0 ? profile.gamesPlayed : '—'}
                  </div>
                </article>
                {profile.maddenRating &&
                  (() => {
                    const m = profile.maddenRating;
                    const pos = profile.position ?? '';
                    const isQB = pos === 'QB';
                    const isRB = ['RB', 'HB', 'FB'].includes(pos);
                    const isWRTE = ['WR', 'TE'].includes(pos);
                    const isOL = ['C', 'G', 'T', 'OT', 'OG', 'OL'].includes(pos);
                    const isDL = ['DE', 'DT', 'NT', 'LE', 'RE', 'DL'].includes(pos);
                    const isLB = ['LB', 'ILB', 'OLB', 'MLB'].includes(pos);
                    const isDB = ['CB', 'S', 'SS', 'FS', 'DB'].includes(pos);
                    const isK = ['K', 'P'].includes(pos);
                    type Attr = { label: string; value: number | null | undefined };
                    const categoryAttrs: Attr[] = [
                      { label: 'General', value: m.generalRating },
                      { label: 'Passing', value: m.passingRating },
                      { label: 'Receiving', value: m.receivingRating },
                      { label: 'Ball Carry', value: m.ballCarrierRating },
                      { label: 'Defense', value: m.defenseRating },
                      { label: 'Blocking', value: m.blockingRating },
                      { label: 'Kicking', value: m.kickingRating },
                    ].filter((a) => a.value != null);
                    const attrs: Attr[] = [
                      ...categoryAttrs,
                      { label: 'Speed', value: m.speed },
                      { label: 'Awareness', value: m.awareness },
                      { label: 'Strength', value: m.strength },
                      { label: 'Agility', value: m.agility },
                      ...(isQB
                        ? [
                            { label: 'Throw Pwr', value: m.throwPower },
                            { label: 'Accel', value: m.acceleration },
                          ]
                        : []),
                      ...(isRB || isWRTE
                        ? [
                            { label: 'Catching', value: m.catching },
                            { label: 'Accel', value: m.acceleration },
                          ]
                        : []),
                      ...(isWRTE ? [{ label: 'Route Run', value: m.routeRunning }] : []),
                      ...(isOL
                        ? [
                            { label: 'Run Block', value: m.runBlock },
                            { label: 'Pass Block', value: m.passBlock },
                          ]
                        : []),
                      ...(isDL
                        ? [
                            { label: 'Tackle', value: m.tackle },
                            { label: 'Pwr Moves', value: m.powerMoves },
                            { label: 'Fin Moves', value: m.finesseMoves },
                          ]
                        : []),
                      ...(isLB
                        ? [
                            { label: 'Tackle', value: m.tackle },
                            { label: 'Hit Power', value: m.hitPower },
                            { label: 'Accel', value: m.acceleration },
                          ]
                        : []),
                      ...(isDB
                        ? [
                            { label: 'Man Cover', value: m.manCoverage },
                            { label: 'Zone Cover', value: m.zoneCoverage },
                            { label: 'Hit Power', value: m.hitPower },
                          ]
                        : []),
                      ...(!isQB && !isRB && !isWRTE && !isOL && !isDL && !isLB && !isDB && !isK
                        ? [{ label: 'Accel', value: m.acceleration }]
                        : []),
                    ].filter((a) => a.value != null);
                    return (
                      <article className="gs-player-detail-item gs-player-detail-item--madden">
                        <div className="gs-player-detail-item-label">Madden OVR</div>
                        <div className="gs-player-detail-item-value">
                          <span
                            className={`gs-player-madden-ovr gs-player-madden-ovr--${maddenOvrTier(m.overall)}`}
                          >
                            {m.overall}
                          </span>
                          <span className="gs-player-detail-item-sub">Madden {m.maddenYear}</span>
                        </div>
                        {attrs.length > 0 && (
                          <div className="gs-player-madden-popup">
                            <div className="gs-player-madden-popup-title">
                              Madden {m.maddenYear}
                            </div>
                            <div className="gs-player-madden-popup-attrs">
                              {attrs.map(({ label, value }) => (
                                <div key={label} className="gs-player-madden-popup-row">
                                  <div className="gs-player-madden-popup-bar-wrap">
                                    <div
                                      className={`gs-player-detail-madden-bar gs-player-detail-madden-bar--${maddenOvrTier(value!)}`}
                                      style={{ width: `${value}%` }}
                                    />
                                  </div>
                                  <div className="gs-player-madden-popup-label">{label}</div>
                                  <div className="gs-player-madden-popup-value">{value}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })()}
                {profile.latestFfRanking && (
                  <article className="gs-player-detail-item">
                    <div className="gs-player-detail-item-label">Fantasy ECR</div>
                    <div className="gs-player-detail-item-value">
                      {profile.latestFfRanking.positionRank != null
                        ? `${profile.latestFfRanking.position}${profile.latestFfRanking.positionRank}`
                        : `#${Math.round(profile.latestFfRanking.rank)}`}
                      <span className="gs-player-detail-item-sub">
                        {profile.latestFfRanking.season} Wk{profile.latestFfRanking.week}
                      </span>
                    </div>
                  </article>
                )}
              </div>
            </details>

            {/* Combine Results — only shown if at least one measurement is present */}
            {(() => {
              const combine = profile.combineResults?.[0];
              if (!combine) return null;
              const hasMeasurements = [
                combine.fortyYard,
                combine.benchPress,
                combine.verticalJump,
                combine.broadJump,
                combine.threeCone,
                combine.shuttle,
                combine.armLength,
                combine.handSize,
              ].some((v) => v != null);
              if (!hasMeasurements) return null;
              return (
                <details className="hud-panel gs-player-detail-combine">
                  <summary className="gs-players-kicker">
                    NFL Combine{combine.season ? ` · ${combine.season}` : ''}
                    <span className="gs-panel-toggle-icon" aria-hidden="true" />
                  </summary>
                  <div className="gs-player-detail-combine-grid">
                    {combine.fortyYard != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">40-yd Dash</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.fortyYard.toFixed(2)}s
                        </div>
                      </article>
                    )}
                    {combine.benchPress != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">Bench Press</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.benchPress} reps
                        </div>
                      </article>
                    )}
                    {combine.verticalJump != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">Vertical</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.verticalJump}&quot;
                        </div>
                      </article>
                    )}
                    {combine.broadJump != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">Broad Jump</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.broadJump}&quot;
                        </div>
                      </article>
                    )}
                    {combine.threeCone != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">3-Cone</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.threeCone.toFixed(2)}s
                        </div>
                      </article>
                    )}
                    {combine.shuttle != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">Shuttle</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.shuttle.toFixed(2)}s
                        </div>
                      </article>
                    )}
                    {combine.armLength != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">Arm Length</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.armLength}&quot;
                        </div>
                      </article>
                    )}
                    {combine.handSize != null && (
                      <article className="gs-player-detail-combine-item">
                        <div className="gs-player-detail-combine-label">Hand Size</div>
                        <div className="gs-player-detail-combine-value">
                          {combine.handSize}&quot;
                        </div>
                      </article>
                    )}
                  </div>
                </details>
              );
            })()}

            {/* College History — from DB entries, or constructed from raw college field */}
            {(() => {
              const dbEntries = profile.collegeHistory ?? [];
              const fallbackEntries = buildCollegeEntries(profile);
              const hasContent = dbEntries.length > 0 || fallbackEntries.length > 0;
              if (!hasContent) return null;
              return (
                <details className="hud-panel gs-player-detail-college-history" open>
                  <summary className="gs-players-kicker">
                    College History
                    <span className="gs-panel-toggle-icon" aria-hidden="true" />
                  </summary>
                  <div className="gs-player-detail-college-list">
                    {dbEntries.length > 0
                      ? dbEntries.map((entry) => {
                          const conf = abbreviateConference(entry.conference);
                          const years = entry.startYear
                            ? entry.endYear && entry.endYear !== entry.startYear
                              ? `${entry.startYear}–${entry.endYear}`
                              : String(entry.startYear)
                            : null;
                          return (
                            <div key={entry.id} className="gs-player-detail-college-row">
                              {years && (
                                <span className="gs-player-detail-college-years">{years}</span>
                              )}
                              <span className="gs-player-detail-college-name">
                                {entry.college ?? 'Unknown'}
                                {conf && (
                                  <span className="gs-player-detail-college-conf">({conf})</span>
                                )}
                              </span>
                              {entry.isRedshirt && (
                                <span className="gs-player-detail-timeline-tag">RS</span>
                              )}
                            </div>
                          );
                        })
                      : fallbackEntries.map(({ school, conf }) => (
                          <div key={school} className="gs-player-detail-college-row">
                            <span className="gs-player-detail-college-name">
                              {school}
                              {conf && (
                                <span className="gs-player-detail-college-conf">({conf})</span>
                              )}
                            </span>
                          </div>
                        ))}
                  </div>
                </details>
              );
            })()}

            {/* Social Accounts */}
            {profile.socialAccounts && profile.socialAccounts.length > 0 && (
              <details className="hud-panel gs-player-detail-social" open>
                <summary className="gs-players-kicker">
                  Social
                  <span className="gs-panel-toggle-icon" aria-hidden="true" />
                </summary>
                <div className="gs-player-detail-social-row">
                  {profile.socialAccounts.map((acct) => (
                    <a
                      key={acct.id}
                      href={acct.url ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gs-player-detail-social-link"
                    >
                      <span className="gs-player-detail-social-platform">
                        {formatSocialPlatformLabel(acct.platform)}
                      </span>
                      {acct.handle && (
                        <span className="gs-player-detail-social-handle">@{acct.handle}</span>
                      )}
                    </a>
                  ))}
                </div>
              </details>
            )}

            {/* Awards — collapsed by default */}
            {profile.awards && profile.awards.length > 0 && (
              <details className="hud-panel gs-player-detail-awards">
                <summary className="gs-players-kicker">
                  Awards
                  <span className="gs-panel-toggle-icon" aria-hidden="true" />
                </summary>
                <div className="gs-player-detail-awards-list">
                  {[...profile.awards]
                    .sort((a, b) => b.season - a.season)
                    .map((award) => (
                      <div
                        key={`${award.season}-${award.espnAwardId}`}
                        className="gs-player-detail-award-row"
                      >
                        <span className="gs-player-detail-award-season">{award.season}</span>
                        <span className="gs-player-detail-award-name">{award.name}</span>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
          {/* end gs-player-detail-panels-left */}

          {/* Right column: Contract History */}
          {(() => {
            const contracts = [...(profile.contracts ?? [])].sort(
              (a, b) => (b.yearSigned ?? 0) - (a.yearSigned ?? 0)
            );
            if (contracts.length === 0) return null;
            return <ContractDetails contracts={contracts} />;
          })()}
        </div>
        {/* end gs-player-detail-panels-grid */}

        <PlayerStatsTabs
          gamelog={gamelog}
          splits={splits}
          selectedSeason={selectedSeason}
          seasonOptions={seasonOptions}
          routeId={routeId}
          position={profile.position ?? ''}
        />
      </div>
    </main>
  );
}
