'use client';

/**
 * TeamStatsTabs — tab content for the team detail page.
 *
 * Tabs: Overview · Season Stats · Roster · Free Agency · Schedule · Rankings
 * Each tab manages its own data-loading once mounted.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import PlayerQuickViewDrawer, {
  ProspectQuickViewTrigger,
  PlayerQuickViewTrigger,
  type DraftProspectQuickView,
} from '@/components/gridstream/PlayerQuickViewDrawer';
import {
  fetchGridstreamTeamsList,
  fetchGridstreamTeamSeasonStats,
  fetchGridstreamTeamGameLog,
  fetchGridstreamTeamDvoa,
  fetchGridstreamTeamRbsdm,
  fetchGridstreamTeamRoster,
  fetchGridstreamTeamRankings,
  formatTeamRecord,
  teamRankTierColor,
  type GridstreamTeamProfile,
  type GridstreamTeamStanding,
  type GridstreamTeamSeasonStats,
  type GridstreamTeamGameLogEntry,
  type GridstreamTeamDvoaSnapshot,
  type GridstreamTeamDvoaDetailResponse,
  type GridstreamTeamRbsdmResponse,
  type GridstreamRosterPlayer,
  type GridstreamTeamFreeAgentTrackerEntry,
  type GridstreamTeamFreeAgentTrackerResponse,
  type GridstreamTeamFreeAgencyTransaction,
  type GridstreamTeamContractChange,
  type GridstreamTeamRankings,
  type GridstreamTeamRankEntry,
  type GridstreamTeamReference,
} from '@atlas/sdk/gridstream';
// Local palette — mirrors the Gridstream dark UI theme
const C = {
  bgDeep: '#050c18',
  textPrimary: '#d9ecf9',
  textSecondary: '#9fc3db',
  textMuted: '#6f9ab8',
  accentCyan: '#00e5ff',
  linkCyan: '#63dfff',
  border: 'rgba(0,229,255,.15)',
} as const;

const remoteImageLoader = ({ src }: { src: string }) => src;

const SEASON_TYPE_LABEL: Record<string, string> = {
  REG: 'REG',
  POST: 'POST',
  PRE: 'PRE',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamTab =
  | 'overview'
  | 'season-stats'
  | 'roster'
  | 'free-agency'
  | 'schedule'
  | 'rankings';

interface TeamStatsTabsProps {
  apiBase: string;
  profile: GridstreamTeamProfile;
  currentStanding: GridstreamTeamStanding | null;
  currentSeason: number;
  sharedFreeAgencyTracker: GridstreamTeamFreeAgentTrackerResponse | null;
  sharedFreeAgencyTrackerLoading: boolean;
  sharedFreeAgencyTrackerError: string | null;
  activeTab: TeamTab;
  onTabChange: (tab: TeamTab) => void;
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function TeamStatsTabs({
  apiBase,
  profile,
  currentStanding,
  currentSeason,
  sharedFreeAgencyTracker,
  sharedFreeAgencyTrackerLoading,
  sharedFreeAgencyTrackerError,
  activeTab,
  onTabChange,
}: TeamStatsTabsProps) {
  const [quickViewPlayer, setQuickViewPlayer] = useState<
    | {
        kind: 'player';
        playerId: string;
        playerName: string | null;
      }
    | {
        kind: 'prospect';
        prospect: DraftProspectQuickView;
      }
    | null
  >(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const tabs: { key: TeamTab; label: string; mobileLabel?: string }[] = [
    { key: 'overview', label: 'OVERVIEW' },
    { key: 'season-stats', label: 'SEASON STATS', mobileLabel: 'STATS' },
    { key: 'roster', label: 'ROSTER' },
    { key: 'free-agency', label: 'FREE AGENCY', mobileLabel: 'FA' },
    { key: 'schedule', label: 'SCHEDULE', mobileLabel: 'SCHED' },
    { key: 'rankings', label: 'RANKINGS', mobileLabel: 'RANK' },
  ];

  const [opponentLogoByAbbr, setOpponentLogoByAbbr] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetchGridstreamTeamsList(apiBase)
      .then((teams) => {
        if (cancelled) return;
        const byAbbr: Record<string, string> = {};
        for (const team of teams) {
          const logo = team.logoScoreboardUrl ?? team.logoUrl;
          if (team.abbreviation && logo) byAbbr[team.abbreviation] = logo;
        }
        setOpponentLogoByAbbr(byAbbr);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const openPlayerQuickView = (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => {
    if (playerId == null) return;
    setQuickViewPlayer({
      kind: 'player',
      playerId: String(playerId),
      playerName: playerName ?? null,
    });
  };

  const openProspectQuickView = (prospect: DraftProspectQuickView | null | undefined) => {
    if (!prospect) return;
    setQuickViewPlayer({
      kind: 'prospect',
      prospect,
    });
  };

  return (
    <div>
      {/* Tab navigation */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${C.border}`,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          paddingBottom: 2,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: isMobile ? '10px 12px' : '10px 18px',
              fontSize: isMobile ? 10 : 11,
              letterSpacing: '.1em',
              fontFamily: "'Orbitron', monospace",
              cursor: 'pointer',
              color: activeTab === t.key ? C.accentCyan : C.textMuted,
              borderBottom:
                activeTab === t.key ? `2px solid ${C.accentCyan}` : '2px solid transparent',
              whiteSpace: 'nowrap',
              marginBottom: -1,
            }}
          >
            {isMobile ? (t.mobileLabel ?? t.label) : t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ marginTop: 20 }}>
        {activeTab === 'overview' && (
          <OverviewTab
            apiBase={apiBase}
            profile={profile}
            currentStanding={currentStanding}
            currentSeason={currentSeason}
            offseasonTracker={sharedFreeAgencyTracker}
            loadingOffseason={sharedFreeAgencyTrackerLoading}
            opponentLogoByAbbr={opponentLogoByAbbr}
            onOpenPlayerQuickView={openPlayerQuickView}
            onOpenProspectQuickView={openProspectQuickView}
          />
        )}
        {activeTab === 'season-stats' && (
          <SeasonStatsTab apiBase={apiBase} profile={profile} currentSeason={currentSeason} />
        )}
        {activeTab === 'roster' && (
          <RosterTab
            apiBase={apiBase}
            profile={profile}
            onOpenPlayerQuickView={openPlayerQuickView}
          />
        )}
        {activeTab === 'free-agency' && (
          <FreeAgencyTab
            profile={profile}
            tracker={sharedFreeAgencyTracker}
            loading={sharedFreeAgencyTrackerLoading}
            error={sharedFreeAgencyTrackerError}
            onOpenPlayerQuickView={openPlayerQuickView}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            apiBase={apiBase}
            profile={profile}
            currentSeason={currentSeason}
            opponentLogoByAbbr={opponentLogoByAbbr}
          />
        )}
        {activeTab === 'rankings' && (
          <RankingsTab apiBase={apiBase} profile={profile} currentSeason={currentSeason} />
        )}
      </div>
      <PlayerQuickViewDrawer
        apiBase={apiBase}
        playerId={quickViewPlayer?.kind === 'player' ? quickViewPlayer.playerId : null}
        playerLabel={quickViewPlayer?.kind === 'player' ? quickViewPlayer.playerName : null}
        prospect={quickViewPlayer?.kind === 'prospect' ? quickViewPlayer.prospect : null}
        open={quickViewPlayer != null}
        onClose={() => setQuickViewPlayer(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OVERVIEW TAB
// ---------------------------------------------------------------------------

function OverviewTab({
  apiBase,
  profile,
  currentStanding,
  currentSeason,
  offseasonTracker,
  loadingOffseason,
  opponentLogoByAbbr,
  onOpenPlayerQuickView,
  onOpenProspectQuickView,
}: {
  apiBase: string;
  profile: GridstreamTeamProfile;
  currentStanding: GridstreamTeamStanding | null;
  currentSeason: number;
  offseasonTracker: GridstreamTeamFreeAgentTrackerResponse | null;
  loadingOffseason: boolean;
  opponentLogoByAbbr: Record<string, string>;
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
  onOpenProspectQuickView: (prospect: DraftProspectQuickView | null | undefined) => void;
}) {
  const [gameLog, setGameLog] = useState<GridstreamTeamGameLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [dvoa, setDvoa] = useState<GridstreamTeamDvoaDetailResponse | null>(null);
  const [_loadingDvoa, setLoadingDvoa] = useState(true);
  const [rbsdm, setRbsdm] = useState<GridstreamTeamRbsdmResponse | null>(null);
  const [_loadingRbsdm, setLoadingRbsdm] = useState(true);

  const today = new Date();
  const offseasonSeason = currentSeason + 1;
  const isOffseasonView =
    today.getFullYear() === offseasonSeason && today.getMonth() >= 1 && today.getMonth() < 7;

  useEffect(() => {
    let cancelled = false;
    fetchGridstreamTeamGameLog(apiBase, profile.abbreviation, currentSeason)
      .then((log) => {
        if (!cancelled) setGameLog(log);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingLog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation, currentSeason]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDvoa(true);
    fetchGridstreamTeamDvoa(apiBase, profile.abbreviation)
      .then((payload) => {
        if (!cancelled) setDvoa(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingDvoa(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRbsdm(true);
    fetchGridstreamTeamRbsdm(apiBase, profile.abbreviation, { season: currentSeason })
      .then((payload) => {
        if (!cancelled) setRbsdm(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingRbsdm(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation, currentSeason]);

  const completedGames = gameLog.filter((g) => g.result != null);
  const recentFive = completedGames.slice(0, 5);
  const recentThree = recentFive.slice(0, 3);
  const opponentLabelByWeek = useMemo(() => {
    const byWeek: Record<number, string> = {};
    for (const game of completedGames) {
      const opponentLabel = game.opponentDisplay || game.opponentAbbr;
      if (!opponentLabel) continue;
      byWeek[game.week] = `${game.isHome ? 'vs' : '@'} ${opponentLabel}`;
    }
    return byWeek;
  }, [completedGames]);

  // Derive season averages from completed games
  const n = completedGames.length || 1;
  const avgPassYds = completedGames.reduce((s, g) => s + g.passYards, 0) / n;
  const avgRushYds = completedGames.reduce((s, g) => s + g.rushYards, 0) / n;
  const avgTotalYds = completedGames.reduce((s, g) => s + g.totalYards, 0) / n;
  const avgSacks = completedGames.reduce((s, g) => s + g.sacksMade, 0) / n;
  const avgTO = completedGames.reduce((s, g) => s + g.turnovers, 0) / n;
  const avgTA = completedGames.reduce((s, g) => s + g.takeaways, 0) / n;

  const games = completedGames.length || 17;
  const ppg = currentStanding?.pointsFor != null ? currentStanding.pointsFor / games : null;
  const papg =
    currentStanding?.pointsAgainst != null ? currentStanding.pointsAgainst / games : null;
  const regHistoryAll = dvoa?.history?.REG ?? [];
  const regHistorySeason = regHistoryAll
    .filter((row) => row.season === currentSeason)
    .sort((a, b) => a.week - b.week);
  const regHistoryForCards = regHistorySeason.length ? regHistorySeason : regHistoryAll;

  const pickLatestMetric = (
    selector: (snapshot: GridstreamTeamDvoaSnapshot) => number | null
  ): number | null => {
    for (let i = regHistoryForCards.length - 1; i >= 0; i -= 1) {
      const snapshot = regHistoryForCards[i];
      if (!snapshot) continue;
      const value = selector(snapshot);
      if (value != null) return value;
    }
    const latest = dvoa?.latest?.REG;
    return latest ? selector(latest) : null;
  };

  type DvoaWeekPoint = { week: number; value: number; rank: number | null };

  const dedupeWeekSeries = (rows: DvoaWeekPoint[]): DvoaWeekPoint[] => {
    const byWeek = new Map<number, DvoaWeekPoint>();
    for (const row of rows) byWeek.set(row.week, row);
    return [...byWeek.values()].sort((a, b) => a.week - b.week);
  };

  const metricNumber = (
    row: { metrics: Record<string, unknown> } | null | undefined,
    key: string
  ): number | null => {
    if (!row) return null;
    const value = row.metrics?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const totalDvoaVal = pickLatestMetric((s) => s.totalDvoa);
  const totalDvoaRankVal = pickLatestMetric((s) => s.totalDvoaRank);
  const offenseDvoaVal = pickLatestMetric((s) => s.offenseDvoa);
  const defenseDvoaVal = pickLatestMetric((s) => s.defenseDvoa);
  const weightedDvoaVal = pickLatestMetric((s) => s.weightedTotalDvoa);
  const estimatedWinsVal = pickLatestMetric((s) => s.estimatedWins);
  const pastScheduleDvoaVal = pickLatestMetric((s) => s.pastScheduleDvoa);
  const futureScheduleDvoaVal = pickLatestMetric((s) => s.futureScheduleDvoa);
  const varianceVal = pickLatestMetric((s) => s.variance);
  const lastWeekRankVal = pickLatestMetric((s) => s.lastWeekRank);

  const latestRbsdmOff = rbsdm?.latest?.stats_offense_weekly ?? null;
  const latestRbsdmDef = rbsdm?.latest?.stats_defense_weekly ?? null;
  const latestRbsdmLuckOff = rbsdm?.latest?.luck_offense_weekly ?? null;
  const latestRbsdmPassFreq = rbsdm?.latest?.passfreq_neutral_yearly ?? null;

  const offSuccessRate = metricNumber(latestRbsdmOff, 'success_rate_sr');
  const defSuccessRate = metricNumber(latestRbsdmDef, 'success_rate_sr');
  const neutralPassRate = metricNumber(latestRbsdmPassFreq, 'pass_rate');
  const luckThirdConvOverExpect = metricNumber(latestRbsdmLuckOff, '3rd_conv_over_expect');
  const luckRzTdPct = metricNumber(latestRbsdmLuckOff, 'rz_tdpct');

  const toSeries = (datasetKey: string, metricKey: string): DvoaWeekPoint[] => {
    const rows = rbsdm?.datasets?.[datasetKey] ?? [];
    const points = rows
      .map<DvoaWeekPoint | null>((row) => {
        const value = metricNumber(row, metricKey);
        if (value == null) return null;
        return { week: row.week, value, rank: null };
      })
      .filter((row): row is DvoaWeekPoint => row != null);
    return dedupeWeekSeries(points);
  };

  const offRbsdmEpaSeries = toSeries('stats_offense_weekly', 'epa_play');
  const defRbsdmEpaSeries = toSeries('stats_defense_weekly', 'epa_play');
  const totalDvoaSeries = dedupeWeekSeries(
    regHistorySeason
      .map<DvoaWeekPoint | null>((row) => {
        if (row.totalDvoa == null) return null;
        return {
          week: row.week,
          value: row.totalDvoa,
          rank: row.totalDvoaRank ?? null,
        };
      })
      .filter((row): row is DvoaWeekPoint => row != null)
  );

  const accent = `#${profile.colorPrimary}`;
  type OverviewMetric = {
    label: string;
    value: string;
    color: string;
    detail?: string;
    optional?: boolean;
  };

  const formatSignedValue = (value: number | null | undefined, digits = 1, suffix = '') => {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`;
  };

  const toneColor = (value: number | null | undefined, positiveIsGood: boolean) => {
    if (value == null || !Number.isFinite(value)) return C.textSecondary;
    if (positiveIsGood) return value >= 0 ? '#8fff45' : '#ff627e';
    return value <= 0 ? '#8fff45' : '#ff627e';
  };

  const seasonRecord = formatTeamRecord(
    currentStanding?.wins ?? null,
    currentStanding?.losses ?? null,
    currentStanding?.ties ?? null
  );
  const recentWins = recentFive.filter((g) => g.result === 'W').length;
  const recentLosses = recentFive.filter((g) => g.result === 'L').length;
  const recentTies = recentFive.filter((g) => g.result === 'T').length;
  const recentRecord = recentFive.length
    ? formatTeamRecord(recentWins, recentLosses, recentTies)
    : '—';
  const recentAvgMargin = recentFive.length
    ? recentFive.reduce((sum, game) => sum + (game.teamScore - game.oppScore), 0) /
      recentFive.length
    : null;
  const pointDiffVal =
    currentStanding?.pointDiff ??
    (currentStanding?.pointsFor != null && currentStanding?.pointsAgainst != null
      ? currentStanding.pointsFor - currentStanding.pointsAgainst
      : null);

  const offenseLean =
    neutralPassRate != null
      ? neutralPassRate >= 0.56
        ? 'Pass-first'
        : neutralPassRate <= 0.46
          ? 'Run-first'
          : 'Balanced'
      : avgPassYds - avgRushYds >= 35
        ? 'Pass-first'
        : avgRushYds - avgPassYds >= 20
          ? 'Run-first'
          : 'Balanced';

  const describeOverall = () => {
    if (totalDvoaVal != null) {
      if (totalDvoaVal >= 10) return 'Overall metrics point to a clear upper-tier team.';
      if (totalDvoaVal >= 0) return 'Overall metrics point to a competitive middle-tier team.';
      if (totalDvoaVal >= -10) return 'Overall metrics sit a bit below league average.';
      return 'Overall efficiency and scoring margin both trend below league average.';
    }
    if (pointDiffVal != null) {
      if (pointDiffVal >= 40) return 'Scoring margin points to a team winning more than it loses.';
      if (pointDiffVal >= 0) return 'Scoring margin points to a fairly even team profile.';
      return 'Negative scoring margin points to a team playing from behind too often.';
    }
    return 'Current-season team context is still filling in.';
  };

  const describeOffense = () => {
    if (offenseDvoaVal != null && offenseDvoaVal >= 8) {
      return `${offenseLean} offense with efficient down-to-down production.`;
    }
    if (avgTO >= 1.5) return `${offenseLean} offense that gives away too many drives.`;
    if (offenseDvoaVal != null && offenseDvoaVal <= -8) {
      return `${offenseLean} offense that struggles to stay on schedule.`;
    }
    return `${offenseLean} offense with mixed efficiency.`;
  };

  const describeDefense = () => {
    if (defenseDvoaVal != null && defenseDvoaVal <= -8) {
      return 'Defense grades out as the steadier side of the ball.';
    }
    if (avgSacks >= 2.7 && avgTA < 1.1)
      return 'Pressure shows up, but it is not turning into enough takeaways.';
    if (defenseDvoaVal != null && defenseDvoaVal >= 8) {
      return 'Defense is allowing opponents to stay comfortable too often.';
    }
    if (avgTA >= 1.4) return 'Defense is helping with extra possessions.';
    return 'Defensive results are mixed week to week.';
  };

  const offenseIdentityTitle =
    offenseDvoaVal != null && offenseDvoaVal >= 8
      ? `${offenseLean} and efficient`
      : avgTO >= 1.5
        ? `${offenseLean} but turnover-prone`
        : offenseDvoaVal != null && offenseDvoaVal <= -8
          ? `${offenseLean} but inconsistent`
          : `${offenseLean} with mixed returns`;

  const defenseIdentityTitle =
    defenseDvoaVal != null && defenseDvoaVal <= -8
      ? 'Hard to score on'
      : avgSacks >= 2.7 && avgTA < 1.1
        ? 'Pressure without enough takeaways'
        : defenseDvoaVal != null && defenseDvoaVal >= 8
          ? 'Too easy to move on'
          : avgTA >= 1.4
            ? 'Creates extra possessions'
            : 'Mixed defensive returns';

  const acquiredLegend = getDepthChartLegendItem('acquired');
  const reSignedLegend = getDepthChartLegendItem('reSigned');
  const ufaLegend = getDepthChartLegendItem('ufa');
  const rfaLegend = getDepthChartLegendItem('rfa');
  const erfaLegend = getDepthChartLegendItem('erfa');
  const releasedLegend = getDepthChartLegendItem('released');

  const outgoingFaRows = offseasonTracker?.results ?? [];
  const incomingFaRows = offseasonTracker?.incomingResults ?? [];
  const cutsRows = offseasonTracker?.cuts ?? [];
  const signedElsewhereTransactions = offseasonTracker?.signedElsewhere ?? [];
  const contractChangeRows = offseasonTracker?.contractChanges ?? [];
  const draftPicks = offseasonTracker?.draftPicks ?? [];
  const teamNeeds = offseasonTracker?.teamNeeds ?? [];
  const draftTargets = offseasonTracker?.draftTargets ?? [];
  const reSignedRows = outgoingFaRows.filter(
    (row) => normalizeDepthToken(row.trackerStatus) === 'RE_SIGNED'
  );
  const trackerSignedElsewhereRows = outgoingFaRows.filter(
    (row) => normalizeDepthToken(row.trackerStatus) === 'SIGNED_ELSEWHERE'
  );
  const offseasonPersonKey = (
    playerId: number | null | undefined,
    playerName: string | null | undefined
  ) => (playerId != null ? String(playerId) : normalizeDepthToken(playerName));
  const cutPlayerKeys = new Set(
    cutsRows.map((row) => offseasonPersonKey(row.playerId, row.playerName))
  );
  const signedElsewhereKeys = new Set(
    signedElsewhereTransactions.map((row) => offseasonPersonKey(row.playerId, row.playerName))
  );
  const signedElsewhereRows = trackerSignedElsewhereRows.filter((row) => {
    const key = offseasonPersonKey(row.playerId, row.playerName);
    return !signedElsewhereKeys.has(key);
  });
  const unsignedRows = outgoingFaRows.filter((row) => {
    const key = offseasonPersonKey(row.playerId, row.playerName);
    const faType = normalizeDepthToken(row.faType);
    return (
      normalizeDepthToken(row.trackerStatus) === 'UNSIGNED' &&
      ['UFA', 'RFA', 'ERFA'].includes(faType) &&
      !cutPlayerKeys.has(key) &&
      !signedElsewhereKeys.has(key)
    );
  });
  const unsignedUfaCount = unsignedRows.filter(
    (row) => normalizeDepthToken(row.faType) === 'UFA'
  ).length;
  const unsignedRfaCount = unsignedRows.filter(
    (row) => normalizeDepthToken(row.faType) === 'RFA'
  ).length;
  const unsignedErfaCount = unsignedRows.filter(
    (row) => normalizeDepthToken(row.faType) === 'ERFA'
  ).length;
  const hasOffseasonData =
    incomingFaRows.length +
      reSignedRows.length +
      unsignedRows.length +
      signedElsewhereTransactions.length +
      signedElsewhereRows.length +
      cutsRows.length +
      contractChangeRows.length +
      draftPicks.length +
      teamNeeds.length +
      draftTargets.length >
    0;

  type OverviewActivityItem = {
    key: string;
    label: string;
    detail: string;
    secondaryDetail?: string;
    secondaryDetailColor?: string;
    secondaryDetailBackground?: string;
    secondaryDetailBorder?: string;
    badge: string;
    badgeColor: string;
    badgeBackground: string;
    badgeBorder: string;
    statusKey?: 'released' | 'signed' | 'other';
    playerId?: string | number | null | undefined;
    playerName?: string | null;
    prospect?: DraftProspectQuickView | null;
    importance: number;
  };

  const freeAgencyTabHref = `/gridstream/teams/${profile.abbreviation}?tab=free-agency`;
  const draftNeedRankByKey = new Map(
    teamNeeds.map((need, index) => [normalizeDepthToken(need.key), index])
  );
  const POSITION_IMPORTANCE_BY_BUCKET: Record<string, number> = {
    QB: 98,
    EDGE: 92,
    WR: 88,
    OL: 86,
    CB: 84,
    DL: 80,
    LB: 76,
    TE: 72,
    S: 68,
    RB: 64,
    K: 20,
    P: 18,
    LS: 16,
  };

  const positionToNeedBucket = (value: string | null | undefined): string | null => {
    const token = normalizeDepthToken(value);
    if (!token) return null;
    if (token === 'QB') return 'QB';
    if (['RB', 'FB'].includes(token)) return 'RB';
    if (['WR', 'LWR', 'SWR', 'RWR'].includes(token)) return 'WR';
    if (token === 'TE') return 'TE';
    if (['C', 'G', 'T', 'OG', 'OT', 'LT', 'RT', 'LG', 'RG', 'OL'].includes(token)) return 'OL';
    if (['EDGE', 'ED', 'DE'].includes(token)) return 'EDGE';
    if (['DT', 'NT', 'DL', 'DI'].includes(token)) return 'DL';
    if (['LB', 'ILB', 'MLB', 'OLB', 'LOLB', 'ROLB', 'SLB', 'WLB'].includes(token)) return 'LB';
    if (['CB', 'LCB', 'RCB', 'NB'].includes(token)) return 'CB';
    if (['S', 'FS', 'SS', 'DB'].includes(token)) return 'S';
    if (token === 'K') return 'K';
    if (['P', 'PT'].includes(token)) return 'P';
    if (token === 'LS') return 'LS';
    return null;
  };

  const positionImportance = (value: string | null | undefined) =>
    POSITION_IMPORTANCE_BY_BUCKET[positionToNeedBucket(value) ?? ''] ?? 28;

  const needBoost = (value: string | null | undefined) => {
    const index = draftNeedRankByKey.get(positionToNeedBucket(value) ?? '');
    if (index == null) return 0;
    return Math.max(0, 60 - index * 10);
  };

  const contractImportance = (
    contract:
      | GridstreamTeamFreeAgentTrackerEntry['contractDetail']
      | Pick<GridstreamTeamContractChange, 'apy' | 'totalValue' | 'guaranteed'>
      | null
      | undefined
  ) =>
    Math.round(
      Math.max(contract?.apy ?? 0, contract?.guaranteed ?? 0, (contract?.totalValue ?? 0) / 2) /
        1_000_000
    );

  const normalizeHexColor = (value: string | null | undefined, fallback: string) => {
    const token = (value ?? '').trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(token)) {
      return `#${token
        .split('')
        .map((char) => char + char)
        .join('')}`;
    }
    if (/^[\da-f]{6}$/i.test(token)) {
      return `#${token}`;
    }
    return fallback;
  };

  const colorWithAlpha = (value: string | null | undefined, alpha: number, fallback: string) => {
    const hex = normalizeHexColor(value, fallback).slice(1);
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  };

  const recencyImportance = (value: string | null | undefined) => {
    if (!value) return 0;
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return 0;
    return Math.round(timestamp / 86_400_000 / 1000);
  };

  const sortOverviewItems = (items: OverviewActivityItem[]) =>
    [...items].sort((a, b) => b.importance - a.importance || a.label.localeCompare(b.label));

  const mapTrackerRowToActivityItem = (
    entry: GridstreamTeamFreeAgentTrackerEntry,
    item: DepthChartLegendItem,
    badgeLabel = item.badgeLabel,
    importanceOverride?: number
  ): OverviewActivityItem => {
    const contractSummary = formatTrackerContractSummary(entry.contractDetail);
    return {
      key: `tracker-${entry.id ?? entry.playerId ?? entry.playerName}-${badgeLabel}`,
      label: entry.playerName || '—',
      detail: [entry.position || null, contractSummary].filter(Boolean).join(' · ') || '—',
      badge: badgeLabel,
      badgeColor: item.color,
      badgeBackground: item.background,
      badgeBorder: item.border,
      playerId: entry.playerId,
      playerName: entry.playerName,
      importance:
        importanceOverride ??
        contractImportance(entry.contractDetail) * 1000 +
          needBoost(entry.position) * 100 +
          positionImportance(entry.position),
    };
  };

  const buildSignedWithSecondaryLine = (
    team:
      | GridstreamTeamFreeAgencyTransaction['toTeam']
      | GridstreamTeamFreeAgentTrackerEntry['signedWithTeam']
      | null
      | undefined
  ) => {
    const teamName = team?.shortDisplayName || team?.displayName;
    if (!teamName) return null;
    const secondaryColor = normalizeHexColor(team.colorSecondary, '#d9ecf9');
    return {
      secondaryDetail: `Signed with ${teamName}`,
      secondaryDetailColor: secondaryColor,
      secondaryDetailBackground: colorWithAlpha(team.colorPrimary, 0.18, '#1a3a5c'),
      secondaryDetailBorder: colorWithAlpha(team.colorPrimary, 0.4, '#1a3a5c'),
    };
  };

  const retainedItemsAll = sortOverviewItems(
    reSignedRows.map((entry) => mapTrackerRowToActivityItem(entry, reSignedLegend))
  );
  const retainedItems = retainedItemsAll.slice(0, 5);
  const openMarketItemsAll = sortOverviewItems(
    unsignedRows.map((entry) => {
      const faType = normalizeDepthToken(entry.faType);
      const legend = faType === 'RFA' ? rfaLegend : faType === 'ERFA' ? erfaLegend : ufaLegend;
      return mapTrackerRowToActivityItem(
        entry,
        legend,
        legend.badgeLabel,
        needBoost(entry.position) * 1000 + positionImportance(entry.position) * 10
      );
    })
  );
  const openMarketItems = openMarketItemsAll.slice(0, 5);
  const departureItemsByPerson = new Map<string, OverviewActivityItem>();
  const upsertDepartureItem = (
    key: string,
    item: OverviewActivityItem,
    secondaryTeam?:
      | GridstreamTeamFreeAgencyTransaction['toTeam']
      | GridstreamTeamFreeAgentTrackerEntry['signedWithTeam']
      | null
  ) => {
    const existing = departureItemsByPerson.get(key);
    if (!existing) {
      departureItemsByPerson.set(key, item);
      return;
    }

    const secondaryLine = buildSignedWithSecondaryLine(secondaryTeam);
    if (existing.statusKey === 'released' && item.statusKey === 'signed') {
      departureItemsByPerson.set(key, {
        ...existing,
        importance: Math.max(existing.importance, item.importance),
        ...(secondaryLine ?? {}),
      });
      return;
    }

    if (existing.statusKey === 'signed' && item.statusKey === 'released') {
      departureItemsByPerson.set(key, {
        ...item,
        importance: Math.max(existing.importance, item.importance),
        ...(existing.secondaryDetail
          ? {
              secondaryDetail: existing.secondaryDetail,
              secondaryDetailColor: existing.secondaryDetailColor,
              secondaryDetailBackground: existing.secondaryDetailBackground,
              secondaryDetailBorder: existing.secondaryDetailBorder,
            }
          : (secondaryLine ?? {})),
      });
      return;
    }

    if (item.importance > existing.importance) {
      departureItemsByPerson.set(key, item);
    }
  };

  for (const row of cutsRows) {
    const key = offseasonPersonKey(row.playerId, row.playerName);
    upsertDepartureItem(key, {
      key: `cut-${row.id ?? row.playerId ?? row.playerName}`,
      label: row.playerName || '—',
      detail:
        [row.playerPosition || null, row.date ? formatFreeAgencyDate(row.date) : null]
          .filter(Boolean)
          .join(' · ') || '—',
      badge: formatTransactionBadgeLabel(row.transactionType),
      badgeColor: releasedLegend.color,
      badgeBackground: releasedLegend.background,
      badgeBorder: releasedLegend.border,
      statusKey: 'released',
      playerId: row.playerId,
      playerName: row.playerName,
      importance:
        needBoost(row.playerPosition) * 700 +
        positionImportance(row.playerPosition) * 10 +
        recencyImportance(row.date),
    });
  }

  for (const row of signedElsewhereTransactions) {
    const key = offseasonPersonKey(row.playerId, row.playerName);
    upsertDepartureItem(
      key,
      {
        key: `signed-${row.id ?? row.playerId ?? row.playerName}`,
        label: row.playerName || '—',
        detail:
          [
            row.playerPosition || null,
            row.toTeam?.displayName || null,
            row.date ? formatFreeAgencyDate(row.date) : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—',
        badge: 'SIGNED',
        badgeColor: '#ff9aa8',
        badgeBackground: 'rgba(244,63,94,.12)',
        badgeBorder: 'rgba(244,63,94,.26)',
        statusKey: 'signed',
        playerId: row.playerId,
        playerName: row.playerName,
        importance:
          needBoost(row.playerPosition) * 700 +
          positionImportance(row.playerPosition) * 10 +
          recencyImportance(row.date),
      },
      row.toTeam
    );
  }

  for (const entry of signedElsewhereRows) {
    const key = offseasonPersonKey(entry.playerId, entry.playerName);
    const contractSummary = formatTrackerContractSummary(entry.contractDetail);
    upsertDepartureItem(
      key,
      {
        key: `lost-${entry.id ?? entry.playerId ?? entry.playerName}`,
        label: entry.playerName || '—',
        detail:
          [entry.position || null, entry.signedWithTeam?.displayName || null, contractSummary]
            .filter(Boolean)
            .join(' · ') || '—',
        badge: 'SIGNED',
        badgeColor: '#ff9aa8',
        badgeBackground: 'rgba(244,63,94,.12)',
        badgeBorder: 'rgba(244,63,94,.26)',
        statusKey: 'signed',
        playerId: entry.playerId,
        playerName: entry.playerName,
        importance:
          contractImportance(entry.contractDetail) * 1000 +
          needBoost(entry.position) * 100 +
          positionImportance(entry.position),
      },
      entry.signedWithTeam
    );
  }

  const departureItemsAll: OverviewActivityItem[] = sortOverviewItems([
    ...departureItemsByPerson.values(),
  ]);
  const departureItems = departureItemsAll.slice(0, 5);
  const contractChangeItemsAll = sortOverviewItems(
    contractChangeRows.map((row) => ({
      key: `contract-${row.id ?? row.playerId ?? row.playerName}`,
      label: row.playerName || '—',
      detail:
        [row.playerPosition || null, formatContractChangeSummary(row)]
          .filter(Boolean)
          .join(' · ') || '—',
      badge: 'UPDATED',
      badgeColor: '#c084fc',
      badgeBackground: 'rgba(168,85,247,.14)',
      badgeBorder: 'rgba(168,85,247,.28)',
      playerId: row.playerId,
      playerName: row.playerName,
      importance:
        contractImportance(row) * 1000 +
        needBoost(row.playerPosition) * 100 +
        positionImportance(row.playerPosition),
    }))
  );
  const contractChangeItems = contractChangeItemsAll.slice(0, 5);
  const firstDraftPick = draftPicks.find((pick) => pick.overallPick != null) ?? null;
  const draftTargetItems: OverviewActivityItem[] = draftTargets.slice(0, 5).map((target) => ({
    key: `draft-target-${target.playerId ?? target.name}`,
    label: target.name || '—',
    detail:
      [
        [target.position || null, target.school || null].filter(Boolean).join(' · ') || null,
        target.fitReason || target.needLabel || null,
        target.range || (target.trueAdp != null ? `True ADP ${target.trueAdp.toFixed(1)}` : null),
      ]
        .filter(Boolean)
        .join(' · ') || '—',
    badge:
      target.buzzOverallRank != null
        ? `#${target.buzzOverallRank}`
        : target.overallRank != null
          ? `#${target.overallRank}`
          : target.teamMockCount != null && target.teamMockCount > 0
            ? `${target.teamMockCount}x`
            : 'FIT',
    badgeColor: '#7ee7ff',
    badgeBackground: 'rgba(34,211,238,.12)',
    badgeBorder: 'rgba(34,211,238,.24)',
    prospect: {
      name: target.name,
      position: target.position,
      school: target.school,
      imageUrl: target.imageUrl,
      collegeLogoUrl: target.collegeLogoUrl,
      range: target.range,
      teamMockCount: target.teamMockCount,
      totalMockCount: target.totalMockCount,
      consensusType: target.consensusType,
      overallRank: target.overallRank,
      trueAdp: target.trueAdp,
      needLabel: target.needLabel,
      fitReason: target.fitReason,
      sourceLabel: target.sourceLabel || 'NFL Draft IQ mock consensus',
      sourceUrl: target.sourceUrl ?? offseasonTracker?.draftTargetsSourceUrl ?? null,
      classYear: target.classYear,
      hometown: target.hometown,
      role: target.role,
      jerseyNumber: target.jerseyNumber,
      draftProjection: target.draftProjection,
      buzzOverallRating: target.buzzOverallRating,
      buzzOverallRank: target.buzzOverallRank,
      buzzPositionRank: target.buzzPositionRank,
      buzzPositionRankGroup: target.buzzPositionRankGroup,
      allScoutsOverallRank: target.allScoutsOverallRank,
      allScoutsPositionRank: target.allScoutsPositionRank,
      height: target.height,
      weight: target.weight,
      fortyYard: target.fortyYard,
      handSize: target.handSize,
      armLength: target.armLength,
      age: target.age,
      birthDate: target.birthDate,
      sourceLastUpdated: target.sourceLastUpdated,
      collegeGames: target.collegeGames,
      collegeSnaps: target.collegeSnaps,
      bio: target.bio,
      summary: target.summary,
      strengths: target.strengths,
      weaknesses: target.weaknesses,
      honors: target.honors,
      productionStats: target.productionStats,
      scoutingGrades: target.scoutingGrades,
      measurablePercentiles: target.measurablePercentiles,
      recruitingRatings: target.recruitingRatings,
      comparisonPlayers: target.comparisonPlayers,
      fitTeams: target.fitTeams,
      teamAbbr: profile.abbreviation,
      draftSeason: offseasonSeason,
      pickLabel: firstDraftPick?.overallPick != null ? `Pick #${firstDraftPick.overallPick}` : null,
    },
    importance:
      (target.overallRank != null ? 100 - target.overallRank : 0) +
      needBoost(target.needKey || target.position) * 10,
  }));
  const addedSummaryLabel =
    incomingFaRows.length > 0
      ? `${incomingFaRows.length} outside additions logged`
      : 'No outside additions logged yet';
  const addedSummaryDetail =
    incomingFaRows.length > 0
      ? 'Most recent additions are surfaced below.'
      : 'Watching for the first outside signing or trade.';

  const offseasonMetrics: OverviewMetric[] = [
    {
      label: 'Added',
      value: String(incomingFaRows.length),
      color: acquiredLegend.color,
      detail: 'External additions',
    },
    {
      label: 'Re-signed',
      value: String(reSignedRows.length),
      color: reSignedLegend.color,
      detail: 'Retained expiring players',
    },
    {
      label: 'Open FAs',
      value: String(unsignedRows.length),
      color: ufaLegend.color,
      detail: `${unsignedUfaCount} UFA · ${unsignedRfaCount} RFA · ${unsignedErfaCount} ERFA`,
    },
    {
      label: `Draft Picks ${offseasonSeason}`,
      value: String(draftPicks.length),
      color: '#7ee7ff',
      detail: 'Current draft capital',
    },
    {
      label: 'Cuts',
      value: String(cutsRows.length),
      color: releasedLegend.color,
      detail: 'Released / waived',
    },
    {
      label: 'Contract Changes',
      value: String(contractChangeRows.length),
      color: '#c084fc',
      detail: 'Extensions / restructures',
    },
  ];

  const snapshotHeadline = isOffseasonView
    ? `${currentSeason} season recap`
    : `${currentSeason} at a glance`;
  const snapshotSummary = isOffseasonView
    ? [
        seasonRecord !== '—' ? `Finished ${seasonRecord}` : null,
        pointDiffVal != null
          ? `with ${formatSignedValue(pointDiffVal, 0)} point differential`
          : null,
        totalDvoaRankVal != null ? `and #${totalDvoaRankVal} total DVOA` : null,
        recentRecord !== '—' ? `${recentRecord} over the last five.` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        describeOverall(),
        describeOffense(),
        describeDefense(),
        recentRecord !== '—' ? `${recentRecord} over the last five.` : null,
      ]
        .filter(Boolean)
        .join(' ');

  const snapshotMetrics: OverviewMetric[] = [
    {
      label: 'Record',
      value: seasonRecord,
      color: accent,
      detail: currentStanding?.divRank != null ? `Div rank #${currentStanding.divRank}` : undefined,
    },
    {
      label: 'Last 5',
      value: recentRecord,
      color:
        recentAvgMargin != null ? (recentAvgMargin >= 0 ? '#8fff45' : '#ff627e') : C.textSecondary,
      detail:
        recentAvgMargin != null
          ? `${recentAvgMargin > 0 ? '+' : ''}${recentAvgMargin.toFixed(1)} avg margin`
          : undefined,
    },
    {
      label: 'Point Diff',
      value: pointDiffVal != null ? formatSignedValue(pointDiffVal, 0) : '—',
      color: pointDiffVal != null ? (pointDiffVal >= 0 ? '#8fff45' : '#ff627e') : C.textSecondary,
      detail:
        currentStanding?.pointsFor != null && currentStanding?.pointsAgainst != null
          ? `${currentStanding.pointsFor} PF / ${currentStanding.pointsAgainst} PA`
          : undefined,
    },
    {
      label: 'DVOA Rank',
      value: totalDvoaRankVal != null ? `#${totalDvoaRankVal}` : '—',
      color: '#63dfff',
      detail: totalDvoaVal != null ? formatSignedValue(totalDvoaVal, 1, '%') : undefined,
    },
  ];

  const offenseMetrics: OverviewMetric[] = [
    {
      label: 'PPG',
      value: ppg != null ? ppg.toFixed(1) : '—',
      color: toneColor((ppg ?? 0) - 22, true),
    },
    {
      label: 'Off DVOA',
      value: formatSignedValue(offenseDvoaVal, 1, '%'),
      color: toneColor(offenseDvoaVal, true),
      optional: offenseDvoaVal == null,
    },
    {
      label: 'Success Rate',
      value: offSuccessRate != null ? `${(offSuccessRate * 100).toFixed(1)}%` : '—',
      color:
        offSuccessRate != null
          ? offSuccessRate >= 0.46
            ? '#8fff45'
            : offSuccessRate <= 0.42
              ? '#ff627e'
              : '#ffb612'
          : C.textSecondary,
      optional: offSuccessRate == null,
    },
    {
      label: 'Yards / Game',
      value: completedGames.length ? avgTotalYds.toFixed(0) : '—',
      color: C.accentCyan,
    },
  ];

  const defenseMetrics: OverviewMetric[] = [
    {
      label: 'PAPG',
      value: papg != null ? papg.toFixed(1) : '—',
      color: toneColor((papg ?? 0) - 22, false),
    },
    {
      label: 'Def DVOA',
      value: formatSignedValue(defenseDvoaVal, 1, '%'),
      color: toneColor(defenseDvoaVal, false),
      optional: defenseDvoaVal == null,
    },
    {
      label: 'Success Rate',
      value: defSuccessRate != null ? `${(defSuccessRate * 100).toFixed(1)}%` : '—',
      color:
        defSuccessRate != null
          ? defSuccessRate <= 0.42
            ? '#8fff45'
            : defSuccessRate >= 0.46
              ? '#ff627e'
              : '#ffb612'
          : C.textSecondary,
      optional: defSuccessRate == null,
    },
    {
      label: 'Takeaways / G',
      value: completedGames.length ? avgTA.toFixed(1) : '—',
      color: '#8fff45',
    },
  ];

  const contextMetrics: OverviewMetric[] = [
    {
      label: 'Weighted DVOA',
      value: formatSignedValue(weightedDvoaVal, 1, '%'),
      color: toneColor(weightedDvoaVal, true),
      optional: weightedDvoaVal == null,
    },
    {
      label: 'Est Wins',
      value: estimatedWinsVal != null ? estimatedWinsVal.toFixed(1) : '—',
      color: '#63dfff',
      optional: estimatedWinsVal == null,
    },
    {
      label: 'DVOA Δ Rank',
      value:
        totalDvoaRankVal != null && lastWeekRankVal != null
          ? `${lastWeekRankVal - totalDvoaRankVal > 0 ? '+' : ''}${lastWeekRankVal - totalDvoaRankVal}`
          : '—',
      color:
        totalDvoaRankVal != null && lastWeekRankVal != null
          ? lastWeekRankVal - totalDvoaRankVal >= 0
            ? '#8fff45'
            : '#ff627e'
          : C.textSecondary,
      optional: totalDvoaRankVal == null || lastWeekRankVal == null,
    },
    {
      label: 'Past / Fut SOS',
      value:
        pastScheduleDvoaVal != null && futureScheduleDvoaVal != null
          ? `${formatSignedValue(pastScheduleDvoaVal, 1)} / ${formatSignedValue(futureScheduleDvoaVal, 1)}`
          : '—',
      color: '#9fc3db',
      optional: pastScheduleDvoaVal == null || futureScheduleDvoaVal == null,
    },
    {
      label: 'DVOA Var',
      value: varianceVal != null ? varianceVal.toFixed(1) : '—',
      color: '#c084fc',
      optional: varianceVal == null,
    },
  ].filter((metric) => !metric.optional || metric.value !== '—');

  const offenseSummary = [
    describeOffense().replace(/\.$/, ''),
    ppg != null ? `${ppg.toFixed(1)} points per game` : null,
    offSuccessRate != null ? `${(offSuccessRate * 100).toFixed(1)}% success rate` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const defenseSummary = [
    describeDefense().replace(/\.$/, ''),
    papg != null ? `${papg.toFixed(1)} points allowed per game` : null,
    defSuccessRate != null ? `${(defSuccessRate * 100).toFixed(1)}% success rate allowed` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const offenseFooter = [
    completedGames.length ? `${avgPassYds.toFixed(0)} pass yds/g` : null,
    completedGames.length ? `${avgRushYds.toFixed(0)} rush yds/g` : null,
    completedGames.length ? `${avgTO.toFixed(1)} turnovers/g` : null,
    neutralPassRate != null ? `${(neutralPassRate * 100).toFixed(1)}% neutral pass` : null,
  ]
    .filter(Boolean)
    .join(' • ');

  const defenseFooter = [
    completedGames.length ? `${avgSacks.toFixed(1)} sacks/g` : null,
    completedGames.length ? `${avgTA.toFixed(1)} takeaways/g` : null,
    luckThirdConvOverExpect != null
      ? `${luckThirdConvOverExpect >= 0 ? '+' : ''}${(luckThirdConvOverExpect * 100).toFixed(1)}% 3rd O/E`
      : null,
    luckRzTdPct != null ? `${(luckRzTdPct * 100).toFixed(1)}% RZ TD%` : null,
  ]
    .filter(Boolean)
    .join(' • ');

  const hasTrendCharts =
    totalDvoaSeries.length > 1 || offRbsdmEpaSeries.length > 1 || defRbsdmEpaSeries.length > 1;
  const draftPickItems: OverviewActivityItem[] = draftPicks.slice(0, 8).map((pick) => ({
    key: `draft-pick-${pick.round}-${pick.overallPick}-${pick.originalTeamAbbr}`,
    label: `Pick #${pick.overallPick ?? '—'}`,
    detail:
      [
        pick.round != null ? `Round ${pick.round}` : null,
        pick.originalTeamAbbr && pick.originalTeamAbbr !== profile.abbreviation
          ? `from ${pick.originalTeamAbbr}`
          : null,
        pick.compensatory ? 'compensatory' : null,
      ]
        .filter(Boolean)
        .join(' · ') || '—',
    badge: `R${pick.round ?? '—'}`,
    badgeColor: '#78e6ff',
    badgeBackground: 'rgba(56,189,248,.14)',
    badgeBorder: 'rgba(56,189,248,.28)',
    importance: 1000 - (pick.overallPick ?? 999),
  }));
  const draftNeedItems: OverviewActivityItem[] = teamNeeds.slice(0, 5).map((need, index) => ({
    key: `draft-need-${need.key}-${index}`,
    label: need.label || need.key || 'Need',
    detail: need.detail || '—',
    badge: `#${index + 1}`,
    badgeColor: '#ffb866',
    badgeBackground: 'rgba(255,152,0,.14)',
    badgeBorder: 'rgba(255,152,0,.28)',
    importance: (need.score ?? 0) * 100 - index,
  }));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {isOffseasonView && (
        <section style={{ display: 'grid', gap: 12 }}>
          <SectionHeader>{offseasonSeason} OFFSEASON PULSE</SectionHeader>

          {loadingOffseason ? (
            <div
              style={{
                color: C.textMuted,
                fontSize: 12,
                border: `1px solid ${C.border}`,
                background: 'rgba(0,12,28,.52)',
                padding: '14px 16px',
              }}
            >
              Loading current offseason activity…
            </div>
          ) : hasOffseasonData ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                }}
              >
                {offseasonMetrics.map((metric) => (
                  <OverviewMetricTile
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    color={metric.color}
                    detail={metric.detail}
                  />
                ))}
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 12,
                }}
              >
                <div style={{ display: 'grid', gap: 8 }}>
                  <OverviewPulseGroupLabel>ROSTER MOVEMENT</OverviewPulseGroupLabel>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      background: 'rgba(0,8,20,.42)',
                      border: '1px solid rgba(0,229,255,.08)',
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span
                        style={{
                          color: '#78a3c1',
                          fontSize: 10,
                          letterSpacing: '.1em',
                          fontFamily: "'Orbitron', monospace",
                        }}
                      >
                        ADDED
                      </span>
                      <div
                        style={{
                          color: '#f4fbff',
                          fontSize: 13,
                          fontWeight: 600,
                          lineHeight: 1.25,
                        }}
                      >
                        {addedSummaryLabel}
                      </div>
                      <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.4 }}>
                        {addedSummaryDetail}
                      </div>
                    </div>
                    <div
                      style={{
                        color: acquiredLegend.color,
                        fontSize: 28,
                        lineHeight: 1,
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {incomingFaRows.length}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      alignItems: 'start',
                    }}
                  >
                    <OverviewActivityPanel
                      eyebrow="RETAINED"
                      title="Kept in-house"
                      subtitle={`${reSignedRows.length} re-signings tracked`}
                      items={retainedItems}
                      totalCount={retainedItemsAll.length}
                      seeAllHref={freeAgencyTabHref}
                      emptyMessage="No re-signings logged yet."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                    <OverviewActivityPanel
                      eyebrow="OPEN MARKET"
                      title="Still unresolved"
                      subtitle={`${unsignedRows.length} unsigned free agents`}
                      items={openMarketItems}
                      totalCount={openMarketItemsAll.length}
                      seeAllHref={freeAgencyTabHref}
                      emptyMessage="No unsigned UFAs, RFAs, or ERFAs listed."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                    <OverviewActivityPanel
                      eyebrow="DEPARTURES"
                      title="Players leaving"
                      subtitle={`${cutsRows.length} cuts · ${
                        signedElsewhereTransactions.length + signedElsewhereRows.length
                      } signed elsewhere`}
                      items={departureItems}
                      totalCount={departureItemsAll.length}
                      seeAllHref={freeAgencyTabHref}
                      emptyMessage="No cuts or outgoing signings tracked yet."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                    <OverviewActivityPanel
                      eyebrow="CONTRACTS"
                      title="Updated deals"
                      subtitle={`${contractChangeRows.length} extensions or restructures`}
                      items={contractChangeItems}
                      totalCount={contractChangeItemsAll.length}
                      seeAllHref={freeAgencyTabHref}
                      emptyMessage="No contract changes tracked yet."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  <OverviewPulseGroupLabel>DRAFT OUTLOOK</OverviewPulseGroupLabel>
                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    }}
                  >
                    <OverviewActivityPanel
                      eyebrow="DRAFT CAPITAL"
                      title="Upcoming picks"
                      subtitle={
                        offseasonTracker?.draftSourceUrl
                          ? `${draftPicks.length} picks from current Tankathon order`
                          : 'Draft order not synced yet'
                      }
                      items={draftPickItems}
                      emptyMessage="No current draft picks available yet."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                    <OverviewActivityPanel
                      eyebrow="TEAM NEEDS"
                      title="Where help is needed"
                      subtitle={
                        offseasonSeason === 2026
                          ? 'From NFL.com Round 1 needs board'
                          : 'Top five needs entering this offseason'
                      }
                      items={draftNeedItems}
                      emptyMessage="No source-backed team needs are available yet."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                    <OverviewActivityPanel
                      eyebrow="POTENTIAL TARGETS"
                      title={
                        firstDraftPick?.overallPick != null
                          ? `Fits for Pick #${firstDraftPick.overallPick}`
                          : 'Potential first-pick fits'
                      }
                      subtitle={
                        draftTargets.length > 0
                          ? 'From NFL Draft IQ mock consensus over the past 14 days'
                          : 'No consensus targets matched to this top pick yet'
                      }
                      items={draftTargetItems}
                      emptyMessage="No source-backed prospect targets are available yet."
                      onOpenPlayerQuickView={onOpenPlayerQuickView}
                      onOpenProspectQuickView={onOpenProspectQuickView}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                color: C.textMuted,
                fontSize: 12,
                border: `1px solid ${C.border}`,
                background: 'rgba(0,12,28,.52)',
                padding: '14px 16px',
              }}
            >
              No offseason activity is synced for {offseasonSeason} yet.
            </div>
          )}
        </section>
      )}

      {isOffseasonView && <SectionHeader>{currentSeason} SEASON RECAP</SectionHeader>}

      <section
        style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <div
          style={{
            background: `linear-gradient(145deg, rgba(0,18,38,.92) 0%, rgba(0,10,24,.78) 100%)`,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${accent}`,
            padding: '18px 18px 16px',
            display: 'grid',
            gap: 16,
          }}
        >
          <div style={{ display: 'grid', gap: 6 }}>
            <span
              style={{
                color: accent,
                fontSize: 10,
                letterSpacing: '.1em',
                fontFamily: "'Orbitron', monospace",
              }}
            >
              SEASON SNAPSHOT
            </span>
            <div
              style={{
                color: '#f4fbff',
                fontSize: 28,
                lineHeight: 1.1,
                fontWeight: 700,
              }}
            >
              {snapshotHeadline}
            </div>
            <div
              style={{
                color: C.textSecondary,
                fontSize: 13,
                lineHeight: 1.5,
                maxWidth: 760,
              }}
            >
              {snapshotSummary ||
                'Current-season context will populate as more modeled team data lands.'}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
            }}
          >
            {snapshotMetrics.map((metric) => (
              <OverviewMetricTile
                key={metric.label}
                label={metric.label}
                value={metric.value}
                color={metric.color}
                detail={metric.detail}
              />
            ))}
          </div>
        </div>

        <div
          style={{
            background: 'rgba(0,12,28,.72)',
            border: '1px solid rgba(0,229,255,.12)',
            padding: '16px 16px 14px',
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <span
              style={{
                color: '#78a3c1',
                fontSize: 10,
                letterSpacing: '.1em',
                fontFamily: "'Orbitron', monospace",
              }}
            >
              RECENT FORM
            </span>
            <div
              style={{
                color: '#f4fbff',
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.15,
              }}
            >
              {recentRecord !== '—' ? `${recentRecord} in the last five` : 'No completed games yet'}
            </div>
            <div
              style={{
                color: C.textSecondary,
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {recentAvgMargin != null
                ? `${recentAvgMargin > 0 ? '+' : ''}${recentAvgMargin.toFixed(1)} average scoring margin`
                : loadingLog
                  ? 'Loading recent results…'
                  : 'Recent form will appear after completed games.'}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            {!loadingLog && recentFive.length > 0 ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {recentFive.map((game) => {
                    const resultColor =
                      game.result === 'W' ? '#8fff45' : game.result === 'L' ? '#ff627e' : '#ffb612';
                    return (
                      <div
                        key={`${game.gameId}-chip`}
                        style={{
                          minWidth: 66,
                          background: 'rgba(0,8,20,.48)',
                          border: '1px solid rgba(0,229,255,.12)',
                          padding: '8px 10px',
                          display: 'grid',
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            color: C.textMuted,
                            fontSize: 9,
                            letterSpacing: '.1em',
                            fontFamily: "'Orbitron', monospace",
                          }}
                        >
                          WK {game.week}
                        </div>
                        <div
                          style={{
                            color: resultColor,
                            fontSize: 18,
                            lineHeight: 1,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {game.result ?? '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  {recentThree.map((g) => (
                    <RecentGameRow
                      key={g.gameId}
                      game={g}
                      opponentLogoByAbbr={opponentLogoByAbbr}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: C.textMuted, fontSize: 12, padding: '14px 2px' }}>
                {loadingLog ? 'Loading recent results…' : 'No completed games to show.'}
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}
      >
        <OverviewSummaryPanel
          eyebrow="OFFENSIVE PROFILE"
          title={offenseIdentityTitle}
          summary={offenseSummary || 'Offensive efficiency data is still loading.'}
          metrics={offenseMetrics}
          footer={offenseFooter}
        />
        <OverviewSummaryPanel
          eyebrow="DEFENSIVE PROFILE"
          title={defenseIdentityTitle}
          summary={defenseSummary || 'Defensive efficiency data is still loading.'}
          metrics={defenseMetrics}
          footer={defenseFooter}
        />
      </section>

      {contextMetrics.length > 0 && (
        <section>
          <SectionHeader>ADVANCED CONTEXT</SectionHeader>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            {contextMetrics.map((metric) => (
              <OverviewContextTile
                key={metric.label}
                label={metric.label}
                value={metric.value}
                color={metric.color}
                detail={metric.detail}
              />
            ))}
          </div>
        </section>
      )}

      {hasTrendCharts && (
        <section>
          <SectionHeader>WEEKLY TRAJECTORY</SectionHeader>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 12,
            }}
          >
            {totalDvoaSeries.length > 1 && (
              <DvoaWeekChart
                points={totalDvoaSeries}
                title="TOTAL DVOA"
                positiveIsGood={true}
                hoverContextByWeek={opponentLabelByWeek}
              />
            )}
            {offRbsdmEpaSeries.length > 1 && (
              <DvoaWeekChart
                points={offRbsdmEpaSeries}
                title="OFFENSE EPA / PLAY"
                positiveIsGood={true}
                showRank={false}
                hoverContextByWeek={opponentLabelByWeek}
                formatValue={(value) => (value > 0 ? `+${value.toFixed(3)}` : value.toFixed(3))}
              />
            )}
            {defRbsdmEpaSeries.length > 1 && (
              <DvoaWeekChart
                points={defRbsdmEpaSeries}
                title="DEFENSE EPA / PLAY"
                positiveIsGood={false}
                showRank={false}
                hoverContextByWeek={opponentLabelByWeek}
                formatValue={(value) => (value > 0 ? `+${value.toFixed(3)}` : value.toFixed(3))}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function OverviewPulseGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: '#5e84a0',
        fontSize: 10,
        letterSpacing: '.16em',
        fontFamily: "'Orbitron', monospace",
      }}
    >
      {children}
    </div>
  );
}

function OverviewMetricTile({
  label,
  value,
  color,
  detail,
}: {
  label: string;
  value: string;
  color: string;
  detail?: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(0,8,20,.52)',
        border: '1px solid rgba(0,229,255,.12)',
        padding: '11px 12px',
        minHeight: 78,
        display: 'grid',
        alignContent: 'start',
        gap: 6,
      }}
    >
      <div
        style={{
          color: C.textMuted,
          fontSize: 9,
          letterSpacing: '.1em',
          fontFamily: "'Orbitron', monospace",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: 24,
          lineHeight: 1.1,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {value}
      </div>
      <div
        style={{
          color: C.textMuted,
          fontSize: 10,
          lineHeight: 1.3,
          minHeight: 13,
        }}
      >
        {detail ?? '\u00A0'}
      </div>
    </div>
  );
}

function OverviewContextTile({
  label,
  value,
  color,
  detail,
}: {
  label: string;
  value: string;
  color: string;
  detail?: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(0,8,20,.34)',
        border: '1px solid rgba(0,229,255,.08)',
        padding: '10px 12px',
        minHeight: 64,
        display: 'grid',
        alignContent: 'start',
        gap: 4,
      }}
    >
      <div
        style={{
          color: C.textMuted,
          fontSize: 9,
          letterSpacing: '.1em',
          fontFamily: "'Orbitron', monospace",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: 18,
          lineHeight: 1.1,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {value}
      </div>
      <div
        style={{
          color: C.textMuted,
          fontSize: 10,
          lineHeight: 1.3,
          minHeight: 13,
        }}
      >
        {detail ?? '\u00A0'}
      </div>
    </div>
  );
}

function OverviewActivityPanel({
  eyebrow,
  title,
  subtitle,
  items,
  totalCount,
  seeAllHref,
  emptyMessage,
  onOpenPlayerQuickView,
  onOpenProspectQuickView,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: Array<{
    key: string;
    label: string;
    detail: string;
    secondaryDetail?: string;
    secondaryDetailColor?: string;
    secondaryDetailBackground?: string;
    secondaryDetailBorder?: string;
    badge: string;
    badgeColor: string;
    badgeBackground: string;
    badgeBorder: string;
    playerId?: string | number | null | undefined;
    playerName?: string | null;
    prospect?: DraftProspectQuickView | null;
  }>;
  totalCount?: number;
  seeAllHref?: string | null;
  emptyMessage: string;
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
  onOpenProspectQuickView: (prospect: DraftProspectQuickView | null | undefined) => void;
}) {
  const hiddenCount = Math.max(0, (totalCount ?? items.length) - items.length);
  return (
    <div
      style={{
        background: 'rgba(0,12,28,.72)',
        border: '1px solid rgba(0,229,255,.12)',
        padding: '14px 14px 12px',
        display: 'grid',
        gap: 12,
        alignSelf: 'start',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <span
            style={{
              color: '#78a3c1',
              fontSize: 10,
              letterSpacing: '.1em',
              fontFamily: "'Orbitron', monospace",
            }}
          >
            {eyebrow}
          </span>
          <div style={{ color: '#f4fbff', fontSize: 19, fontWeight: 700, lineHeight: 1.15 }}>
            {title}
          </div>
          <div style={{ color: C.textSecondary, fontSize: 12, lineHeight: 1.4 }}>{subtitle}</div>
        </div>
        {seeAllHref && hiddenCount > 0 ? (
          <Link
            href={seeAllHref}
            style={{
              color: C.linkCyan,
              fontSize: 11,
              textDecoration: 'none',
              fontFamily: "'Orbitron', monospace",
              letterSpacing: '.06em',
              whiteSpace: 'nowrap',
            }}
          >
            SEE ALL {totalCount}
          </Link>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'grid',
                gap: 5,
                background: 'rgba(0,8,20,.42)',
                border: '1px solid rgba(0,229,255,.08)',
                padding: '10px 11px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                  }}
                >
                  {item.prospect ? (
                    <ProspectQuickViewTrigger
                      prospect={item.prospect}
                      onOpen={onOpenProspectQuickView}
                      style={{
                        color: '#f4fbff',
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1.25,
                        display: 'inline-block',
                      }}
                    >
                      {item.label}
                    </ProspectQuickViewTrigger>
                  ) : (
                    <PlayerQuickViewTrigger
                      playerId={item.playerId}
                      playerName={item.playerName ?? item.label}
                      onOpen={onOpenPlayerQuickView}
                      style={{
                        color: '#f4fbff',
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1.25,
                        display: 'inline-block',
                      }}
                    >
                      {item.label}
                    </PlayerQuickViewTrigger>
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: item.secondaryDetail ? 6 : 0,
                    justifyItems: 'end',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: item.badgeColor,
                      background: item.badgeBackground,
                      border: `1px solid ${item.badgeBorder}`,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      fontFamily: "'Orbitron', monospace",
                      padding: '3px 6px',
                      minHeight: 19,
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.badge}
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    color: C.textMuted,
                    fontSize: 11,
                    lineHeight: 1.4,
                    minWidth: 0,
                    flex: '1 1 auto',
                  }}
                >
                  {item.detail}
                </div>
                {item.secondaryDetail ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: item.secondaryDetailColor || C.textPrimary,
                      background: item.secondaryDetailBackground || 'rgba(0,8,20,.42)',
                      border: `1px solid ${item.secondaryDetailBorder || 'rgba(0,229,255,.12)'}`,
                      padding: '3px 6px',
                      minHeight: 19,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      fontFamily: "'Orbitron', monospace",
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2,
                      flexShrink: 0,
                    }}
                  >
                    {item.secondaryDetail}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            color: C.textMuted,
            fontSize: 12,
            border: '1px dashed rgba(0,229,255,.12)',
            padding: '12px',
          }}
        >
          {emptyMessage}
        </div>
      )}
    </div>
  );
}

function OverviewSummaryPanel({
  eyebrow,
  title,
  summary,
  metrics,
  footer,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  metrics: Array<{ label: string; value: string; color: string; optional?: boolean }>;
  footer?: string;
}) {
  const visibleMetrics = metrics.filter((metric) => !metric.optional || metric.value !== '—');

  return (
    <div
      style={{
        background: 'rgba(0,12,28,.72)',
        border: '1px solid rgba(0,229,255,.12)',
        padding: '16px',
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'grid', gap: 5 }}>
        <span
          style={{
            color: '#78a3c1',
            fontSize: 10,
            letterSpacing: '.1em',
            fontFamily: "'Orbitron', monospace",
          }}
        >
          {eyebrow}
        </span>
        <div style={{ color: '#f4fbff', fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>
          {title}
        </div>
        <div style={{ color: C.textSecondary, fontSize: 12, lineHeight: 1.45 }}>{summary}</div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        }}
      >
        {visibleMetrics.map((metric) => (
          <OverviewMetricTile
            key={metric.label}
            label={metric.label}
            value={metric.value}
            color={metric.color}
          />
        ))}
      </div>

      {footer && (
        <div
          style={{
            color: C.textMuted,
            fontSize: 11,
            lineHeight: 1.45,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

function RecentGameRow({
  game,
  opponentLogoByAbbr,
}: {
  game: GridstreamTeamGameLogEntry;
  opponentLogoByAbbr: Record<string, string>;
}) {
  const resultColor = game.result === 'W' ? '#8fff45' : game.result === 'L' ? '#ff627e' : '#ffb612';
  const oppColor = game.opponentColor ? `#${game.opponentColor}` : '#6f9ab8';
  const oppLogo = opponentLogoByAbbr[game.opponentAbbr] ?? game.opponentLogo;
  const opponentLabel = game.opponentDisplay || game.opponentAbbr;

  return (
    <Link href={`/gridstream/games/${game.gameId}`} style={{ textDecoration: 'none' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(0,12,28,.6)',
          border: '1px solid rgba(0,229,255,.1)',
          padding: '8px 12px',
          transition: 'background .15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,229,255,.05)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,12,28,.6)')}
      >
        <span
          style={{
            color: C.textMuted,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            width: 42,
            flexShrink: 0,
          }}
        >
          {SEASON_TYPE_LABEL[game.seasonType] ?? game.seasonType} {game.week}
        </span>
        <span style={{ color: C.textMuted, fontSize: 11, width: 18, flexShrink: 0 }}>
          {game.isHome ? 'vs' : '@'}
        </span>
        {oppLogo && (
          <Image
            src={oppLogo}
            alt=""
            width={22}
            height={22}
            unoptimized
            loader={remoteImageLoader}
            style={{ objectFit: 'contain', flexShrink: 0 }}
          />
        )}
        <span
          title={opponentLabel}
          style={{
            color: oppColor,
            fontSize: 13,
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {opponentLabel}
        </span>
        <span
          style={{
            color: resultColor,
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {game.result} {game.teamScore}–{game.oppScore}
        </span>
        <span
          style={{
            color: C.textMuted,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            width: 52,
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {game.totalYards} yds
        </span>
      </div>
    </Link>
  );
}

function DvoaWeekChart({
  points,
  title,
  positiveIsGood,
  showRank = true,
  hoverContextByWeek,
  formatValue,
}: {
  points: Array<{ week: number; value: number; rank: number | null }>;
  title: string;
  positiveIsGood: boolean;
  showRank?: boolean;
  hoverContextByWeek?: Record<number, string>;
  formatValue?: (value: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pts = points;

  const formatChartValue =
    formatValue ??
    ((value: number) => (value > 0 ? `+${value.toFixed(2)}%` : `${value.toFixed(2)}%`));

  if (pts.length < 2) {
    const single = pts[0];
    return (
      <div
        style={{
          background: 'rgba(0,12,28,.7)',
          border: '1px solid rgba(0,229,255,.12)',
          padding: '12px 14px',
          color: C.textMuted,
          fontSize: 11,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '.08em',
            fontFamily: "'Orbitron', monospace",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        {single ? (
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Only one weekly snapshot available (Wk {single.week}: {formatChartValue(single.value)})
          </span>
        ) : (
          'No weekly trend available'
        )}
      </div>
    );
  }

  const values = pts.map((p) => p.value);
  const weeks = pts.map((p) => p.week);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = (rawMax - rawMin) * 0.1 || 1;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const range = max - min || 1;

  const W = 560;
  const H = 110;
  const ML = 40;
  const MR = 8;
  const MT = 6;
  const MB = 20;
  const cW = W - ML - MR;
  const cH = H - MT - MB;

  const toX = (i: number) => ML + (i / Math.max(values.length - 1, 1)) * cW;
  const toY = (v: number) => MT + cH - ((v - min) / range) * cH;
  const zeroY = toY(0);
  const yTicks: number[] = [rawMax, rawMin];
  if (zeroY > MT + 12 && zeroY < MT + cH - 12) yTicks.splice(1, 0, 0);
  const xStep = values.length > 14 ? 3 : values.length > 8 ? 2 : 1;

  const hoverPoint = hoverIdx != null ? pts[hoverIdx] : null;
  const hoverValue = hoverPoint?.value ?? null;
  const hoverContext = hoverPoint ? hoverContextByWeek?.[hoverPoint.week] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let nearestDist = Infinity;
    values.forEach((_, i) => {
      const d = Math.abs(toX(i) - mouseX);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    setHoverIdx(nearest);
  };

  return (
    <div
      style={{
        background: 'rgba(0,12,28,.7)',
        border: '1px solid rgba(0,229,255,.12)',
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'grid', gap: 4, marginBottom: 8, minHeight: 34 }}>
        <span
          style={{
            color: C.textMuted,
            fontSize: 10,
            letterSpacing: '.08em',
            fontFamily: "'Orbitron', monospace",
          }}
        >
          {title}
        </span>
        <span
          style={{
            color:
              hoverValue == null
                ? 'transparent'
                : positiveIsGood
                  ? hoverValue >= 0
                    ? '#8fff45'
                    : '#ff627e'
                  : hoverValue <= 0
                    ? '#8fff45'
                    : '#ff627e',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.25,
            minHeight: 15,
            visibility: hoverPoint && hoverValue != null ? 'visible' : 'hidden',
          }}
        >
          {hoverPoint && hoverValue != null
            ? `WK ${hoverPoint.week}${hoverContext ? ` · ${hoverContext}` : ''}: ${formatChartValue(hoverValue)}${showRank && hoverPoint.rank != null ? ` · #${hoverPoint.rank}` : ''}`
            : '\u00A0'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: H, display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((v) => {
          const y = toY(v);
          return (
            <g key={v}>
              <line
                x1={ML}
                y1={y}
                x2={W - MR}
                y2={y}
                stroke="rgba(0,229,255,.07)"
                strokeWidth={1}
              />
              <text x={ML - 4} y={y + 3} fill="#4a6a82" fontSize={8} textAnchor="end">
                {formatChartValue(v)}
              </text>
            </g>
          );
        })}

        {zeroY > MT && zeroY < MT + cH && (
          <line
            x1={ML}
            y1={zeroY}
            x2={W - MR}
            y2={zeroY}
            stroke="rgba(0,229,255,.25)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}

        {weeks.map((wk, i) => {
          if (i % xStep !== 0) return null;
          return (
            <text key={i} x={toX(i)} y={H - 4} fill="#4a6a82" fontSize={8} textAnchor="middle">
              {wk}
            </text>
          );
        })}

        <polyline
          points={values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')}
          fill="none"
          stroke="rgba(0,229,255,.35)"
          strokeWidth={1.5}
        />

        {values.map((v, i) => {
          const dotColor = positiveIsGood
            ? v >= 0
              ? '#8fff45'
              : '#ff627e'
            : v <= 0
              ? '#8fff45'
              : '#ff627e';
          const isHover = hoverIdx === i;
          return (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(v)}
              r={isHover ? 5 : 2.5}
              fill={dotColor}
              opacity={isHover ? 1 : 0.85}
            />
          );
        })}

        {hoverIdx != null && (
          <line
            x1={toX(hoverIdx)}
            y1={MT}
            x2={toX(hoverIdx)}
            y2={MT + cH}
            stroke="rgba(255,255,255,.12)"
            strokeWidth={1}
            strokeDasharray="2,3"
          />
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SEASON STATS TAB
// ---------------------------------------------------------------------------

function SeasonStatsTab({
  apiBase,
  profile,
  currentSeason,
}: {
  apiBase: string;
  profile: GridstreamTeamProfile;
  currentSeason: number;
}) {
  const [data, setData] = useState<GridstreamTeamSeasonStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGridstreamTeamSeasonStats(apiBase, profile.abbreviation)
      .then((d) => {
        if (!cancelled) setData([...d].reverse());
      }) // newest first
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation]);

  if (loading) return <LoadingMsg />;
  if (error) return <ErrorMsg msg={error} />;
  if (!data.length) return <EmptyMsg msg="No season stats available." />;

  const colStyle = (numeric: boolean): CSSProperties => ({
    padding: '9px 12px',
    borderBottom: '1px solid rgba(0,229,255,.07)',
    fontFamily: numeric ? "'JetBrains Mono', monospace" : undefined,
    fontSize: numeric ? 12 : 13,
    color: numeric ? '#9fc3db' : '#d9ecf9',
    whiteSpace: 'nowrap',
    textAlign: numeric ? 'right' : 'left',
  });

  const thStyle = (numeric: boolean): CSSProperties => ({
    padding: '10px 12px',
    borderBottom: '1px solid rgba(0,229,255,.15)',
    fontSize: 10,
    letterSpacing: '.08em',
    fontFamily: "'Orbitron', monospace",
    fontWeight: 700,
    color: '#78a3c1',
    whiteSpace: 'nowrap',
    textAlign: numeric ? 'right' : 'left',
    cursor: 'default',
  });

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: 'rgba(0,18,38,.56)',
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
        <thead>
          <tr>
            {[
              ['SEASON', false],
              ['W-L', false],
              ['PF', true],
              ['PA', true],
              ['DIFF', true],
              ['PPG', true],
              ['DPPG', true],
              ['PASS/G', true],
              ['RUSH/G', true],
              ['SACKS/G', true],
              ['3D%', true],
              ['RZ%', true],
              ['OFF EPA', true],
              ['SEED', true],
            ].map(([label, num]) => (
              <th key={label as string} style={thStyle(num as boolean)}>
                {label as string}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const isCurrent = row.season === currentSeason;
            const rowBg = isCurrent ? 'rgba(0,229,255,.06)' : undefined;
            const diffColor = (row.pointDiff ?? 0) >= 0 ? '#8fff45' : '#ff627e';

            return (
              <tr key={row.season} style={{ background: rowBg }}>
                <td
                  style={{
                    ...colStyle(false),
                    fontWeight: isCurrent ? 700 : undefined,
                    color: isCurrent ? '#00e5ff' : '#d9ecf9',
                  }}
                >
                  {row.season}
                </td>
                <td style={colStyle(false)}>{formatTeamRecord(row.wins, row.losses, row.ties)}</td>
                <td style={{ ...colStyle(true) }}>{row.pointsFor}</td>
                <td style={{ ...colStyle(true) }}>{row.pointsAgainst}</td>
                <td style={{ ...colStyle(true), color: diffColor }}>
                  {row.pointDiff != null
                    ? row.pointDiff > 0
                      ? `+${row.pointDiff}`
                      : String(row.pointDiff)
                    : '—'}
                </td>
                <td style={colStyle(true)}>{row.ppg.toFixed(1)}</td>
                <td style={colStyle(true)}>{row.papg.toFixed(1)}</td>
                <td style={colStyle(true)}>{row.passYdsPg.toFixed(0)}</td>
                <td style={colStyle(true)}>{row.rushYdsPg.toFixed(0)}</td>
                <td style={colStyle(true)}>{row.sacksPg.toFixed(1)}</td>
                <td style={colStyle(true)}>{row.thirdDownPct.toFixed(1)}%</td>
                <td style={colStyle(true)}>{row.redzonePct.toFixed(1)}%</td>
                <td
                  style={{
                    ...colStyle(true),
                    color:
                      row.offEpaPg != null
                        ? row.offEpaPg >= 0
                          ? '#8fff45'
                          : '#ff627e'
                        : '#9fc3db',
                  }}
                >
                  {row.offEpaPg != null
                    ? row.offEpaPg > 0
                      ? `+${row.offEpaPg.toFixed(2)}`
                      : row.offEpaPg.toFixed(2)
                    : '—'}
                </td>
                <td style={colStyle(true)}>{row.seed != null ? `#${row.seed}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROSTER TAB
// ---------------------------------------------------------------------------

const POSITION_GROUP_LABELS: Record<string, string> = {
  QB: 'Quarterback',
  RB: 'Running Back',
  WR: 'Wide Receiver',
  TE: 'Tight End',
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  LB: 'Linebacker',
  DB: 'Defensive Back',
  K: 'Special Teams',
  P: 'Special Teams',
  LS: 'Special Teams',
  ST: 'Special Teams',
};

const ROSTER_STATUS_LABEL: Record<string, string> = {
  ACT: 'ACTIVE',
  DEV: 'PRACTICE SQUAD',
  PRA: 'PRACTICE SQUAD',
  RES: 'IR / RESERVE',
  RSR: 'IR / RESERVE',
  RSN: 'RESERVE-NF',
  PUP: 'PUP',
  NFI: 'NFI',
};

type DepthChartSectionKey = 'offense' | 'defense' | 'specialTeams' | 'reserves';
type DepthChartLegendKey = 'acquired' | 'reSigned' | 'ufa' | 'rfa' | 'erfa' | 'released';

interface DepthChartPlayerTone {
  text: string;
  background: string;
  border: string;
  badgeBackground: string;
  badgeText: string;
  badgeLabel: string | null;
  legendKey: DepthChartLegendKey | null;
  legendLabel: string | null;
}

interface DepthChartLegendItem {
  key: DepthChartLegendKey;
  label: string;
  badgeLabel: string;
  color: string;
  background: string;
  border: string;
}

interface DepthChartRow {
  slot: string;
  label: string;
  players: Array<GridstreamRosterPlayer | null>;
  totalPlayers: number;
}

interface DepthChartSection {
  key: DepthChartSectionKey;
  title: string;
  subtitle: string;
  rows: DepthChartRow[];
  playerCount: number;
}

const MAX_DEPTH_COLUMNS = 6;

const OFFENSE_SLOT_ORDER = [
  'QB',
  'RB',
  'TE',
  'FB',
  'LWR',
  'SWR',
  'RWR',
  'WR',
  'LT',
  'LG',
  'C',
  'RG',
  'RT',
  'OT',
  'OG',
] as const;

const DEFENSE_SLOT_ORDER = [
  'LDE',
  'RDE',
  'DE',
  'ED',
  'NT',
  'LDT',
  'DT',
  'RDT',
  'LOLB',
  'WLB',
  'MLB',
  'ILB',
  'SLB',
  'ROLB',
  'LB',
  'LCB',
  'SS',
  'FS',
  'RCB',
  'NB',
  'CB',
  'S',
] as const;

const SPECIAL_TEAMS_SLOT_ORDER = ['PK', 'PT', 'H', 'KO', 'LS', 'KR', 'PR'] as const;

const RESERVE_SLOT_ORDER = [
  'QB',
  'RB',
  'WR',
  'TE',
  'OL',
  'DL',
  'ED',
  'LB',
  'CB',
  'S',
  'K',
  'P',
  'LS',
  'ST',
] as const;

const OFFENSE_SLOT_SET = new Set<string>(OFFENSE_SLOT_ORDER);
const DEFENSE_SLOT_SET = new Set<string>(DEFENSE_SLOT_ORDER);
const SPECIAL_TEAMS_SLOT_SET = new Set<string>(SPECIAL_TEAMS_SLOT_ORDER);

const OFFENSE_GROUPS = new Set(['QB', 'RB', 'WR', 'TE', 'OL', 'C', 'G', 'T', 'OT', 'OG']);
const DEFENSE_GROUPS = new Set([
  'DL',
  'DE',
  'DT',
  'NT',
  'EDGE',
  'ED',
  'LB',
  'OLB',
  'ILB',
  'MLB',
  'CB',
  'S',
  'FS',
  'SS',
  'DB',
]);
const SPECIAL_TEAMS_GROUPS = new Set(['K', 'P', 'LS', 'ST']);
const DEPTH_SLOT_DISPLAY_LABEL: Record<string, string> = {
  PK: 'K',
  PT: 'P',
};

const DEPTH_CHART_SECTION_META: Record<
  DepthChartSectionKey,
  { title: string; subtitle: string; order: readonly string[] }
> = {
  offense: {
    title: 'Offense',
    subtitle: 'Starter-to-backup offensive depth',
    order: OFFENSE_SLOT_ORDER,
  },
  defense: {
    title: 'Defense',
    subtitle: 'Front seven and secondary alignment',
    order: DEFENSE_SLOT_ORDER,
  },
  specialTeams: {
    title: 'Special Teams',
    subtitle: 'Kicking, return, and specialist depth',
    order: SPECIAL_TEAMS_SLOT_ORDER,
  },
  reserves: {
    title: 'Reserves',
    subtitle: 'Players without a current primary slot',
    order: RESERVE_SLOT_ORDER,
  },
};

const DEPTH_LEGEND_ACQUIRED: DepthChartLegendItem = {
  key: 'acquired',
  label: 'Acquired via FA or trade in 2026',
  badgeLabel: 'ACQUIRED',
  color: '#78e6ff',
  background: 'rgba(56,189,248,.16)',
  border: 'rgba(56,189,248,.34)',
};

const DEPTH_LEGEND_RE_SIGNED: DepthChartLegendItem = {
  key: 'reSigned',
  label: 'Re-signed with team in 2026',
  badgeLabel: 'RE-SIGNED',
  color: '#8fff45',
  background: 'rgba(143,255,69,.16)',
  border: 'rgba(143,255,69,.34)',
};

const DEPTH_LEGEND_UFA: DepthChartLegendItem = {
  key: 'ufa',
  label: 'UFA',
  badgeLabel: 'UFA',
  color: '#ffb866',
  background: 'rgba(255,152,0,.16)',
  border: 'rgba(255,152,0,.34)',
};

const DEPTH_LEGEND_RFA: DepthChartLegendItem = {
  key: 'rfa',
  label: 'RFA',
  badgeLabel: 'RFA',
  color: '#8bc7ff',
  background: 'rgba(59,130,246,.15)',
  border: 'rgba(59,130,246,.32)',
};

const DEPTH_LEGEND_ERFA: DepthChartLegendItem = {
  key: 'erfa',
  label: 'ERFA',
  badgeLabel: 'ERFA',
  color: '#d7c2ff',
  background: 'rgba(139,92,246,.14)',
  border: 'rgba(139,92,246,.3)',
};

const DEPTH_LEGEND_RELEASED: DepthChartLegendItem = {
  key: 'released',
  label: 'Cut / released',
  badgeLabel: 'CUT',
  color: '#ff7b8f',
  background: 'rgba(244,63,94,.18)',
  border: 'rgba(244,63,94,.34)',
};

const DEPTH_CHART_LEGEND_ITEMS: DepthChartLegendItem[] = [
  DEPTH_LEGEND_ACQUIRED,
  DEPTH_LEGEND_RE_SIGNED,
  DEPTH_LEGEND_UFA,
  DEPTH_LEGEND_RFA,
  DEPTH_LEGEND_ERFA,
  DEPTH_LEGEND_RELEASED,
];

function getDepthChartLegendItem(key: DepthChartLegendKey): DepthChartLegendItem {
  switch (key) {
    case 'acquired':
      return DEPTH_LEGEND_ACQUIRED;
    case 'reSigned':
      return DEPTH_LEGEND_RE_SIGNED;
    case 'ufa':
      return DEPTH_LEGEND_UFA;
    case 'rfa':
      return DEPTH_LEGEND_RFA;
    case 'erfa':
      return DEPTH_LEGEND_ERFA;
    case 'released':
      return DEPTH_LEGEND_RELEASED;
  }
}

function normalizeDepthToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function resolveFreeAgencyLegendKey(value: string | null | undefined): DepthChartLegendKey | null {
  const token = normalizeDepthToken(value);
  if (!token) return null;
  if (token === 'ACQUIRED_FA_OR_TRADE' || token === 'ACQUIRED_FA_OR_TRADE_2026') {
    return 'acquired';
  }
  if (token === 'RE_SIGNED' || token === 'RE_SIGNED_2026') {
    return 'reSigned';
  }
  if (token === 'UFA') return 'ufa';
  if (token === 'RFA') return 'rfa';
  if (token === 'ERFA') return 'erfa';
  if (token === 'RELEASED' || token === 'CUT' || token === 'WAIVED' || token === 'WAIVED_INJURED') {
    return 'released';
  }
  return null;
}

function normalizeDepthSlotForSection(
  section: DepthChartSectionKey,
  value: string | null | undefined
): string {
  const token = normalizeDepthToken(value);
  if (!token || token === 'FUT') return '';

  if (section === 'offense') {
    if (token === 'T') return 'OT';
    if (token === 'G') return 'OG';
    return token;
  }

  if (section === 'defense') {
    if (token === 'EDGE') return 'ED';
    if (token === 'DB') return 'CB';
    return token;
  }

  if (section === 'specialTeams') {
    if (token === 'K') return 'PK';
    if (token === 'P') return 'PT';
    return token;
  }

  if (token === 'EDGE') return 'ED';
  if (token === 'DB') return 'CB';
  if (token === 'OT' || token === 'OG') return 'OL';
  if (token === 'C' || token === 'G' || token === 'T') return 'OL';
  if (token === 'DE' || token === 'DT' || token === 'NT') return 'DL';
  if (token === 'FS' || token === 'SS') return 'S';
  if (token === 'KO') return 'K';
  if (token === 'KR' || token === 'PR') return 'ST';
  return token;
}

function resolveDepthSection(player: GridstreamRosterPlayer): DepthChartSectionKey {
  const depthSlot = normalizeDepthToken(player.depthChartPosition);
  const position = normalizeDepthToken(player.position);
  const positionGroup = normalizeDepthToken(player.positionGroup);

  if (depthSlot === 'FUT') return 'reserves';

  if (depthSlot) {
    if (OFFENSE_SLOT_SET.has(depthSlot)) return 'offense';
    if (DEFENSE_SLOT_SET.has(depthSlot)) return 'defense';
    if (SPECIAL_TEAMS_SLOT_SET.has(depthSlot) || depthSlot === 'K' || depthSlot === 'P') {
      return 'specialTeams';
    }
  }

  if (position && SPECIAL_TEAMS_GROUPS.has(position)) return 'specialTeams';
  if (positionGroup && SPECIAL_TEAMS_GROUPS.has(positionGroup)) return 'specialTeams';
  if (position && OFFENSE_GROUPS.has(position)) return 'offense';
  if (positionGroup && OFFENSE_GROUPS.has(positionGroup)) return 'offense';
  if (position && DEFENSE_GROUPS.has(position)) return 'defense';
  if (positionGroup && DEFENSE_GROUPS.has(positionGroup)) return 'defense';

  return 'reserves';
}

function resolveDepthRowKey(player: GridstreamRosterPlayer, section: DepthChartSectionKey): string {
  const fromDepth = normalizeDepthSlotForSection(section, player.depthChartPosition);
  if (fromDepth) return fromDepth;

  const fromPosition = normalizeDepthSlotForSection(section, player.position);
  if (fromPosition) return fromPosition;

  const fromGroup = normalizeDepthSlotForSection(section, player.positionGroup);
  if (fromGroup) return fromGroup;

  return 'OTHER';
}

function depthRowLabel(slot: string): string {
  return DEPTH_SLOT_DISPLAY_LABEL[slot] ?? slot;
}

function compareRosterPlayers(a: GridstreamRosterPlayer, b: GridstreamRosterPlayer): number {
  const rankA = a.depthChartRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.depthChartRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  const jerseyA = Number.parseInt(a.jerseyNumber ?? '999', 10);
  const jerseyB = Number.parseInt(b.jerseyNumber ?? '999', 10);
  if (Number.isFinite(jerseyA) && Number.isFinite(jerseyB) && jerseyA !== jerseyB) {
    return jerseyA - jerseyB;
  }

  return a.displayName.localeCompare(b.displayName);
}

function buildDepthColumns(
  players: GridstreamRosterPlayer[]
): Array<GridstreamRosterPlayer | null> {
  const ordered = [...players].sort(compareRosterPlayers);
  const columns: Array<GridstreamRosterPlayer | null> = [];
  const overflow: GridstreamRosterPlayer[] = [];

  for (const player of ordered) {
    const rank = player.depthChartRank ?? null;
    if (rank != null && rank > 0) {
      const index = rank - 1;
      while (columns.length <= index) columns.push(null);
      if (columns[index] == null) {
        columns[index] = player;
        continue;
      }
    }
    overflow.push(player);
  }

  for (const player of overflow) {
    const openIndex = columns.findIndex((cell) => cell == null);
    if (openIndex >= 0) columns[openIndex] = player;
    else columns.push(player);
  }

  return columns;
}

function compareDepthRowKeys(section: DepthChartSectionKey, a: string, b: string): number {
  const order = DEPTH_CHART_SECTION_META[section].order;
  const indexA = order.indexOf(a);
  const indexB = order.indexOf(b);
  const normalizedA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
  const normalizedB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
  if (normalizedA !== normalizedB) return normalizedA - normalizedB;
  return a.localeCompare(b);
}

function buildDepthChartSections(players: GridstreamRosterPlayer[]): DepthChartSection[] {
  const grouped = new Map<DepthChartSectionKey, Map<string, GridstreamRosterPlayer[]>>();

  for (const player of players) {
    const section = resolveDepthSection(player);
    const rowKey = resolveDepthRowKey(player, section);
    if (!grouped.has(section)) grouped.set(section, new Map<string, GridstreamRosterPlayer[]>());

    const rows = grouped.get(section);
    if (!rows) continue;
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey)?.push(player);
  }

  return (Object.keys(DEPTH_CHART_SECTION_META) as DepthChartSectionKey[])
    .map((section) => {
      const rows = grouped.get(section);
      if (!rows || rows.size === 0) return null;

      const orderedRowKeys = [...rows.keys()].sort((a, b) => compareDepthRowKeys(section, a, b));
      const chartRows = orderedRowKeys.map((slot) => {
        const rowPlayers = rows.get(slot) ?? [];
        const columns = buildDepthColumns(rowPlayers);
        return {
          slot,
          label: depthRowLabel(slot),
          players: columns,
          totalPlayers: rowPlayers.length,
        } satisfies DepthChartRow;
      });

      return {
        key: section,
        title: DEPTH_CHART_SECTION_META[section].title,
        subtitle: DEPTH_CHART_SECTION_META[section].subtitle,
        rows: chartRows,
        playerCount: chartRows.reduce((sum, row) => sum + row.totalPlayers, 0),
      } satisfies DepthChartSection;
    })
    .filter((section): section is DepthChartSection => section != null);
}

function resolveDepthChartTone(player: GridstreamRosterPlayer): DepthChartPlayerTone {
  const legendKey = resolveFreeAgencyLegendKey(player.freeAgencyStatus ?? player.depthChartStatus);
  if (legendKey) {
    const item = getDepthChartLegendItem(legendKey);
    return {
      text: '#f4fbff',
      background: item.background,
      border: item.border,
      badgeBackground: item.background,
      badgeText: item.color,
      badgeLabel: item.badgeLabel,
      legendKey: item.key,
      legendLabel: item.label,
    };
  }

  return {
    text: '#f4fbff',
    background: 'rgba(255,255,255,.02)',
    border: 'rgba(255,255,255,.08)',
    badgeBackground: 'rgba(159,195,219,.12)',
    badgeText: '#9fc3db',
    badgeLabel: null,
    legendKey: null,
    legendLabel: null,
  };
}

function resolveTrackerEntryTone(
  entry: GridstreamTeamFreeAgentTrackerEntry
): DepthChartLegendItem | null {
  const teamAbbr = normalizeDepthToken(entry.team?.abbreviation);
  const signedWithAbbr = normalizeDepthToken(entry.signedWithTeam?.abbreviation);

  if (teamAbbr && signedWithAbbr && teamAbbr === signedWithAbbr) {
    return DEPTH_LEGEND_RE_SIGNED;
  }

  if (!signedWithAbbr) {
    const key = resolveFreeAgencyLegendKey(entry.faType);
    return key ? getDepthChartLegendItem(key) : null;
  }

  return null;
}

function renderTeamReference(team: GridstreamTeamReference | null | undefined): string {
  if (!team) return '—';
  return team.shortDisplayName || team.displayName || team.abbreviation || '—';
}

function renderTrackerTeamCell(team: GridstreamTeamReference | null | undefined) {
  if (!team) {
    return <span style={{ color: C.textMuted }}>—</span>;
  }

  const label = renderTeamReference(team);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      {team.logoUrl ? (
        <Image
          src={team.logoUrl}
          alt={label}
          width={18}
          height={18}
          unoptimized
          loader={remoteImageLoader}
          style={{
            objectFit: 'contain',
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            background: 'rgba(255,255,255,.08)',
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          color: '#f4fbff',
          fontSize: 12,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function formatCompactDollars(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const formatUnit = (divisor: number, suffix: string) => {
    const normalized = value / divisor;
    const rounded = Math.abs(normalized) >= 10 ? normalized.toFixed(0) : normalized.toFixed(1);
    return `$${rounded.replace(/\.0$/, '')}${suffix}`;
  };

  if (abs >= 1_000_000_000) return formatUnit(1_000_000_000, 'B');
  if (abs >= 1_000_000) return formatUnit(1_000_000, 'M');
  if (abs >= 1_000) return formatUnit(1_000, 'K');
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function formatTrackerContractSummary(
  contract: GridstreamTeamFreeAgentTrackerEntry['contractDetail']
): string | null {
  if (!contract) return null;
  const years =
    contract.years != null && contract.years > 0
      ? `${contract.years} yr${contract.years === 1 ? '' : 's'}`
      : null;
  const totalValue = formatCompactDollars(contract.totalValue);
  const guaranteed = formatCompactDollars(contract.guaranteed);
  const apy = formatCompactDollars(contract.apy);

  if (years && totalValue) {
    if (guaranteed) return `${years} / ${totalValue} (${guaranteed} gtd)`;
    if (apy) return `${years} / ${totalValue} (${apy} APY)`;
    return `${years} / ${totalValue}`;
  }

  return totalValue ?? guaranteed ?? apy;
}

function formatContractChangeSummary(change: GridstreamTeamContractChange): string | null {
  return formatTrackerContractSummary({
    yearSigned: change.yearSigned,
    years: change.years,
    totalValue: change.totalValue,
    apy: change.apy,
    guaranteed: change.guaranteed,
    isActive: change.isActive,
    otcUrl: change.otcUrl,
  });
}

function formatFreeAgencyDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatScheduleDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const year = String(parsed.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function normalizeFreeAgencyPersonKey(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const reordered = raw.includes(',')
    ? raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .reverse()
        .join(' ')
    : raw;
  return reordered.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function renderCapHighlightedNote(value: string | null | undefined) {
  const text = String(value ?? '').trim();
  if (!text) return '—';

  return text.split(/(\$[0-9]+(?:\.[0-9]+)?[KMB]?)/g).map((part, index) => {
    if (!part) return null;
    if (/^\$[0-9]+(?:\.[0-9]+)?[KMB]?$/i.test(part)) {
      return (
        <span key={`money-${index}`} style={{ color: '#8fff45', fontWeight: 700 }}>
          {part}
        </span>
      );
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
}

function formatTransactionBadgeLabel(transactionType: string | null | undefined): string {
  const token = normalizeDepthToken(transactionType);
  if (token === 'WAIVED_INJURED') return 'WAIVED INJ';
  if (token) return token.replace(/_/g, ' ');
  return 'CUT';
}

function resolveCutTransactionTone(
  row: GridstreamTeamFreeAgencyTransaction
): DepthChartLegendItem | null {
  const token = normalizeDepthToken(row.transactionType);
  if (!token) return null;
  if (token === 'RELEASED' || token === 'CUT' || token === 'WAIVED' || token === 'WAIVED_INJURED') {
    return DEPTH_LEGEND_RELEASED;
  }
  return null;
}

function formatRosterBadge(player: GridstreamRosterPlayer): string | null {
  const rosterStatus = normalizeDepthToken(player.rosterStatus);
  if (!rosterStatus || rosterStatus === 'ACT' || rosterStatus === 'INA') return null;

  const activeOffseasonStatus = resolveFreeAgencyLegendKey(
    player.freeAgencyStatus ?? player.depthChartStatus
  );
  const isLegacyFreeAgencyRosterCode =
    rosterStatus === 'UFA' ||
    rosterStatus === 'RFA' ||
    rosterStatus === 'ERFA' ||
    rosterStatus === 'CUT' ||
    rosterStatus === 'RELEASED' ||
    rosterStatus === 'WAIVED' ||
    rosterStatus === 'WAIVED_INJURED';

  if (activeOffseasonStatus && isLegacyFreeAgencyRosterCode) {
    return null;
  }

  return ROSTER_STATUS_LABEL[rosterStatus] ?? player.rosterStatusDisplay ?? rosterStatus;
}

function formatDepthMetadata(player: GridstreamRosterPlayer): string {
  const parts = [
    player.jerseyNumber ? `#${player.jerseyNumber}` : null,
    player.position || null,
    player.yearsExperience != null
      ? player.yearsExperience === 0
        ? 'R'
        : `Y${player.yearsExperience}`
      : null,
    player.heightFt && player.weightLbs != null ? `${player.heightFt}/${player.weightLbs}` : null,
  ].filter(Boolean);

  return parts.join(' • ');
}

function depthColumnLabel(index: number): string {
  if (index === 0) return 'Starter';
  if (index === 1) return '2nd';
  if (index === 2) return '3rd';
  if (index === 3) return '4th';
  if (index === 4) return '5th';
  const rank = index + 1;
  return `${rank}th`;
}

function RosterTab({
  apiBase,
  profile,
  onOpenPlayerQuickView,
}: {
  apiBase: string;
  profile: GridstreamTeamProfile;
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
}) {
  const [roster, setRoster] = useState<GridstreamRosterPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGridstreamTeamRoster(apiBase, profile.abbreviation)
      .then((r) => {
        if (!cancelled) setRoster(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation]);

  const accent = `#${profile.colorPrimary}`;
  const sections = useMemo(() => buildDepthChartSections(roster), [roster]);
  const legendItems = DEPTH_CHART_LEGEND_ITEMS;

  if (loading) return <LoadingMsg />;
  if (error) return <ErrorMsg msg={error} />;
  if (!roster.length) return <EmptyMsg msg="No active roster data available." />;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section
        style={{
          border: `1px solid ${C.border}`,
          background: 'linear-gradient(180deg, rgba(0,18,38,.78) 0%, rgba(0,10,24,.52) 100%)',
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: 4,
            }}
          >
            <span
              style={{
                color: accent,
                fontSize: 11,
                fontFamily: "'Orbitron', monospace",
                letterSpacing: '.1em',
              }}
            >
              DEPTH CHART VIEW
            </span>
          </div>
          <div
            style={{
              color: C.textMuted,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
            }}
          >
            {roster.length} players
          </div>
        </div>

        {legendItems.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 14,
            }}
          >
            {legendItems.map((item) => (
              <div
                key={item.key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  border: `1px solid ${item.border}`,
                  background: item.background,
                  color: item.color,
                  fontSize: 10,
                  fontFamily: "'Orbitron', monospace",
                  letterSpacing: '.06em',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: item.color,
                    boxShadow: `0 0 10px ${item.color}55`,
                  }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {sections.map((section) => {
        const columnCount = Math.max(
          2,
          Math.min(
            MAX_DEPTH_COLUMNS,
            section.rows.reduce((max, row) => Math.max(max, row.players.length), 0)
          )
        );

        return (
          <section key={section.key}>
            <div
              style={{
                padding: '9px 14px',
                background: 'rgba(0,18,38,.84)',
                border: `1px solid rgba(0,229,255,.15)`,
                borderLeft: `3px solid ${accent}`,
                marginBottom: 4,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'grid', gap: 2 }}>
                <span
                  style={{
                    color: '#d9ecf9',
                    fontSize: 11,
                    fontFamily: "'Orbitron', monospace",
                    letterSpacing: '.1em',
                  }}
                >
                  {section.title}
                </span>
                <span style={{ color: C.textMuted, fontSize: 11 }}>{section.subtitle}</span>
              </div>
              <span
                style={{
                  color: C.textMuted,
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {section.playerCount} players
              </span>
            </div>

            <div
              style={{
                border: `1px solid ${C.border}`,
                background: 'rgba(0,12,28,.5)',
                overflowX: 'auto',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: 320 + columnCount * 170,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid rgba(0,229,255,.12)',
                        fontSize: 10,
                        letterSpacing: '.08em',
                        fontFamily: "'Orbitron', monospace",
                        fontWeight: 700,
                        color: '#78a3c1',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        width: 88,
                      }}
                    >
                      POS
                    </th>
                    {Array.from({ length: columnCount }, (_, index) => (
                      <th
                        key={`${section.key}-${index}`}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid rgba(0,229,255,.12)',
                          fontSize: 10,
                          letterSpacing: '.08em',
                          fontFamily: "'Orbitron', monospace",
                          fontWeight: 700,
                          color: '#78a3c1',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {depthColumnLabel(index).toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, idx) => (
                    <tr
                      key={`${section.key}-${row.slot}`}
                      style={{ background: idx % 2 === 0 ? 'rgba(0,229,255,.02)' : undefined }}
                    >
                      <td
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid rgba(0,229,255,.05)',
                          verticalAlign: 'top',
                        }}
                      >
                        <div
                          style={{
                            color: '#d9ecf9',
                            fontSize: 13,
                            fontFamily: "'Orbitron', monospace",
                            letterSpacing: '.08em',
                          }}
                        >
                          {row.label}
                        </div>
                        {section.key === 'reserves' && (
                          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 4 }}>
                            {POSITION_GROUP_LABELS[row.label] ??
                              POSITION_GROUP_LABELS[row.slot] ??
                              ''}
                          </div>
                        )}
                      </td>
                      {Array.from({ length: columnCount }, (_, cellIndex) => {
                        const player = row.players[cellIndex] ?? null;
                        if (!player) {
                          return (
                            <td
                              key={`${row.slot}-${cellIndex}`}
                              style={{
                                padding: '10px 12px',
                                borderBottom: '1px solid rgba(0,229,255,.05)',
                                color: 'rgba(159,195,219,.45)',
                                fontSize: 12,
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              —
                            </td>
                          );
                        }

                        const tone = resolveDepthChartTone(player);
                        const rosterBadge = formatRosterBadge(player);
                        const toneBadge = tone.badgeLabel;
                        const metadata = formatDepthMetadata(player);

                        return (
                          <td
                            key={`${row.slot}-${player.id}-${cellIndex}`}
                            style={{
                              padding: '10px 12px',
                              borderBottom: '1px solid rgba(0,229,255,.05)',
                              verticalAlign: 'top',
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gap: 8,
                                padding: '10px 12px',
                                border: `1px solid ${tone.border}`,
                                background: tone.background,
                                minHeight: 88,
                              }}
                            >
                              <div style={{ display: 'grid', gap: 4 }}>
                                <PlayerQuickViewTrigger
                                  playerId={player.id}
                                  playerName={player.displayName}
                                  onOpen={onOpenPlayerQuickView}
                                  style={{
                                    color: tone.text,
                                    fontWeight: 700,
                                    fontSize: 14,
                                    lineHeight: 1.25,
                                    textDecoration: 'none',
                                  }}
                                >
                                  {player.displayName}
                                </PlayerQuickViewTrigger>
                                <div
                                  style={{
                                    color: C.textSecondary,
                                    fontSize: 11,
                                    fontFamily: "'JetBrains Mono', monospace",
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {metadata || '—'}
                                </div>
                              </div>

                              {(toneBadge || rosterBadge) && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  {toneBadge && (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        padding: '4px 7px',
                                        border: `1px solid ${tone.border}`,
                                        background: tone.badgeBackground,
                                        color: tone.badgeText,
                                        fontSize: 9,
                                        fontFamily: "'Orbitron', monospace",
                                        letterSpacing: '.06em',
                                      }}
                                    >
                                      {toneBadge}
                                    </span>
                                  )}
                                  {rosterBadge && (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        padding: '4px 7px',
                                        border: '1px solid rgba(159,195,219,.16)',
                                        background: 'rgba(159,195,219,.08)',
                                        color: C.textMuted,
                                        fontSize: 9,
                                        fontFamily: "'Orbitron', monospace",
                                        letterSpacing: '.06em',
                                      }}
                                    >
                                      {rosterBadge}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FreeAgencySection({
  accent,
  title,
  subtitle,
  count,
  children,
}: {
  accent: string;
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          padding: '9px 14px',
          background: 'rgba(0,18,38,.84)',
          border: `1px solid rgba(0,229,255,.15)`,
          borderLeft: `3px solid ${accent}`,
          marginBottom: 4,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <span
            style={{
              color: '#d9ecf9',
              fontSize: 11,
              fontFamily: "'Orbitron', monospace",
              letterSpacing: '.1em',
            }}
          >
            {title}
          </span>
          <span style={{ color: C.textMuted, fontSize: 11 }}>{subtitle}</span>
        </div>
        <span
          style={{
            color: C.textMuted,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {count} entries
        </span>
      </div>
      {children}
    </section>
  );
}

function FreeAgencyTrackerTable({
  rows,
  mode,
  currentTeamLabel,
  cutsByPlayerKey,
  signedElsewhereByPlayerKey,
  onOpenPlayerQuickView,
}: {
  rows: GridstreamTeamFreeAgentTrackerEntry[];
  mode: 'incoming' | 'outgoing';
  currentTeamLabel: string;
  cutsByPlayerKey?: Map<string, GridstreamTeamFreeAgencyTransaction>;
  signedElsewhereByPlayerKey?: Map<string, GridstreamTeamFreeAgencyTransaction>;
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
}) {
  if (!rows.length) {
    return (
      <div
        style={{
          border: `1px solid ${C.border}`,
          background: 'rgba(0,12,28,.5)',
          padding: '14px 16px',
          color: C.textMuted,
          fontSize: 12,
        }}
      >
        {mode === 'incoming'
          ? `No incoming free-agent acquisitions logged for ${currentTeamLabel} yet.`
          : `No outgoing free-agent tracker rows for ${currentTeamLabel} yet.`}
      </div>
    );
  }

  const headings =
    mode === 'incoming'
      ? ['Player', 'From', 'Pos', 'FA Type', 'Signed With']
      : ['Player', 'Team', 'Pos', 'FA Type', 'Signed With'];

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: 'rgba(0,12,28,.5)',
        overflowX: 'auto',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: 900,
        }}
      >
        <thead>
          <tr>
            {headings.map((label) => (
              <th
                key={label}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid rgba(0,229,255,.12)',
                  fontSize: 10,
                  letterSpacing: '.08em',
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: 700,
                  color: '#78a3c1',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry, index) => {
            const playerKey =
              entry.playerId != null
                ? `id:${entry.playerId}`
                : `name:${normalizeFreeAgencyPersonKey(entry.playerName)}`;
            const relatedCut = cutsByPlayerKey?.get(playerKey) ?? null;
            const relatedSignedElsewhere = signedElsewhereByPlayerKey?.get(playerKey) ?? null;
            const tone =
              mode === 'incoming'
                ? DEPTH_LEGEND_ACQUIRED
                : relatedCut
                  ? DEPTH_LEGEND_RELEASED
                  : resolveTrackerEntryTone(entry);
            const contractSummary = formatTrackerContractSummary(entry.contractDetail);
            const signedWithTeam = entry.signedWithTeam ?? relatedSignedElsewhere?.toTeam ?? null;

            return (
              <tr
                key={`${mode}-${entry.id ?? `${entry.playerName}-${index}`}`}
                style={{ background: index % 2 === 0 ? 'rgba(0,229,255,.02)' : 'transparent' }}
              >
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    borderLeft: tone ? `3px solid ${tone.color}` : '3px solid transparent',
                    background: tone ? tone.background : undefined,
                    verticalAlign: 'middle',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <PlayerQuickViewTrigger
                      playerId={entry.playerId}
                      playerName={entry.playerName}
                      onOpen={onOpenPlayerQuickView}
                      style={{
                        color: '#f4fbff',
                        fontWeight: 700,
                        fontSize: 13,
                        lineHeight: 1.2,
                        textDecoration: 'none',
                      }}
                    >
                      {entry.playerName}
                    </PlayerQuickViewTrigger>
                    {tone && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 6px',
                          border: `1px solid ${tone.border}`,
                          background: tone.background,
                          color: tone.color,
                          fontSize: 8,
                          fontFamily: "'Orbitron', monospace",
                          letterSpacing: '.06em',
                          lineHeight: 1,
                        }}
                      >
                        {tone.badgeLabel}
                      </span>
                    )}
                  </div>
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap',
                    verticalAlign: 'middle',
                  }}
                >
                  {renderTrackerTeamCell(entry.team)}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: '#f4fbff',
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap',
                    verticalAlign: 'middle',
                  }}
                >
                  {entry.position || '—'}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: '#f4fbff',
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap',
                    verticalAlign: 'middle',
                  }}
                >
                  {relatedCut ? 'RELEASED' : entry.faType || '—'}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textSecondary,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    verticalAlign: 'middle',
                  }}
                >
                  <div style={{ display: 'grid', gap: contractSummary ? 3 : 0 }}>
                    {renderTrackerTeamCell(signedWithTeam)}
                    {contractSummary && (
                      <span
                        style={{
                          color: C.textMuted,
                          fontSize: 10,
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {contractSummary}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FreeAgencyCutsTable({
  rows,
  onOpenPlayerQuickView,
}: {
  rows: GridstreamTeamFreeAgencyTransaction[];
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
}) {
  if (!rows.length) {
    return (
      <div
        style={{
          border: `1px solid ${C.border}`,
          background: 'rgba(0,12,28,.5)',
          padding: '14px 16px',
          color: C.textMuted,
          fontSize: 12,
        }}
      >
        No cuts or waivers logged in the current offseason window.
      </div>
    );
  }

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: 'rgba(0,12,28,.5)',
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr>
            {['Player', 'Pos', 'Date', 'Type', 'Notes'].map((label) => (
              <th
                key={label}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid rgba(0,229,255,.12)',
                  fontSize: 10,
                  letterSpacing: '.08em',
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: 700,
                  color: '#78a3c1',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const tone = resolveCutTransactionTone(row);
            const badgeLabel = formatTransactionBadgeLabel(row.transactionType);

            return (
              <tr
                key={`cut-${row.id ?? `${row.playerName}-${index}`}`}
                style={{ background: index % 2 === 0 ? 'rgba(0,229,255,.02)' : 'transparent' }}
              >
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    borderLeft: tone ? `3px solid ${tone.color}` : '3px solid transparent',
                    background: tone ? tone.background : undefined,
                    color: '#f4fbff',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <PlayerQuickViewTrigger
                      playerId={row.playerId}
                      playerName={row.playerName}
                      onOpen={onOpenPlayerQuickView}
                      style={{
                        color: '#f4fbff',
                        fontWeight: 700,
                        fontSize: 13,
                        lineHeight: 1.2,
                      }}
                    >
                      {row.playerName}
                    </PlayerQuickViewTrigger>
                    {tone && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 6px',
                          border: `1px solid ${tone.border}`,
                          background: tone.background,
                          color: tone.color,
                          fontSize: 8,
                          fontFamily: "'Orbitron', monospace",
                          letterSpacing: '.06em',
                          lineHeight: 1,
                        }}
                      >
                        {badgeLabel}
                      </span>
                    )}
                  </div>
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textSecondary,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {row.playerPosition || '—'}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textSecondary,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatFreeAgencyDate(row.date)}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: tone?.color ?? '#ff7b8f',
                    fontSize: 10,
                    fontFamily: "'Orbitron', monospace",
                    letterSpacing: '.06em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {badgeLabel}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textMuted,
                    fontSize: 11,
                    lineHeight: 1.3,
                  }}
                >
                  {renderCapHighlightedNote(row.description)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FreeAgencyContractChangesTable({
  rows,
  onOpenPlayerQuickView,
}: {
  rows: GridstreamTeamContractChange[];
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
}) {
  if (!rows.length) {
    return (
      <div
        style={{
          border: `1px solid ${C.border}`,
          background: 'rgba(0,12,28,.5)',
          padding: '14px 16px',
          color: C.textMuted,
          fontSize: 12,
        }}
      >
        No current-year extension or restructure-style contract changes surfaced in the current
        data.
      </div>
    );
  }

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: 'rgba(0,12,28,.5)',
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
        <thead>
          <tr>
            {['Player', 'Pos', 'Team', 'Year Signed', 'Contract'].map((label) => (
              <th
                key={label}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid rgba(0,229,255,.12)',
                  fontSize: 10,
                  letterSpacing: '.08em',
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: 700,
                  color: '#78a3c1',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const summary = formatContractChangeSummary(row);
            return (
              <tr
                key={`contract-${row.id ?? `${row.playerName}-${index}`}`}
                style={{ background: index % 2 === 0 ? 'rgba(0,229,255,.02)' : 'transparent' }}
              >
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: '#f4fbff',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  <PlayerQuickViewTrigger
                    playerId={row.playerId}
                    playerName={row.playerName}
                    onOpen={onOpenPlayerQuickView}
                    style={{
                      color: '#f4fbff',
                      fontWeight: 700,
                      fontSize: 13,
                      lineHeight: 1.2,
                    }}
                  >
                    {row.playerName}
                  </PlayerQuickViewTrigger>
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textSecondary,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {row.playerPosition || '—'}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {renderTrackerTeamCell(row.team)}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textSecondary,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.yearSigned ?? '—'}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(0,229,255,.05)',
                    color: C.textMuted,
                    fontSize: 11,
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {summary ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FreeAgencyTab({
  profile,
  tracker,
  loading,
  error,
  onOpenPlayerQuickView,
}: {
  profile: GridstreamTeamProfile;
  tracker: GridstreamTeamFreeAgentTrackerResponse | null;
  loading: boolean;
  error: string | null;
  onOpenPlayerQuickView: (
    playerId: string | number | null | undefined,
    playerName?: string | null
  ) => void;
}) {
  const accent = `#${profile.colorPrimary}`;
  const rows = tracker?.results ?? [];
  const incomingRows = tracker?.incomingResults ?? [];
  const cuts = tracker?.cuts ?? [];
  const signedElsewhere = tracker?.signedElsewhere ?? [];
  const contractChanges = tracker?.contractChanges ?? [];
  const totalEntries =
    rows.length +
    incomingRows.length +
    cuts.length +
    signedElsewhere.length +
    contractChanges.length;
  const sourceUrl = [...rows, ...incomingRows].find((entry) => entry.sourceUrl)?.sourceUrl ?? null;
  const hasAnyData = totalEntries > 0;
  const cutsByPlayerKey = useMemo(() => {
    const map = new Map<string, GridstreamTeamFreeAgencyTransaction>();
    for (const row of tracker?.cuts ?? []) {
      const keys = [
        row.playerId != null ? `id:${row.playerId}` : null,
        row.playerName ? `name:${normalizeFreeAgencyPersonKey(row.playerName)}` : null,
      ].filter((value): value is string => Boolean(value));
      for (const key of keys) {
        if (!map.has(key)) map.set(key, row);
      }
    }
    return map;
  }, [tracker?.cuts]);
  const signedElsewhereByPlayerKey = useMemo(() => {
    const map = new Map<string, GridstreamTeamFreeAgencyTransaction>();
    for (const row of tracker?.signedElsewhere ?? []) {
      const keys = [
        row.playerId != null ? `id:${row.playerId}` : null,
        row.playerName ? `name:${normalizeFreeAgencyPersonKey(row.playerName)}` : null,
      ].filter((value): value is string => Boolean(value));
      for (const key of keys) {
        if (!map.has(key)) map.set(key, row);
      }
    }
    return map;
  }, [tracker?.signedElsewhere]);

  if (loading) return <LoadingMsg />;
  if (error) return <ErrorMsg msg={error} />;
  if (!hasAnyData) return <EmptyMsg msg="No current free-agency activity available." />;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section
        style={{
          border: `1px solid ${C.border}`,
          background: 'linear-gradient(180deg, rgba(0,18,38,.78) 0%, rgba(0,10,24,.52) 100%)',
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <span
              style={{
                color: accent,
                fontSize: 11,
                fontFamily: "'Orbitron', monospace",
                letterSpacing: '.1em',
              }}
            >
              FREE AGENT TRACKER
            </span>
            <span style={{ color: C.textMuted, fontSize: 11 }}>
              {tracker?.season ?? 'Current'} offseason tracker for {profile.displayName}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                color: C.textMuted,
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'nowrap',
              }}
            >
              {totalEntries} events
            </span>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: C.linkCyan,
                  fontSize: 11,
                  textDecoration: 'none',
                  fontFamily: "'Orbitron', monospace",
                  letterSpacing: '.06em',
                }}
              >
                SOURCE: OURLADS
              </a>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 14,
          }}
        >
          {DEPTH_CHART_LEGEND_ITEMS.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                border: `1px solid ${item.border}`,
                background: item.background,
                color: item.color,
                fontSize: 10,
                fontFamily: "'Orbitron', monospace",
                letterSpacing: '.06em',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: item.color,
                  boxShadow: `0 0 10px ${item.color}55`,
                }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <FreeAgencySection
        accent={accent}
        title="INCOMING FREE AGENTS"
        subtitle="Players added from other clubs in the current offseason window"
        count={tracker?.incomingCount ?? incomingRows.length}
      >
        <FreeAgencyTrackerTable
          rows={incomingRows}
          mode="incoming"
          currentTeamLabel={profile.displayName}
          onOpenPlayerQuickView={onOpenPlayerQuickView}
        />
      </FreeAgencySection>

      <FreeAgencySection
        accent={accent}
        title="CUTS / WAIVERS"
        subtitle="Players released or waived in the current offseason window"
        count={tracker?.cutsCount ?? cuts.length}
      >
        <FreeAgencyCutsTable rows={cuts} onOpenPlayerQuickView={onOpenPlayerQuickView} />
      </FreeAgencySection>

      <FreeAgencySection
        accent={accent}
        title="OUTGOING FREE AGENTS"
        subtitle="Team free-agent tracker sourced from Ourlads"
        count={tracker?.count ?? rows.length}
      >
        <FreeAgencyTrackerTable
          rows={rows}
          mode="outgoing"
          currentTeamLabel={profile.displayName}
          cutsByPlayerKey={cutsByPlayerKey}
          signedElsewhereByPlayerKey={signedElsewhereByPlayerKey}
          onOpenPlayerQuickView={onOpenPlayerQuickView}
        />
      </FreeAgencySection>

      <FreeAgencySection
        accent={accent}
        title="CURRENT-YEAR CONTRACT CHANGES"
        subtitle="Current-year extensions, restructures, and renegotiated team deals"
        count={tracker?.contractChangesCount ?? contractChanges.length}
      >
        <FreeAgencyContractChangesTable
          rows={contractChanges}
          onOpenPlayerQuickView={onOpenPlayerQuickView}
        />
      </FreeAgencySection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCHEDULE TAB
// ---------------------------------------------------------------------------

const SEASONS_RANGE = Array.from({ length: 2025 - 2009 + 1 }, (_, i) => 2025 - i);

function ScheduleTab({
  apiBase,
  profile,
  currentSeason,
  opponentLogoByAbbr,
}: {
  apiBase: string;
  profile: GridstreamTeamProfile;
  currentSeason: number;
  opponentLogoByAbbr: Record<string, string>;
}) {
  const [selectedSeason, setSelectedSeason] = useState(currentSeason);
  const [gameLog, setGameLog] = useState<GridstreamTeamGameLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGridstreamTeamGameLog(apiBase, profile.abbreviation, selectedSeason)
      .then((log) => {
        if (!cancelled) setGameLog([...log].reverse());
      }) // oldest first
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation, selectedSeason]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Season picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            color: C.textMuted,
            fontSize: 11,
            fontFamily: "'Orbitron', monospace",
            letterSpacing: '.08em',
          }}
        >
          SEASON
        </span>
        <select
          value={selectedSeason}
          onChange={(e) => setSelectedSeason(Number(e.target.value))}
          style={{
            background: 'rgba(0,18,38,.8)',
            border: '1px solid rgba(0,229,255,.25)',
            color: '#d9ecf9',
            padding: '4px 10px',
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {SEASONS_RANGE.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingMsg />}
      {!loading && error && <ErrorMsg msg={error} />}
      {!loading && !error && !gameLog.length && (
        <EmptyMsg msg="No schedule data for this season." />
      )}

      {!loading && gameLog.length > 0 && (
        <div
          style={{
            border: `1px solid ${C.border}`,
            background: 'rgba(0,18,38,.56)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
            <thead>
              <tr>
                {[
                  ['WK', true],
                  ['DATE', true],
                  ['', false],
                  ['OPPONENT', false],
                  ['RESULT', true],
                  ['SCORE', true],
                  ['YDS', true],
                  ['PASS', true],
                  ['RUSH', true],
                  ['PASS A', true],
                  ['RUSH A', true],
                  ['TO', true],
                  ['OFF EPA', true],
                ].map(([lbl, center]) => (
                  <th
                    key={lbl as string}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid rgba(0,229,255,.15)',
                      fontSize: 10,
                      letterSpacing: '.08em',
                      fontFamily: "'Orbitron', monospace",
                      fontWeight: 700,
                      color: '#78a3c1',
                      textAlign: center ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lbl as string}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gameLog.map((g) => {
                const resultColor =
                  g.result === 'W' ? '#8fff45' : g.result === 'L' ? '#ff627e' : '#ffb612';
                const isPending = g.result == null;
                const oppLogo = opponentLogoByAbbr[g.opponentAbbr] ?? g.opponentLogo;
                return (
                  <tr
                    key={g.gameId}
                    style={{ opacity: isPending ? 0.55 : 1 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,229,255,.04)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ ...schedTd, textAlign: 'right' }}>
                      {g.isDivisionGame && (
                        <span
                          style={{
                            color: '#ffb612',
                            fontSize: 9,
                            marginRight: 4,
                            fontFamily: "'Orbitron', monospace",
                          }}
                        >
                          DIV
                        </span>
                      )}
                      <span style={{ color: C.textMuted }}>{g.week}</span>
                      {g.seasonType !== 'REG' && (
                        <span
                          style={{
                            color: C.accentCyan,
                            fontSize: 9,
                            marginLeft: 4,
                            fontFamily: "'Orbitron', monospace",
                          }}
                        >
                          {SEASON_TYPE_LABEL[g.seasonType] ?? g.seasonType}
                        </span>
                      )}
                    </td>
                    <td style={{ ...schedTdMono, color: C.textMuted }}>
                      {formatScheduleDate(g.gameDate)}
                    </td>
                    <td style={{ ...schedTd, textAlign: 'left', color: C.textMuted, fontSize: 10 }}>
                      {g.isHome ? 'vs' : '@'}
                    </td>
                    <td style={schedTd}>
                      <Link
                        href={`/gridstream/games/${g.gameId}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          textDecoration: 'none',
                        }}
                      >
                        {oppLogo && (
                          <Image
                            src={oppLogo}
                            alt=""
                            width={22}
                            height={22}
                            unoptimized
                            loader={remoteImageLoader}
                            style={{ objectFit: 'contain' }}
                          />
                        )}
                        <span style={{ color: '#f4fbff', fontWeight: 600, fontSize: 13 }}>
                          {g.opponentAbbr}
                        </span>
                      </Link>
                    </td>
                    <td
                      style={{
                        ...schedTd,
                        textAlign: 'right',
                        color: resultColor,
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                      }}
                    >
                      {g.result ?? '—'}
                    </td>
                    <td
                      style={{
                        ...schedTd,
                        textAlign: 'right',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        color: '#f4fbff',
                      }}
                    >
                      {g.result != null ? `${g.teamScore}–${g.oppScore}` : '—'}
                    </td>
                    <td style={schedTdMono}>{g.result != null ? g.totalYards : '—'}</td>
                    <td style={schedTdMono}>{g.result != null ? g.passYards : '—'}</td>
                    <td style={schedTdMono}>{g.result != null ? g.rushYards : '—'}</td>
                    <td style={schedTdMono}>
                      {g.result != null && g.passYardsAllowed != null ? g.passYardsAllowed : '—'}
                    </td>
                    <td style={schedTdMono}>
                      {g.result != null && g.rushYardsAllowed != null ? g.rushYardsAllowed : '—'}
                    </td>
                    <td style={{ ...schedTdMono, color: g.turnovers > 0 ? '#ff627e' : '#9fc3db' }}>
                      {g.result != null ? g.turnovers : '—'}
                    </td>
                    <td
                      style={{
                        ...schedTdMono,
                        color:
                          g.offEpa != null ? (g.offEpa >= 0 ? '#8fff45' : '#ff627e') : '#9fc3db',
                      }}
                    >
                      {g.offEpa != null
                        ? g.offEpa > 0
                          ? `+${g.offEpa.toFixed(1)}`
                          : g.offEpa.toFixed(1)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const schedTd: CSSProperties = {
  padding: '9px 12px',
  borderBottom: '1px solid rgba(0,229,255,.06)',
  color: '#d9ecf9',
  fontSize: 13,
};
const schedTdMono: CSSProperties = {
  ...schedTd,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  color: '#9fc3db',
  textAlign: 'right',
};

// ---------------------------------------------------------------------------
// RANKINGS TAB
// ---------------------------------------------------------------------------

function RankingsTab({
  apiBase,
  profile,
  currentSeason,
}: {
  apiBase: string;
  profile: GridstreamTeamProfile;
  currentSeason: number;
}) {
  const [rankings, setRankings] = useState<GridstreamTeamRankings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGridstreamTeamRankings(apiBase, profile.abbreviation, currentSeason)
      .then((r) => {
        if (!cancelled) setRankings(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, profile.abbreviation, currentSeason]);

  if (loading) return <LoadingMsg />;
  if (error) return <ErrorMsg msg={error} />;
  if (!rankings || !Object.keys(rankings).length)
    return <EmptyMsg msg="No rankings data available." />;

  const accent = `#${profile.colorPrimary}`;

  const entries = Object.entries(rankings);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          color: C.textMuted,
          fontSize: 11,
          letterSpacing: '.06em',
          padding: '0 0 8px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        Rankings for <span style={{ color: accent, fontWeight: 700 }}>{profile.displayName}</span> —{' '}
        {currentSeason} season
      </div>
      {entries.map(([key, entry]) => (
        <RankRow key={key} entry={entry} accent={accent} />
      ))}
    </div>
  );
}

function RankRow({ entry, accent }: { entry: GridstreamTeamRankEntry; accent: string }) {
  const leagueColor = teamRankTierColor(entry.leagueRank, entry.leagueTotal);
  const safeLeagueTotal = entry.leagueTotal > 1 ? entry.leagueTotal : 32;
  const isDvoaMetric = entry.label.toLowerCase().includes('dvoa');
  const pct =
    entry.leagueRank != null
      ? ((safeLeagueTotal - entry.leagueRank) / (safeLeagueTotal - 1)) * 100
      : 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 100px 1fr 120px',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'rgba(0,12,28,.6)',
        border: '1px solid rgba(0,229,255,.1)',
      }}
    >
      {/* Label */}
      <div style={{ color: C.textSecondary, fontSize: 12, letterSpacing: '.03em' }}>
        {entry.label}
      </div>

      {/* Value */}
      <div
        style={{
          color: accent,
          fontWeight: 700,
          fontSize: 16,
          fontFamily: "'JetBrains Mono', monospace",
          textAlign: 'right',
        }}
      >
        {entry.value != null
          ? isDvoaMetric
            ? `${entry.value > 0 ? '+' : ''}${entry.value.toFixed(entry.value < 10 ? 2 : 1)}%`
            : entry.value.toFixed(entry.value < 10 ? 2 : 1)
          : '—'}
      </div>

      {/* Percentile bar */}
      <div
        style={{
          position: 'relative',
          height: 6,
          background: 'rgba(0,229,255,.1)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(2, pct)}%`,
            background: leagueColor,
            borderRadius: 3,
            transition: 'width .4s',
          }}
        />
      </div>

      {/* League rank */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <RankBadge rank={entry.leagueRank} total={entry.leagueTotal} color={leagueColor} />
      </div>
    </div>
  );
}

function RankBadge({ rank, total, color }: { rank: number | null; total: number; color: string }) {
  const safeTotal = total > 0 ? total : 32;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: 'rgba(0,18,38,.8)',
        border: `1px solid ${color}40`,
        borderRadius: 2,
        padding: '2px 6px',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <span style={{ color }}>{rank != null ? `#${rank}` : '—'}</span>
      <span style={{ color: '#4a6a82', fontSize: 9 }}>/</span>
      <span style={{ color: '#78a3c1' }}>{safeTotal}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: '#78a3c1',
        fontSize: 10,
        letterSpacing: '.1em',
        fontFamily: "'Orbitron', monospace",
        fontWeight: 700,
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: '1px solid rgba(0,229,255,.1)',
      }}
    >
      {children}
    </div>
  );
}

function LoadingMsg() {
  return (
    <div
      style={{
        color: '#6f9ab8',
        fontSize: 13,
        padding: '24px 0',
        textAlign: 'center',
        letterSpacing: '.06em',
      }}
    >
      LOADING…
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div
      style={{
        color: '#ff8fa0',
        fontSize: 13,
        background: 'rgba(255,98,126,.1)',
        border: '1px solid rgba(255,98,126,.3)',
        padding: '10px 14px',
      }}
    >
      {msg}
    </div>
  );
}

function EmptyMsg({ msg }: { msg: string }) {
  return (
    <div style={{ color: '#6f9ab8', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
      {msg}
    </div>
  );
}
