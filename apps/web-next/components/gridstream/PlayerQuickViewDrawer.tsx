'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import {
  fetchGridstreamPlayerProfile,
  fetchGridstreamPlayerGamelogPage,
  formatGridstreamDraftLabel,
  formatGridstreamSeasonRange,
  type GridstreamPlayerGamelogEntry,
  type GridstreamPlayerProfile,
} from '@atlas/sdk/gridstream';

const playerQuickViewCache = new Map<string, GridstreamPlayerProfile>();
const playerQuickViewSeasonCache = new Map<string, QuickViewSeasonSummary | null>();
const seasonCacheKey = (playerId: string, season: number | null) =>
  `${playerId}:${season ?? 'latest'}`;

const C = {
  bgDeep: '#050c18',
  surface: 'rgba(0,12,28,.96)',
  surfaceRaised: 'rgba(0,18,38,.92)',
  textPrimary: '#f4fbff',
  textSecondary: '#9fc3db',
  textMuted: '#6f9ab8',
  accent: '#00e5ff',
  linkCyan: '#7ee7ff',
  border: 'rgba(0,229,255,.14)',
} as const;

const remoteImageLoader = ({ src }: { src: string }) => src;

type QuickMetric = {
  label: string;
  value: string;
  tone?: string;
};

type QuickViewSeasonSummary = {
  season: number;
  games: number;
  passComp: number;
  passAtt: number;
  passYards: number;
  passTd: number;
  interceptionsThrown: number;
  passerRating: number | null;
  carries: number;
  rushYards: number;
  rushTd: number;
  receptions: number;
  receivingYards: number;
  receivingTd: number;
  tacklesTotal: number;
  sacksMade: number;
  interceptionsCaught: number;
  passesDefended: number;
};

export type DraftProspectQuickView = {
  name: string;
  position?: string | null;
  school?: string | null;
  imageUrl?: string | null;
  collegeLogoUrl?: string | null;
  range?: string | null;
  teamMockCount?: number | null;
  totalMockCount?: number | null;
  consensusType?: string | null;
  overallRank?: number | null;
  trueAdp?: number | null;
  needLabel?: string | null;
  fitReason?: string | null;
  teamAbbr?: string | null;
  draftSeason?: number | null;
  pickLabel?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  classYear?: string | null;
  hometown?: string | null;
  role?: string | null;
  jerseyNumber?: string | null;
  draftProjection?: string | null;
  buzzOverallRating?: number | null;
  buzzOverallRank?: number | null;
  buzzPositionRank?: number | null;
  buzzPositionRankGroup?: string | null;
  allScoutsOverallRank?: number | null;
  allScoutsPositionRank?: number | null;
  height?: string | null;
  weight?: number | null;
  fortyYard?: number | null;
  handSize?: string | null;
  armLength?: string | null;
  age?: number | null;
  birthDate?: string | null;
  sourceLastUpdated?: string | null;
  collegeGames?: number | null;
  collegeSnaps?: number | null;
  bio?: string | null;
  summary?: string | null;
  strengths?: string[] | null;
  weaknesses?: string[] | null;
  honors?: string[] | null;
  productionStats?: Array<{
    label: string;
    value?: string | null;
    percentile?: number | null;
  }> | null;
  scoutingGrades?: Array<{
    label: string;
    value?: string | null;
    percent?: number | null;
  }> | null;
  measurablePercentiles?: Array<{
    label: string;
    value?: string | null;
    percentile?: number | null;
  }> | null;
  recruitingRatings?: Array<{
    label: string;
    value?: string | null;
  }> | null;
  comparisonPlayers?: Array<{
    name: string;
    school?: string | null;
    similarity?: number | null;
    sourceUrl?: string | null;
  }> | null;
  fitTeams?: Array<{
    team?: {
      abbreviation: string;
      displayName: string;
      shortDisplayName: string;
      colorPrimary: string;
      colorSecondary: string;
      logoUrl: string | null;
    } | null;
    needKey?: string | null;
    needLabel?: string | null;
    needRank?: number | null;
    pickLabel?: string | null;
    round?: number | null;
    overallPick?: number | null;
  }> | null;
};

type PlayerContract = NonNullable<GridstreamPlayerProfile['contracts']>[number];
type PlayerTransaction = NonNullable<GridstreamPlayerProfile['recentTransactions']>[number];

function QuickViewTextTrigger({
  active,
  onActivate,
  title,
  children,
  style,
}: {
  active: boolean;
  onActivate?: (event: MouseEvent<HTMLButtonElement>) => void;
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const [isHovered, setIsHovered] = useState(false);

  if (!active || !onActivate) {
    return <span style={style}>{children}</span>;
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      title={title}
      aria-haspopup="dialog"
      style={{
        background: isHovered ? 'rgba(99,223,255,.05)' : 'transparent',
        border: '1px solid transparent',
        borderRadius: 4,
        padding: '1px 2px',
        margin: 0,
        color: isHovered ? '#dff8ff' : (style?.color ?? 'inherit'),
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        transition:
          'color .16s ease, transform .16s ease, text-decoration-color .16s ease, background .16s ease, box-shadow .16s ease',
        textDecorationLine: 'underline',
        textDecorationColor: isHovered ? 'rgba(99,223,255,.82)' : 'rgba(99,223,255,.34)',
        textDecorationThickness: isHovered ? '2px' : '1px',
        textUnderlineOffset: '0.18em',
        boxShadow: isHovered ? '0 0 0 1px rgba(99,223,255,.12)' : 'none',
        transform: isHovered ? 'translateY(-1px)' : 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function PlayerQuickViewTrigger({
  playerId,
  playerName,
  onOpen,
  children,
  style,
  title,
}: {
  playerId: string | number | null | undefined;
  playerName?: string | null;
  onOpen: (playerId: string, playerName?: string) => void;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  const href =
    playerId != null ? `/gridstream/players/${encodeURIComponent(String(playerId))}` : null;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (playerId == null || !href) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    onOpen(String(playerId), playerName ?? undefined);
  };

  return (
    <QuickViewTextTrigger
      active={playerId != null}
      onActivate={handleClick}
      title={title ?? `Open quick view for ${playerName ?? 'player'}`}
      style={style}
    >
      {children}
    </QuickViewTextTrigger>
  );
}

export function ProspectQuickViewTrigger({
  prospect,
  onOpen,
  children,
  style,
  title,
}: {
  prospect: DraftProspectQuickView | null | undefined;
  onOpen: (prospect: DraftProspectQuickView) => void;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  const handleClick = (_event: MouseEvent<HTMLButtonElement>) => {
    if (!prospect) return;
    onOpen(prospect);
  };

  return (
    <QuickViewTextTrigger
      active={Boolean(prospect)}
      onActivate={handleClick}
      title={title ?? `Open prospect preview for ${prospect?.name ?? 'prospect'}`}
      style={style}
    >
      {children}
    </QuickViewTextTrigger>
  );
}

function formatHeightWeight(profile: GridstreamPlayerProfile): string {
  const parts = [
    profile.height || null,
    profile.weight != null ? `${profile.weight} lb` : null,
  ].filter(Boolean);
  return parts.join(' / ') || '—';
}

function formatBirthDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatFullNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: value >= 100000000 ? 0 : 1,
  }).format(value);
}

function formatSeasonWindow(years: number[]): string | null {
  const valid = years
    .filter((value): value is number => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!valid.length) return null;
  return valid[0] === valid[valid.length - 1]
    ? String(valid[0])
    : `${valid[0]}-${valid[valid.length - 1]}`;
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function formatRate(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function formatCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function calculateAgeFromBirthDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - parsed.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < parsed.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function normalizeColorToken(token: string | null | undefined, fallback: string): string {
  if (!token) return fallback;
  return token.startsWith('#') ? token : `#${token}`;
}

function normalizeProspectSchoolKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function hexToRgb(token: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!token) return null;
  const normalized = token.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(normalized)) return null;
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized.slice(0, 6);
  const parsed = Number.parseInt(expanded, 16);
  if (Number.isNaN(parsed)) return null;
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function toRgba(token: string | null | undefined, alpha: number): string {
  const rgb = hexToRgb(token);
  if (!rgb) return `rgba(0,229,255,${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function pickReadableTextColor(background: string, light = C.textPrimary, dark = C.bgDeep): string {
  const rgb = hexToRgb(background);
  if (!rgb) return light;
  const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return yiq >= 150 ? dark : light;
}

function formatRosterStatusToken(
  token: string | null | undefined,
  fallbackIsActive: boolean
): string {
  const normalized = (token || '').trim();
  if (!normalized) return fallbackIsActive ? 'ACTIVE' : 'INACTIVE';
  return normalized.replace(/_/g, ' ').toUpperCase();
}

function formatRosterStatus(profile: GridstreamPlayerProfile): string {
  return formatRosterStatusToken(profile.rosterStatus, profile.isActive);
}

function inferExpiredContractFreeAgencyStatus(profile: GridstreamPlayerProfile): string {
  if (profile.yearsExperience != null) {
    if (profile.yearsExperience >= 4) return 'UFA';
    if (profile.yearsExperience >= 3) return 'RFA';
    if (profile.yearsExperience >= 0) return 'ERFA';
  }
  const token = (profile.rosterStatus || '').trim().toUpperCase();
  if (token.includes('UFA') || token.includes('RFA') || token.includes('ERFA')) return token;
  return 'FREE AGENT';
}

type ResolvedPlayerDisplayContext = {
  displayName: string;
  teamName: string;
  teamAbbr: string | null;
  statusLabel: string;
  isMarkedActive: boolean;
};

function getCurrentCalendarYear(): number {
  return new Date().getFullYear();
}

function sortContractsByRecency(contracts: PlayerContract[]): PlayerContract[] {
  return contracts.slice().sort((left, right) => {
    const rightEnd = getContractEndYear(right) ?? -Infinity;
    const leftEnd = getContractEndYear(left) ?? -Infinity;
    if (rightEnd !== leftEnd) return rightEnd - leftEnd;
    return (right.yearSigned ?? -Infinity) - (left.yearSigned ?? -Infinity);
  });
}

function resolvePlayerDisplayContext(
  profile: GridstreamPlayerProfile
): ResolvedPlayerDisplayContext {
  const contracts = sortContractsByRecency(profile.contracts ?? []);
  const activeContract = contracts.find((entry) => isContractEffectivelyActive(entry)) ?? null;
  const latestContract = contracts[0] ?? null;
  const latestContractEnd = latestContract ? getContractEndYear(latestContract) : null;
  const hasPendingContractDetails = hasPendingContractSync(profile);
  const hasExpiredLatestContract =
    latestContract != null &&
    latestContractEnd != null &&
    latestContractEnd < getCurrentCalendarYear() &&
    activeContract == null &&
    !hasPendingContractDetails;

  if (hasExpiredLatestContract) {
    return {
      displayName: profile.displayName,
      teamName: 'Free Agent',
      teamAbbr: 'FA',
      statusLabel: inferExpiredContractFreeAgencyStatus(profile),
      isMarkedActive: false,
    };
  }

  return {
    displayName: profile.displayName,
    teamName: profile.currentTeamName || profile.teamAbbr || 'Free Agent',
    teamAbbr: profile.teamAbbr || (profile.currentTeamName ? null : 'FA'),
    statusLabel: formatRosterStatus(profile),
    isMarkedActive: profile.isActive,
  };
}

function hasPendingContractSync(profile: GridstreamPlayerProfile): boolean {
  const currentTeam = (profile.teamAbbr || '').trim().toUpperCase();
  if (!profile.isActive || !currentTeam || currentTeam === 'FA') return false;

  const contracts = sortContractsByRecency(profile.contracts ?? []);
  const activeContract = contracts.find((entry) => isContractEffectivelyActive(entry)) ?? null;
  if (activeContract) return false;

  const latestContract = contracts[0] ?? null;
  if (!latestContract) {
    return (profile.recentTransactions ?? []).some((transaction) => {
      const toTeam = (transaction.toTeamAbbr || '').trim().toUpperCase();
      const type = (transaction.transactionType || '').trim().toLowerCase();
      return (
        toTeam === currentTeam &&
        (type.includes('sign') ||
          type.includes('claim') ||
          type.includes('trade') ||
          type.includes('promot') ||
          type.includes('activate'))
      );
    });
  }

  const latestContractTeam = (latestContract.teamAbbr || '').trim().toUpperCase();
  const latestContractEnd = getContractEndYear(latestContract);
  const contractExpired =
    latestContractEnd == null ? true : latestContractEnd < getCurrentCalendarYear();

  return contractExpired && Boolean(latestContractTeam) && latestContractTeam !== currentTeam;
}

function getPositionBadgeStyle(primaryAccent: string, secondaryAccent: string): CSSProperties {
  const background =
    secondaryAccent.toLowerCase() !== primaryAccent.toLowerCase() ? secondaryAccent : primaryAccent;
  return {
    border: `1px solid ${toRgba(primaryAccent, 0.5)}`,
    background,
    color: pickReadableTextColor(background),
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'Orbitron', monospace",
    letterSpacing: '.08em',
    boxShadow: `0 0 0 1px ${toRgba(background, 0.15)} inset`,
  };
}

function getRosterStatusBadgeStyle(
  status: string,
  isMarkedActive: boolean,
  primaryAccent: string,
  secondaryAccent: string
): CSSProperties {
  const normalized = status.toUpperCase();

  if (isMarkedActive || normalized === 'ACTIVE') {
    return {
      border: '1px solid rgba(134,239,172,.36)',
      background: 'rgba(134,239,172,.14)',
      color: '#b8ff8c',
      padding: '4px 8px',
      fontSize: 10,
      fontWeight: 700,
      fontFamily: "'Orbitron', monospace",
      letterSpacing: '.08em',
    };
  }

  if (
    normalized.includes('CUT') ||
    normalized.includes('RELEASED') ||
    normalized.includes('WAIVED') ||
    normalized.includes('INACTIVE')
  ) {
    return {
      border: '1px solid rgba(251,113,133,.34)',
      background: 'rgba(251,113,133,.12)',
      color: '#ff9db0',
      padding: '4px 8px',
      fontSize: 10,
      fontWeight: 700,
      fontFamily: "'Orbitron', monospace",
      letterSpacing: '.08em',
    };
  }

  if (
    normalized.includes('FREE AGENT') ||
    normalized.includes('UFA') ||
    normalized.includes('RFA') ||
    normalized.includes('ERFA')
  ) {
    return {
      border: '1px solid rgba(255,182,18,.34)',
      background: 'rgba(255,182,18,.12)',
      color: '#ffd27a',
      padding: '4px 8px',
      fontSize: 10,
      fontWeight: 700,
      fontFamily: "'Orbitron', monospace",
      letterSpacing: '.08em',
    };
  }

  if (
    normalized.includes('RESERVE') ||
    normalized.includes('PUP') ||
    normalized.includes('IR') ||
    normalized.includes('NFI')
  ) {
    return {
      border: '1px solid rgba(250,204,21,.34)',
      background: 'rgba(250,204,21,.1)',
      color: '#fde68a',
      padding: '4px 8px',
      fontSize: 10,
      fontWeight: 700,
      fontFamily: "'Orbitron', monospace",
      letterSpacing: '.08em',
    };
  }

  return {
    border: `1px solid ${toRgba(primaryAccent, 0.28)}`,
    background: `linear-gradient(135deg, ${toRgba(primaryAccent, 0.18)} 0%, ${toRgba(
      secondaryAccent,
      0.16
    )} 100%)`,
    color: C.textSecondary,
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'Orbitron', monospace",
    letterSpacing: '.08em',
  };
}

function getContractYears(contract: PlayerContract): number[] {
  return (contract.yearDetails ?? [])
    .map((entry) => entry.year)
    .filter((value): value is number => value != null && Number.isFinite(value));
}

function getContractYearWindow(contract: PlayerContract): string | null {
  const contractYears = getContractYears(contract);
  const signedYear = contract.yearSigned;
  return (
    formatSeasonWindow(contractYears) ??
    (signedYear != null && contract.years != null
      ? formatSeasonWindow(
          Array.from({ length: Math.max(contract.years, 1) }, (_, index) => signedYear + index)
        )
      : signedYear != null
        ? String(signedYear)
        : null)
  );
}

function getContractEndYear(contract: PlayerContract): number | null {
  const contractYears = getContractYears(contract);
  if (contractYears.length > 0) return Math.max(...contractYears);
  if (contract.yearSigned != null && contract.years != null) {
    return contract.yearSigned + Math.max(contract.years, 1) - 1;
  }
  return contract.yearSigned ?? null;
}

function isContractEffectivelyActive(contract: PlayerContract): boolean {
  if (!contract.isActive) return false;
  const endYear = getContractEndYear(contract);
  return endYear == null ? Boolean(contract.isActive) : endYear >= getCurrentCalendarYear();
}

function formatContractTerms(contract: PlayerContract): string {
  const yearWindow = getContractYearWindow(contract);
  const bits = [
    yearWindow,
    contract.years != null ? `${contract.years} yr${contract.years === 1 ? '' : 's'}` : null,
    contract.totalValue != null ? `${formatCompactCurrency(contract.totalValue)} total` : null,
    contract.apy != null ? `${formatCompactCurrency(contract.apy)} APY` : null,
  ].filter(Boolean);
  return bits.join(' · ') || 'Contract details unavailable';
}

function formatContractTermsCompact(contract: PlayerContract): string {
  const bits = [
    contract.years != null ? `${contract.years} yr${contract.years === 1 ? '' : 's'}` : null,
    contract.totalValue != null ? `${formatCompactCurrency(contract.totalValue)} total` : null,
    contract.apy != null ? `${formatCompactCurrency(contract.apy)} APY` : null,
  ].filter(Boolean);
  return bits.join(' · ') || formatContractTerms(contract);
}

function resolvePendingTransactionContract(
  profile: GridstreamPlayerProfile
): PlayerTransaction | null {
  const currentTeam = (profile.teamAbbr || '').trim().toUpperCase();
  if (!currentTeam || currentTeam === 'FA') return null;

  return (
    (profile.recentTransactions ?? []).find((transaction) => {
      const toTeam = (transaction.toTeamAbbr || '').trim().toUpperCase();
      const type = (transaction.transactionType || '').trim().toLowerCase();
      return (
        toTeam === currentTeam &&
        (type.includes('sign') || type.includes('claim') || type.includes('trade')) &&
        [
          transaction.contractYears,
          transaction.contractTotalValue,
          transaction.contractApy,
          transaction.contractGuaranteed,
        ].some((value) => value != null)
      );
    }) ?? null
  );
}

function formatTransactionContractSummary(transaction: PlayerTransaction): string | null {
  const parsedDateYear = transaction.date
    ? Number.parseInt(transaction.date.slice(0, 4), 10)
    : null;
  const signedYear =
    parsedDateYear != null && Number.isFinite(parsedDateYear)
      ? parsedDateYear
      : (transaction.season ?? null);
  const yearWindow =
    signedYear != null && transaction.contractYears != null
      ? formatSeasonWindow(
          Array.from(
            { length: Math.max(transaction.contractYears, 1) },
            (_, index) => signedYear + index
          )
        )
      : signedYear != null
        ? String(signedYear)
        : null;

  const bits = [
    yearWindow,
    transaction.contractYears != null
      ? `${transaction.contractYears} yr${transaction.contractYears === 1 ? '' : 's'}`
      : null,
    transaction.contractTotalValue != null
      ? `${formatCompactCurrency(transaction.contractTotalValue)} total`
      : null,
    transaction.contractApy != null
      ? `${formatCompactCurrency(transaction.contractApy)} APY`
      : null,
  ].filter(Boolean);

  return bits.join(' · ') || null;
}

function formatContractSummary(profile: GridstreamPlayerProfile): string {
  const pendingTransactionContract = resolvePendingTransactionContract(profile);
  if (pendingTransactionContract) {
    return (
      formatTransactionContractSummary(pendingTransactionContract) ??
      'New contract details coming soon'
    );
  }
  if (hasPendingContractSync(profile)) {
    return 'New contract details coming soon';
  }

  const contracts = sortContractsByRecency(profile.contracts ?? []);
  if (!contracts.length) {
    return profile.isActive
      ? 'Contract details have not been synced yet'
      : 'No active contract on file';
  }

  const activeContract = contracts.find((entry) => isContractEffectivelyActive(entry)) ?? null;
  if (activeContract) {
    return formatContractTerms(activeContract);
  }

  const latestContract = contracts[0] ?? null;
  if (!latestContract) return 'No active contract on file';

  const expiredAfter = getContractEndYear(latestContract);
  return [
    expiredAfter != null ? `Expired after ${expiredAfter}` : 'Expired deal',
    formatContractTermsCompact(latestContract),
  ]
    .filter(Boolean)
    .join(' · ');
}

function formatTransactionTypeLabel(token: string | null | undefined): string {
  const normalized = (token || '').trim().toLowerCase();
  if (!normalized) return 'Transaction';
  const overrides: Record<string, string> = {
    signed: 'Signed',
    re_signed: 'Re-signed',
    signed_ps: 'Signed to practice squad',
    promoted: 'Promoted',
    elevated: 'Elevated',
    activated: 'Activated',
    claimed: 'Claimed',
    traded: 'Traded',
    released: 'Released',
    waived: 'Waived',
    cut: 'Released',
    retired: 'Retired',
    reserve_futures: 'Signed reserve/future deal',
    reserve_future: 'Signed reserve/future deal',
    contract_extension: 'Extended',
    contract_restructure: 'Restructured',
  };
  if (overrides[normalized]) return overrides[normalized];
  return normalized
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function cleanTransactionDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const compact = description.replace(/\s+/g, ' ').trim();
  const stripped = compact.replace(/^(roster|spotrac|ourlads|otc)\s+sync:\s*/i, '');
  return stripped.replace(/^.+?\s+moved from\s+/i, 'Moved from ');
}

function isRosterSyncTransaction(transaction: PlayerTransaction | null | undefined): boolean {
  return (transaction?.description || '').trim().toLowerCase().startsWith('roster sync:');
}

function buildContractSigningFallback(profile: GridstreamPlayerProfile): string | null {
  const latestContract = sortContractsByRecency(profile.contracts ?? [])[0] ?? null;
  if (!latestContract || latestContract.yearSigned == null) return null;
  const latestContractEnd = getContractEndYear(latestContract);
  if ((latestContractEnd ?? latestContract.yearSigned) < getCurrentCalendarYear() - 1) {
    return null;
  }

  const team = latestContract.teamAbbr || profile.teamAbbr || null;
  const contractLabel =
    latestContract.years != null
      ? `${latestContract.years}-year deal`
      : latestContract.totalValue != null
        ? 'contract'
        : null;

  return [
    team ? `Signed with ${team}` : 'Signed',
    `${latestContract.yearSigned} offseason`,
    contractLabel,
  ]
    .filter(Boolean)
    .join(' · ');
}

function pickDisplayTransaction(profile: GridstreamPlayerProfile): PlayerTransaction | null {
  const transactions = profile.recentTransactions ?? [];
  const firstRealTransaction = transactions.find(
    (transaction) => !isRosterSyncTransaction(transaction)
  );
  return firstRealTransaction ?? transactions[0] ?? null;
}

function formatTransactionMovement(transaction: PlayerTransaction): string | null {
  const transactionType = (transaction.transactionType || '').trim().toLowerCase();
  const fromTeam = transaction.fromTeamAbbr?.trim() || null;
  const toTeam = transaction.toTeamAbbr?.trim() || null;

  if (transactionType.includes('sign')) {
    if (toTeam && fromTeam) return `Joined ${toTeam} from ${fromTeam}`;
    if (toTeam) return `Joined ${toTeam}`;
    if (fromTeam) return `Signed from ${fromTeam}`;
  }
  if (
    transactionType.includes('release') ||
    transactionType.includes('cut') ||
    transactionType.includes('waive')
  ) {
    if (fromTeam) return `Released by ${fromTeam}`;
    return 'Released';
  }
  if (transactionType.includes('trade')) {
    if (fromTeam && toTeam) return `Moved from ${fromTeam} to ${toTeam}`;
    if (toTeam) return `Moved to ${toTeam}`;
  }
  if (transactionType.includes('claim')) {
    if (toTeam && fromTeam) return `Claimed by ${toTeam} from ${fromTeam}`;
    if (toTeam) return `Claimed by ${toTeam}`;
  }
  if (transactionType.includes('promot')) {
    if (toTeam) return `Promoted onto ${toTeam}'s active roster`;
    return 'Promoted to the active roster';
  }
  if (transactionType.includes('activate')) {
    if (toTeam) return `Activated by ${toTeam}`;
    return 'Activated';
  }

  return cleanTransactionDescription(transaction.description);
}

function formatRecentTransaction(profile: GridstreamPlayerProfile): string {
  const transaction = pickDisplayTransaction(profile);
  const hasOnlyRosterSyncTransactions =
    (profile.recentTransactions?.length ?? 0) > 0 && isRosterSyncTransaction(transaction);
  if (!transaction) {
    return buildContractSigningFallback(profile) ?? 'No recent transactions logged';
  }
  if (hasOnlyRosterSyncTransactions) {
    const fallback = buildContractSigningFallback(profile);
    if (fallback) return fallback;
  }
  const typeLabel = formatTransactionTypeLabel(transaction.transactionType);
  const movement = formatTransactionMovement(transaction);
  const bits = [
    typeLabel,
    formatCalendarDate(transaction.date),
    movement && movement.toLowerCase() !== typeLabel.toLowerCase() ? movement : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

function computePasserRating(
  completions: number,
  attempts: number,
  yards: number,
  passingTds: number,
  interceptions: number
): number | null {
  if (!attempts) return null;
  const a = Math.min(2.375, Math.max(0, (completions / attempts - 0.3) * 5));
  const b = Math.min(2.375, Math.max(0, (yards / attempts - 3) * 0.25));
  const c = Math.min(2.375, Math.max(0, (passingTds / attempts) * 20));
  const d = Math.min(2.375, Math.max(0, 2.375 - (interceptions / attempts) * 25));
  return ((a + b + c + d) / 6) * 100;
}

function buildLatestSeasonSummary(
  rows: GridstreamPlayerGamelogEntry[]
): QuickViewSeasonSummary | null {
  if (!rows.length) return null;
  const latestSeason = Math.max(...rows.map((row) => row.seasonYear));
  const seasonRows = rows.filter((row) => row.seasonYear === latestSeason);
  const regularRows = seasonRows.filter((row) => row.seasonType === 'REG');
  const scopedRows = regularRows.length > 0 ? regularRows : seasonRows;
  if (!scopedRows.length) return null;

  const totals = scopedRows.reduce(
    (acc, row) => {
      acc.games += 1;
      acc.passComp += row.passComp;
      acc.passAtt += row.passAtt;
      acc.passYards += row.passYards;
      acc.passTd += row.passTd;
      acc.interceptionsThrown += row.interceptionsThrown;
      acc.carries += row.carries;
      acc.rushYards += row.rushYards;
      acc.rushTd += row.rushTd;
      acc.receptions += row.receptions;
      acc.receivingYards += row.receivingYards;
      acc.receivingTd += row.receivingTd;
      acc.tacklesTotal += row.tacklesTotal;
      acc.sacksMade += row.sacksMade;
      acc.interceptionsCaught += row.interceptionsCaught;
      acc.passesDefended += row.passesDefended;
      return acc;
    },
    {
      games: 0,
      passComp: 0,
      passAtt: 0,
      passYards: 0,
      passTd: 0,
      interceptionsThrown: 0,
      carries: 0,
      rushYards: 0,
      rushTd: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTd: 0,
      tacklesTotal: 0,
      sacksMade: 0,
      interceptionsCaught: 0,
      passesDefended: 0,
    }
  );

  return {
    season: latestSeason,
    ...totals,
    passerRating: computePasserRating(
      totals.passComp,
      totals.passAtt,
      totals.passYards,
      totals.passTd,
      totals.interceptionsThrown
    ),
  };
}

async function fetchPlayerLatestSeasonSummary(
  apiBase: string,
  playerId: string,
  signal: AbortSignal
): Promise<QuickViewSeasonSummary | null> {
  const gamelog = await fetchGridstreamPlayerGamelogPage({
    apiBase,
    playerId,
    page: 1,
    pageSize: 40,
    signal,
  });
  return buildLatestSeasonSummary(gamelog.items);
}

async function fetchPlayerSeasonSummary(
  apiBase: string,
  playerId: string,
  season: number,
  signal: AbortSignal
): Promise<QuickViewSeasonSummary | null> {
  const gamelog = await fetchGridstreamPlayerGamelogPage({
    apiBase,
    playerId,
    season,
    page: 1,
    pageSize: 40,
    signal,
  });
  return buildLatestSeasonSummary(gamelog.items);
}

function buildQuickMetrics(
  profile: GridstreamPlayerProfile,
  latestSeasonSummary: QuickViewSeasonSummary | null
): QuickMetric[] {
  const position = (profile.position || profile.positionGroup || '').toUpperCase();
  if (position === 'QB') {
    return [
      {
        label: 'Pass Yds',
        value: formatFullNumber(latestSeasonSummary?.passYards ?? profile.passingYards),
        tone: '#63dfff',
      },
      {
        label: 'Pass TD',
        value: formatCompactNumber(latestSeasonSummary?.passTd ?? profile.passingTds),
        tone: '#8fff45',
      },
      {
        label: 'Rush Yds',
        value: formatFullNumber(latestSeasonSummary?.rushYards ?? profile.rushingYards),
        tone: '#63dfff',
      },
      {
        label: 'Rush TD',
        value: formatCompactNumber(latestSeasonSummary?.rushTd ?? profile.rushingTds),
        tone: '#8fff45',
      },
      {
        label: 'Comp %',
        value: formatPct(
          latestSeasonSummary
            ? latestSeasonSummary.passAtt > 0
              ? (latestSeasonSummary.passComp * 100) / latestSeasonSummary.passAtt
              : null
            : profile.completionPct
        ),
        tone: '#ffb612',
      },
      {
        label: 'Passer Rating',
        value: formatRate(latestSeasonSummary?.passerRating ?? profile.passerRating),
        tone: '#c084fc',
      },
    ];
  }
  if (['RB', 'HB', 'FB'].includes(position)) {
    return [
      {
        label: 'Rush Yds',
        value: formatFullNumber(latestSeasonSummary?.rushYards ?? profile.rushingYards),
        tone: '#63dfff',
      },
      {
        label: 'Rush TD',
        value: formatCompactNumber(latestSeasonSummary?.rushTd ?? profile.rushingTds),
        tone: '#8fff45',
      },
      {
        label: 'Yds/Carry',
        value: formatRate(
          latestSeasonSummary
            ? latestSeasonSummary.carries > 0
              ? latestSeasonSummary.rushYards / latestSeasonSummary.carries
              : null
            : profile.yardsPerCarry
        ),
        tone: '#ffb612',
      },
      {
        label: 'Scrim Yds',
        value: formatFullNumber(
          latestSeasonSummary
            ? latestSeasonSummary.rushYards + latestSeasonSummary.receivingYards
            : profile.scrimmageYards
        ),
        tone: '#c084fc',
      },
    ];
  }
  if (['WR', 'TE'].includes(position)) {
    return [
      {
        label: 'Receptions',
        value: formatCompactNumber(latestSeasonSummary?.receptions ?? profile.receptions),
        tone: '#63dfff',
      },
      {
        label: 'Rec Yds',
        value: formatFullNumber(latestSeasonSummary?.receivingYards ?? profile.receivingYards),
        tone: '#8fff45',
      },
      {
        label: 'Rec TD',
        value: formatCompactNumber(latestSeasonSummary?.receivingTd ?? profile.receivingTds),
        tone: '#ffb612',
      },
      {
        label: 'Yds/Rec',
        value: formatRate(
          latestSeasonSummary
            ? latestSeasonSummary.receptions > 0
              ? latestSeasonSummary.receivingYards / latestSeasonSummary.receptions
              : null
            : profile.yardsPerReception
        ),
        tone: '#c084fc',
      },
    ];
  }
  if (['K', 'P'].includes(position)) {
    return [
      { label: 'Games', value: formatCompactNumber(profile.gamesPlayed), tone: '#63dfff' },
      {
        label: position === 'K' ? 'FG Made' : 'Punts',
        value: formatCompactNumber(
          position === 'K' ? profile.fieldGoalsMade : profile.puntAttempts
        ),
        tone: '#8fff45',
      },
      {
        label: position === 'K' ? 'FG Att' : 'Seasons',
        value: formatCompactNumber(
          position === 'K' ? profile.fieldGoalsAttempted : profile.seasonsCount
        ),
        tone: '#ffb612',
      },
      { label: 'Draft', value: formatGridstreamDraftLabel(profile), tone: '#c084fc' },
    ];
  }
  if (['C', 'G', 'T', 'OT', 'OG', 'OL', 'LS'].includes(position)) {
    return [
      { label: 'Games', value: formatCompactNumber(profile.gamesPlayed), tone: '#63dfff' },
      { label: 'Starts', value: formatCompactNumber(profile.gamesStarted), tone: '#8fff45' },
      { label: 'Snaps', value: formatCompactNumber(profile.offensiveSnaps), tone: '#ffb612' },
      { label: 'Snap %', value: formatPct(profile.snapPct), tone: '#c084fc' },
    ];
  }
  return [
    {
      label: 'Tackles',
      value: formatCompactNumber(latestSeasonSummary?.tacklesTotal ?? profile.tacklesTotal),
      tone: '#63dfff',
    },
    {
      label: 'Sacks',
      value: formatRate(latestSeasonSummary?.sacksMade ?? profile.sacksMade),
      tone: '#8fff45',
    },
    {
      label: 'INT',
      value: formatCompactNumber(
        latestSeasonSummary?.interceptionsCaught ?? profile.interceptionsCaught
      ),
      tone: '#ffb612',
    },
    {
      label: 'PD',
      value: formatCompactNumber(latestSeasonSummary?.passesDefended ?? profile.passesDefended),
      tone: '#c084fc',
    },
  ];
}

function formatProspectConsensusLabel(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return 'Mock consensus';
  if (normalized === 'decisive') return 'Strong team consensus';
  if (normalized === 'indecisive') return 'Broad first-round mix';
  return normalized
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatProspectPositionLabel(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Prospect';
  const normalized = raw.toUpperCase().replace(/\s+/g, '');

  if (
    normalized.includes('EDGE') ||
    normalized === 'ED' ||
    normalized === 'DE/EDGE' ||
    normalized === 'EDGE/DE' ||
    normalized === 'OLB/EDGE' ||
    normalized === 'EDGE/OLB'
  ) {
    return 'Edge';
  }

  const directMap: Record<string, string> = {
    QB: 'QB',
    RB: 'RB',
    WR: 'WR',
    TE: 'TE',
    OT: 'OT',
    T: 'OT',
    G: 'G',
    OG: 'G',
    C: 'C',
    OL: 'OL',
    IOL: 'IOL',
    DE: 'Edge',
    DT: 'DT',
    DL: 'DL',
    LB: 'LB',
    OLB: 'LB',
    ILB: 'LB',
    MLB: 'LB',
    CB: 'CB',
    S: 'Safety',
    SAFETY: 'Safety',
    DB: 'DB',
    K: 'K',
    P: 'P',
  };

  if (directMap[normalized]) return directMap[normalized];

  return raw
    .split('/')
    .map((segment) => directMap[segment.trim().toUpperCase()] || segment.trim().toUpperCase())
    .join(' / ');
}

function formatOrdinal(value: number): string {
  const abs = Math.abs(value);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (abs % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function formatProspectRange(prospect: DraftProspectQuickView): string {
  if (prospect.range) return prospect.range;
  if (prospect.draftProjection) return prospect.draftProjection;
  if (prospect.trueAdp != null) return `Projected around pick ${prospect.trueAdp.toFixed(1)}`;
  return 'Range still settling';
}

function formatProspectConsensusRange(prospect: DraftProspectQuickView): string {
  const base = formatProspectRange(prospect);
  if (prospect.trueAdp == null) return base;
  if (!prospect.range && !prospect.draftProjection) {
    return `ADP ${prospect.trueAdp.toFixed(1)}`;
  }
  return `${base} (ADP ${prospect.trueAdp.toFixed(1)})`;
}

function formatProspectPositionRank(prospect: DraftProspectQuickView): string {
  const rank = prospect.buzzPositionRank ?? prospect.allScoutsPositionRank ?? null;
  if (rank == null || Number.isNaN(rank)) return '—';
  const positionLabel = formatProspectPositionLabel(
    prospect.position || prospect.buzzPositionRankGroup || null
  );
  const numericRank =
    Number.isInteger(rank) || Math.abs(rank - Math.round(rank)) < 0.05
      ? formatOrdinal(Math.round(rank))
      : `${rank.toFixed(1)} ${positionLabel}`;
  return Number.isInteger(rank) || Math.abs(rank - Math.round(rank)) < 0.05
    ? `${numericRank} ${positionLabel}`
    : numericRank;
}

function formatProspectAge(prospect: DraftProspectQuickView): string | null {
  if (prospect.age != null && !Number.isNaN(prospect.age)) {
    return prospect.age % 1 === 0 ? String(Math.round(prospect.age)) : prospect.age.toFixed(1);
  }
  const derivedAge = calculateAgeFromBirthDate(prospect.birthDate);
  return derivedAge != null ? String(derivedAge) : null;
}

function resolveProspectAccentColors(prospect: DraftProspectQuickView | null | undefined): {
  primary: string;
  secondary: string;
} {
  const haystack = normalizeProspectSchoolKey(
    `${prospect?.school || ''} ${prospect?.collegeLogoUrl || ''}`
  );
  const presets = [
    { keys: ['miamihurricanes', 'miamifl'], primary: '#f47321', secondary: '#005030' },
    { keys: ['ohiostatebuckeyes', 'ohiostate'], primary: '#bb0000', secondary: '#666666' },
    { keys: ['alabamacrimsontide', 'alabama'], primary: '#9e1b32', secondary: '#c4c4c4' },
    { keys: ['lsutigers', 'lsu'], primary: '#461d7c', secondary: '#fdd023' },
    { keys: ['texastechredraiders', 'texastech'], primary: '#cc0000', secondary: '#000000' },
    { keys: ['clemsontigers', 'clemson'], primary: '#f56600', secondary: '#522d80' },
    { keys: ['texasaandmaggies', 'texasaandm'], primary: '#500000', secondary: '#ffffff' },
    { keys: ['georgiabulldogs', 'georgia'], primary: '#ba0c2f', secondary: '#000000' },
    { keys: ['texaslonghorns', 'texas'], primary: '#bf5700', secondary: '#f5f1e7' },
    { keys: ['usctrojans', 'usc'], primary: '#990000', secondary: '#ffcc00' },
    { keys: ['notredamefightingirish', 'notredame'], primary: '#0c2340', secondary: '#c99700' },
    { keys: ['oregonducks', 'oregon'], primary: '#154733', secondary: '#fee123' },
    { keys: ['pennstatenittanylions', 'pennstate'], primary: '#041e42', secondary: '#ffffff' },
    { keys: ['michiganwolverines', 'michigan'], primary: '#00274c', secondary: '#ffcb05' },
    { keys: ['floridagators', 'florida'], primary: '#0021a5', secondary: '#fa4616' },
    { keys: ['floridastateseminoles', 'floridastate'], primary: '#782f40', secondary: '#ceb888' },
    { keys: ['tennesseevolunteers', 'tennessee'], primary: '#ff8200', secondary: '#58595b' },
    { keys: ['auburntigers', 'auburn'], primary: '#0c2340', secondary: '#e87722' },
    { keys: ['uclabruins', 'ucla'], primary: '#2774ae', secondary: '#ffd100' },
    { keys: ['stanfordcardinal', 'stanford'], primary: '#8c1515', secondary: '#ffffff' },
    { keys: ['coloradobuffaloes', 'colorado'], primary: '#000000', secondary: '#cfb87c' },
  ];

  const match = presets.find((preset) => preset.keys.some((key) => haystack.includes(key)));
  return match
    ? { primary: match.primary, secondary: match.secondary }
    : { primary: '#24d4ff', secondary: '#7aebff' };
}

function buildProspectQuickMetrics(prospect: DraftProspectQuickView): QuickMetric[] {
  const productionStats = Array.isArray(prospect.productionStats) ? prospect.productionStats : [];
  if (productionStats.length > 0) {
    const tones = ['#63dfff', '#8fff45', '#ffb612', '#c084fc'];
    return productionStats.slice(0, 4).map((entry, index) => ({
      label: entry.label,
      value: entry.value || '—',
      tone: tones[index % tones.length],
    }));
  }

  return [
    {
      label: 'Buzz Rating',
      value: prospect.buzzOverallRating != null ? prospect.buzzOverallRating.toFixed(1) : '—',
      tone: '#63dfff',
    },
    {
      label: 'Buzz Rank',
      value:
        prospect.buzzOverallRank != null
          ? `#${prospect.buzzOverallRank}`
          : prospect.overallRank != null
            ? `#${prospect.overallRank}`
            : '—',
      tone: '#8fff45',
    },
    {
      label: 'Pos Rank',
      value: formatProspectPositionRank(prospect),
      tone: '#ffb612',
    },
    {
      label: 'Forty',
      value: prospect.fortyYard != null ? prospect.fortyYard.toFixed(2) : '—',
      tone: '#c084fc',
    },
  ];
}

function formatProspectMeasurements(prospect: DraftProspectQuickView): string {
  const parts = [
    prospect.height || null,
    prospect.weight != null ? `${prospect.weight} lb` : null,
  ].filter(Boolean);
  return parts.join(' / ') || '—';
}

function formatProspectFitDetail(
  fit: NonNullable<DraftProspectQuickView['fitTeams']>[number]
): string {
  const parts = [
    fit.pickLabel || null,
    fit.needRank != null ? `Need #${fit.needRank}` : fit.needLabel,
  ].filter(Boolean);
  return parts.join(' - ') || 'Position fit';
}

function appendCacheBuster(url: string): string {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=20260309-headshot`;
}

function buildProspectImageCandidates(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const variants = new Set<string>();
  const addVariant = (candidate: string | null | undefined) => {
    const normalized = String(candidate ?? '').trim();
    if (normalized) {
      variants.add(appendCacheBuster(normalized));
    }
  };

  addVariant(raw);

  const match = raw.match(
    /(https?:\/\/[^/]+)?(\/Content\/PlayerHeadShots(?:Small)?\/)([^/?#]+)([?#].*)?$/i
  );
  if (match) {
    const origin = match[1] || 'https://www.nfldraftbuzz.com';
    const fileName = match[3];
    const suffix = match[4] || '';
    const normalizedFileName = fileName.replace(/_\d+(\.[a-z0-9]+)$/i, '$1');
    addVariant(`${origin}/Content/PlayerHeadShots/${normalizedFileName}${suffix}`);
    addVariant(`${origin}/Content/PlayerHeadShotsSmall/${normalizedFileName}${suffix}`);
    addVariant(`${origin}/Content/PlayerHeadShotsSmall/${fileName}${suffix}`);
  }

  return Array.from(variants);
}

export default function PlayerQuickViewDrawer({
  apiBase,
  playerId,
  playerLabel,
  prospect,
  open,
  onClose,
}: {
  apiBase: string;
  playerId: string | null;
  playerLabel?: string | null;
  prospect?: DraftProspectQuickView | null;
  open: boolean;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<GridstreamPlayerProfile | null>(null);
  const [latestSeasonSummary, setLatestSeasonSummary] = useState<QuickViewSeasonSummary | null>(
    null
  );
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [prospectHeroImageIndex, setProspectHeroImageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    setProspectHeroImageIndex(0);
  }, [prospect?.imageUrl, prospect?.name, open]);

  useEffect(() => {
    if (!open) return;
    if (prospect) {
      setProfile(null);
      setLatestSeasonSummary(null);
      setSelectedSeason(null);
      setSeasonLoading(false);
      setLoading(false);
      setError(null);
      return;
    }
    if (!playerId) return;

    const cached = playerQuickViewCache.get(playerId);
    const latestKey = seasonCacheKey(playerId, null);
    const hasCachedSeason = playerQuickViewSeasonCache.has(latestKey);
    const cachedSeason = hasCachedSeason
      ? (playerQuickViewSeasonCache.get(latestKey) ?? null)
      : null;
    if (cached && hasCachedSeason) {
      setProfile(cached);
      setLatestSeasonSummary(cachedSeason);
      setSelectedSeason(cachedSeason?.season ?? null);
      setSeasonLoading(false);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setProfile(null);
    setLatestSeasonSummary(null);
    setSelectedSeason(null);
    setSeasonLoading(false);
    setLoading(true);
    setError(null);

    Promise.all([
      cached
        ? Promise.resolve(cached)
        : fetchGridstreamPlayerProfile({
            apiBase,
            playerId,
            signal: controller.signal,
          }),
      hasCachedSeason
        ? Promise.resolve(cachedSeason)
        : fetchPlayerLatestSeasonSummary(apiBase, playerId, controller.signal),
    ])
      .then(([nextProfile, nextSeasonSummary]) => {
        if (cancelled) return;
        playerQuickViewCache.set(playerId, nextProfile);
        playerQuickViewSeasonCache.set(latestKey, nextSeasonSummary);
        if (nextSeasonSummary?.season != null) {
          const seasonKey = seasonCacheKey(playerId, nextSeasonSummary.season);
          if (!playerQuickViewSeasonCache.has(seasonKey)) {
            playerQuickViewSeasonCache.set(seasonKey, nextSeasonSummary);
          }
        }
        setProfile(nextProfile);
        setLatestSeasonSummary(nextSeasonSummary);
        setSelectedSeason(nextSeasonSummary?.season ?? null);
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error ? nextError.message : 'Failed to load player quick view.'
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, open, playerId, prospect]);

  useEffect(() => {
    if (!open || !profile || selectedSeason != null || loading) return;
    const seasons = profile.seasonsPlayed ?? [];
    const fallbackSeason = seasons.length > 0 ? Math.max(...seasons) : null;
    const nextSeason = latestSeasonSummary?.season ?? fallbackSeason;
    if (nextSeason != null) {
      setSelectedSeason(nextSeason);
    }
  }, [latestSeasonSummary?.season, loading, open, profile, selectedSeason]);

  useEffect(() => {
    if (!open || prospect || !playerId || selectedSeason == null) return;
    if (latestSeasonSummary?.season === selectedSeason) return;

    const cacheKey = seasonCacheKey(playerId, selectedSeason);
    if (playerQuickViewSeasonCache.has(cacheKey)) {
      setLatestSeasonSummary(playerQuickViewSeasonCache.get(cacheKey) ?? null);
      setSeasonLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setSeasonLoading(true);

    fetchPlayerSeasonSummary(apiBase, playerId, selectedSeason, controller.signal)
      .then((nextSeasonSummary) => {
        if (cancelled) return;
        playerQuickViewSeasonCache.set(cacheKey, nextSeasonSummary);
        setLatestSeasonSummary(nextSeasonSummary);
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
      })
      .finally(() => {
        if (cancelled) return;
        setSeasonLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, latestSeasonSummary?.season, open, playerId, prospect, selectedSeason]);

  if (!open || (!playerId && !prospect)) return null;

  const isProspectView = Boolean(prospect);
  const profileHref = playerId ? `/gridstream/players/${encodeURIComponent(playerId)}` : null;
  const prospectAccent = resolveProspectAccentColors(prospect);
  const primaryAccent = normalizeColorToken(
    profile?.currentTeamColors?.primary,
    isProspectView ? prospectAccent.primary : C.accent
  );
  const secondaryAccent = normalizeColorToken(
    profile?.currentTeamColors?.secondary,
    isProspectView ? prospectAccent.secondary : '#8edbff'
  );
  const accentSoft = toRgba(primaryAccent, 0.16);
  const playerDisplayContext = profile ? resolvePlayerDisplayContext(profile) : null;
  const teamLabel =
    prospect?.school ||
    playerDisplayContext?.teamName ||
    profile?.currentTeamName ||
    profile?.teamAbbr ||
    'Free Agent';
  const quickMetrics = profile ? buildQuickMetrics(profile, latestSeasonSummary) : [];
  const seasonOptions =
    profile?.seasonsPlayed && profile.seasonsPlayed.length > 0
      ? Array.from(new Set(profile.seasonsPlayed)).sort((a, b) => b - a)
      : [];
  const resolvedSeason = selectedSeason ?? latestSeasonSummary?.season ?? seasonOptions[0] ?? null;
  const prospectQuickMetrics = prospect ? buildProspectQuickMetrics(prospect) : [];
  const prospectStrengths = prospect?.strengths ?? [];
  const prospectWeaknesses = prospect?.weaknesses ?? [];
  const prospectHonors = prospect?.honors ?? [];
  const prospectComparisons = prospect?.comparisonPlayers ?? [];
  const prospectRatings = prospect
    ? (prospect.scoutingGrades ?? []).map((grade) => {
        if (grade.label.trim().toLowerCase() === 'position rank') {
          return {
            ...grade,
            value: formatProspectPositionRank(prospect),
          };
        }
        return grade;
      })
    : [];
  const prospectRecruiting = prospect?.recruitingRatings ?? [];
  const prospectFitTeams = prospect?.fitTeams ?? [];
  const prospectSnapshotItems = prospect
    ? [
        { label: 'School', value: prospect.school || '—' },
        { label: 'Position', value: formatProspectPositionLabel(prospect.position) },
        {
          label: 'Class',
          value: prospect.classYear || '—',
        },
        { label: 'Hometown', value: prospect.hometown || '—' },
        {
          label: 'Height / Weight',
          value: formatProspectMeasurements(prospect),
        },
        {
          label: 'Age',
          value: formatProspectAge(prospect),
        },
        {
          label: 'Consensus Range',
          value: formatProspectConsensusRange(prospect),
        },
        {
          label: 'Position Rank',
          value: formatProspectPositionRank(prospect),
        },
        {
          label: 'Last Updated',
          value:
            formatCalendarDate(prospect.sourceLastUpdated) || prospect.sourceLastUpdated || '—',
        },
      ].filter(
        (
          item
        ): item is {
          label: string;
          value: string;
        } => Boolean(item.value)
      )
    : [];
  const prospectHeroImageUrls = buildProspectImageCandidates(prospect?.imageUrl).map(
    (url) =>
      `${url}${url.includes('?') ? '&' : '?'}gsv=${encodeURIComponent(
        prospect?.sourceLastUpdated || prospect?.sourceUrl || prospect?.name || 'prospect'
      )}`
  );
  const prospectHeroImageUrl =
    prospectHeroImageUrls[prospectHeroImageIndex] ?? prospectHeroImageUrls[0] ?? null;
  const positionBadgeStyle = getPositionBadgeStyle(primaryAccent, secondaryAccent);
  const statusBadgeStyle = profile
    ? getRosterStatusBadgeStyle(
        playerDisplayContext?.statusLabel ?? formatRosterStatus(profile),
        playerDisplayContext?.isMarkedActive ?? profile.isActive,
        primaryAccent,
        secondaryAccent
      )
    : undefined;
  const sectionFrameStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
    border: `1px solid ${C.border}`,
    background: 'rgba(0,8,20,.34)',
    padding: '9px 12px 12px',
  };
  const sectionHeadingStyle: CSSProperties = {
    color: '#78a3c1',
    fontSize: 10,
    letterSpacing: '.1em',
    fontFamily: "'Orbitron', monospace",
  };
  const drawerTitle = prospect?.name || profile?.displayName || playerLabel || 'Loading player';
  const drawerEyebrow = prospect ? 'DRAFT PROSPECT PREVIEW' : 'PLAYER QUICK VIEW';
  const dialogLabel = prospect ? `${drawerTitle} prospect preview` : `${drawerTitle} quick view`;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(1,6,16,.72)',
          backdropFilter: 'blur(6px)',
          zIndex: 70,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(92vw, 460px)',
          background: `linear-gradient(180deg, rgba(0,18,38,.98) 0%, rgba(0,8,20,.98) 100%)`,
          borderLeft: `1px solid ${C.border}`,
          boxShadow: '-18px 0 48px rgba(0,0,0,.45)',
          zIndex: 71,
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
        }}
      >
        <div
          style={{
            padding: '16px 18px 14px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <div
              style={{
                color: '#78a3c1',
                fontSize: 10,
                letterSpacing: '.1em',
                fontFamily: "'Orbitron', monospace",
              }}
            >
              {drawerEyebrow}
            </div>
            <div style={{ color: C.textPrimary, fontSize: 20, fontWeight: 700, lineHeight: 1.15 }}>
              {drawerTitle}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: `1px solid ${C.border}`,
              color: C.textSecondary,
              fontSize: 11,
              letterSpacing: '.08em',
              fontFamily: "'Orbitron', monospace",
              padding: '7px 9px',
              cursor: 'pointer',
            }}
          >
            CLOSE
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '18px', display: 'grid', gap: 16 }}>
          {loading && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div
                style={{
                  height: 112,
                  border: `1px solid ${C.border}`,
                  background: 'rgba(0,8,20,.44)',
                }}
              />
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                }}
              >
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    style={{
                      height: 74,
                      border: `1px solid ${C.border}`,
                      background: 'rgba(0,8,20,.32)',
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <div
              style={{
                border: `1px solid rgba(244,63,94,.24)`,
                background: 'rgba(244,63,94,.08)',
                color: '#ffb3c0',
                padding: '14px 15px',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          {!loading && profile && (
            <>
              <section
                style={{
                  display: 'grid',
                  gap: 14,
                  border: `1px solid ${toRgba(primaryAccent, 0.34)}`,
                  background: `linear-gradient(145deg, ${accentSoft} 0%, rgba(0,8,20,.7) 68%)`,
                  padding: '16px',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    minHeight: 148,
                    overflow: 'hidden',
                    border: `1px solid ${toRgba(primaryAccent, 0.18)}`,
                    background:
                      'linear-gradient(135deg, rgba(0,18,38,.68) 0%, rgba(0,8,20,.92) 100%)',
                  }}
                >
                  {profile.headshotUrl ? (
                    <>
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 0,
                          pointerEvents: 'none',
                          background: [
                            `linear-gradient(90deg, ${toRgba(primaryAccent, 0.12)} 0%, rgba(0,0,0,.08) 20%, rgba(0,8,20,.42) 40%, rgba(0,8,20,.9) 62%, rgba(0,8,20,.98) 100%)`,
                            `radial-gradient(circle at 18% 50%, ${toRgba(secondaryAccent, 0.24)} 0%, transparent 32%)`,
                          ].join(', '),
                        }}
                      />
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          inset: '0 auto 0 0',
                          width: 168,
                          background: `center 28% / cover no-repeat url("${profile.headshotUrl}")`,
                          filter: 'saturate(1.02) contrast(1.04)',
                          zIndex: 1,
                        }}
                      />
                    </>
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        inset: '12px auto 12px 12px',
                        width: 112,
                        border: `1px solid ${toRgba(primaryAccent, 0.24)}`,
                        background: `linear-gradient(145deg, ${toRgba(primaryAccent, 0.28)} 0%, rgba(0,8,20,.88) 100%)`,
                        display: 'grid',
                        placeItems: 'center',
                        color: C.textPrimary,
                        fontSize: 28,
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {profile.displayName
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)}
                    </div>
                  )}

                  <div
                    style={{
                      position: 'relative',
                      zIndex: 2,
                      minHeight: 148,
                      padding: profile.headshotUrl
                        ? '16px 16px 16px 148px'
                        : '16px 16px 16px 136px',
                      display: 'grid',
                      alignContent: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      {profile.jerseyNumber && (
                        <span
                          style={{
                            color: C.textPrimary,
                            fontSize: 16,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          #{profile.jerseyNumber}
                        </span>
                      )}
                      <span style={positionBadgeStyle}>
                        {profile.position || profile.positionGroup || 'PLAYER'}
                      </span>
                      <span style={statusBadgeStyle}>
                        {playerDisplayContext?.statusLabel ?? formatRosterStatus(profile)}
                      </span>
                    </div>
                    <div
                      style={{
                        color: C.textPrimary,
                        fontSize: 24,
                        fontWeight: 700,
                        lineHeight: 1.1,
                      }}
                    >
                      {playerDisplayContext?.displayName ?? profile.displayName}
                    </div>
                    <div
                      style={{
                        color: C.textSecondary,
                        fontSize: 15,
                        fontWeight: 600,
                        lineHeight: 1.3,
                      }}
                    >
                      {teamLabel}
                      {playerDisplayContext?.teamAbbr ? ` · ${playerDisplayContext.teamAbbr}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {profile.latestFfRanking && (
                        <span
                          style={{
                            color: '#8fff45',
                            background: 'rgba(134,239,172,.12)',
                            border: '1px solid rgba(134,239,172,.24)',
                            padding: '3px 6px',
                            fontSize: 10,
                            fontFamily: "'Orbitron', monospace",
                            letterSpacing: '.06em',
                          }}
                        >
                          {profile.latestFfRanking.positionRank != null
                            ? `ECR ${profile.latestFfRanking.position}${profile.latestFfRanking.positionRank}`
                            : `ECR #${Math.round(profile.latestFfRanking.rank)}`}
                        </span>
                      )}
                      {profile.maddenRating && (
                        <span
                          style={{
                            color: '#c084fc',
                            background: 'rgba(168,85,247,.12)',
                            border: '1px solid rgba(168,85,247,.24)',
                            padding: '3px 6px',
                            fontSize: 10,
                            fontFamily: "'Orbitron', monospace",
                            letterSpacing: '.06em',
                          }}
                        >
                          MADDEN {profile.maddenRating.overall}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    alignContent: 'start',
                  }}
                >
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      color: '#78a3c1',
                      fontSize: 10,
                      letterSpacing: '.1em',
                      fontFamily: "'Orbitron', monospace",
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {seasonOptions.length > 0 ? (
                      <select
                        aria-label="Season"
                        value={resolvedSeason ?? seasonOptions[0]}
                        onChange={(event) => {
                          const nextSeason = Number(event.target.value);
                          if (!Number.isNaN(nextSeason)) {
                            setSelectedSeason(nextSeason);
                          }
                        }}
                        disabled={seasonLoading}
                        style={{
                          appearance: 'none',
                          background: seasonLoading ? 'rgba(0,8,20,.35)' : 'rgba(0,8,20,.6)',
                          border: `1px solid ${C.border}`,
                          color: '#78a3c1',
                          fontSize: 10,
                          letterSpacing: '.1em',
                          fontFamily: "'Orbitron', monospace",
                          minWidth: 156,
                          padding: '4px 24px 4px 8px',
                          borderRadius: 6,
                          cursor: seasonLoading ? 'wait' : 'pointer',
                          textTransform: 'uppercase',
                        }}
                      >
                        {seasonOptions.map((season) => (
                          <option key={season} value={season}>
                            {season} SEASON
                          </option>
                        ))}
                      </select>
                    ) : (
                      'CAREER SNAPSHOT'
                    )}
                    {seasonOptions.length > 0 && (
                      <span
                        aria-hidden="true"
                        style={{
                          marginLeft: -24,
                          fontSize: 12,
                          color: toRgba(C.textMuted, 0.8),
                          pointerEvents: 'none',
                        }}
                      >
                        ▾
                      </span>
                    )}
                  </div>
                  {quickMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.45)',
                        padding: '9px 10px',
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
                        {metric.label}
                      </div>
                      <div
                        style={{
                          color: metric.tone || C.textPrimary,
                          fontSize: 20,
                          fontWeight: 700,
                          lineHeight: 1.1,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {metric.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={sectionFrameStyle}>
                <div style={sectionHeadingStyle}>SNAPSHOT</div>
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    alignContent: 'start',
                  }}
                >
                  {[
                    { label: 'Age', value: profile.age != null ? String(profile.age) : '—' },
                    { label: 'Height / Weight', value: formatHeightWeight(profile) },
                    { label: 'Birth Date', value: formatBirthDate(profile.birthDate) },
                    { label: 'College', value: profile.college || '—' },
                    { label: 'Draft', value: formatGridstreamDraftLabel(profile) },
                    {
                      label: 'Experience',
                      value:
                        profile.yearsExperience != null
                          ? `${profile.yearsExperience} yr${profile.yearsExperience === 1 ? '' : 's'}`
                          : '—',
                    },
                    { label: 'Seasons', value: formatGridstreamSeasonRange(profile.seasonsPlayed) },
                    { label: 'Games', value: formatCompactNumber(profile.gamesPlayed) },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.38)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          color: C.textMuted,
                          fontSize: 9,
                          letterSpacing: '.08em',
                          fontFamily: "'Orbitron', monospace",
                        }}
                      >
                        {item.label}
                      </div>
                      <div style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.35 }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={sectionFrameStyle}>
                <div style={sectionHeadingStyle}>CURRENT CONTEXT</div>
                <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                  <div
                    style={{
                      border: `1px solid ${C.border}`,
                      background: 'rgba(0,8,20,.38)',
                      padding: '9px 10px',
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        color: C.textMuted,
                        fontSize: 9,
                        letterSpacing: '.08em',
                        fontFamily: "'Orbitron', monospace",
                      }}
                    >
                      CONTRACT
                    </div>
                    <div style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.45 }}>
                      {formatContractSummary(profile)}
                    </div>
                  </div>
                  <div
                    style={{
                      border: `1px solid ${C.border}`,
                      background: 'rgba(0,8,20,.38)',
                      padding: '9px 10px',
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        color: C.textMuted,
                        fontSize: 9,
                        letterSpacing: '.08em',
                        fontFamily: "'Orbitron', monospace",
                      }}
                    >
                      LATEST TRANSACTION
                    </div>
                    <div style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.45 }}>
                      {formatRecentTransaction(profile)}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {!loading && prospect && (
            <>
              <section
                style={{
                  display: 'grid',
                  gap: 14,
                  border: `1px solid ${toRgba(primaryAccent, 0.34)}`,
                  background: `linear-gradient(145deg, ${accentSoft} 0%, rgba(0,8,20,.7) 68%)`,
                  padding: '16px',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    minHeight: 148,
                    overflow: 'hidden',
                    border: `1px solid ${toRgba(primaryAccent, 0.18)}`,
                    background:
                      'linear-gradient(135deg, rgba(0,18,38,.68) 0%, rgba(0,8,20,.92) 100%)',
                  }}
                >
                  {prospectHeroImageUrl ? (
                    <>
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: [
                            `radial-gradient(circle at 18% 54%, ${toRgba(primaryAccent, 0.38)} 0%, ${toRgba(
                              primaryAccent,
                              0.2
                            )} 24%, transparent 44%)`,
                            `radial-gradient(circle at 26% 28%, ${toRgba(secondaryAccent, 0.26)} 0%, transparent 26%)`,
                            'linear-gradient(90deg, rgba(0,12,28,.08) 0%, rgba(0,12,28,.04) 28%, rgba(0,8,20,.58) 56%, rgba(0,8,20,.94) 100%)',
                          ].join(', '),
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: '0 auto 0 0',
                          width: 184,
                          height: '100%',
                          zIndex: 2,
                        }}
                      >
                        <Image
                          src={prospectHeroImageUrl}
                          alt=""
                          fill
                          sizes="184px"
                          unoptimized
                          loader={remoteImageLoader}
                          style={{
                            objectFit: 'contain',
                            objectPosition: 'left bottom',
                            filter: 'saturate(1.02) contrast(1.04)',
                            display: 'block',
                          }}
                          onError={() => {
                            setProspectHeroImageIndex((current) =>
                              current + 1 < prospectHeroImageUrls.length ? current + 1 : current
                            );
                          }}
                        />
                      </div>
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 1,
                          background:
                            'linear-gradient(90deg, transparent 0%, transparent 32%, rgba(0,8,20,.38) 52%, rgba(0,8,20,.9) 70%, rgba(0,8,20,.98) 100%)',
                        }}
                      />
                    </>
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        inset: '12px auto 12px 12px',
                        width: 112,
                        border: `1px solid ${toRgba(primaryAccent, 0.24)}`,
                        background: prospect.collegeLogoUrl
                          ? `${toRgba(primaryAccent, 0.18)} center / 62% no-repeat url("${prospect.collegeLogoUrl}")`
                          : `linear-gradient(145deg, ${toRgba(primaryAccent, 0.28)} 0%, rgba(0,8,20,.88) 100%)`,
                        display: 'grid',
                        placeItems: 'center',
                        color: C.textPrimary,
                        fontSize: 28,
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {!prospect.collegeLogoUrl
                        ? prospect.name
                            .split(' ')
                            .map((part) => part[0])
                            .join('')
                            .slice(0, 2)
                        : null}
                    </div>
                  )}

                  <div
                    style={{
                      position: 'relative',
                      zIndex: 3,
                      minHeight: 148,
                      padding: prospectHeroImageUrl
                        ? '16px 16px 16px 150px'
                        : '16px 16px 16px 136px',
                      display: 'grid',
                      alignContent: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      {prospect.jerseyNumber && (
                        <span
                          style={{
                            color: C.textPrimary,
                            fontSize: 16,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          #{prospect.jerseyNumber}
                        </span>
                      )}
                      <span style={positionBadgeStyle}>{prospect.position || 'PROSPECT'}</span>
                      <span
                        style={{
                          border: '1px solid rgba(125,211,252,.34)',
                          background: 'rgba(56,189,248,.12)',
                          color: '#b9efff',
                          padding: '4px 8px',
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: "'Orbitron', monospace",
                          letterSpacing: '.08em',
                        }}
                      >
                        DRAFT TARGET
                      </span>
                    </div>
                    <div
                      style={{
                        color: C.textPrimary,
                        fontSize: 24,
                        fontWeight: 700,
                        lineHeight: 1.1,
                      }}
                    >
                      {prospect.name}
                    </div>
                    <div
                      style={{
                        color: C.textPrimary,
                        fontSize: 15,
                        fontWeight: 600,
                        lineHeight: 1.3,
                      }}
                    >
                      {teamLabel}
                      {prospect.classYear ? ` · ${prospect.classYear}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          color: '#7ee7ff',
                          background: 'rgba(34,211,238,.12)',
                          border: '1px solid rgba(34,211,238,.24)',
                          padding: '3px 6px',
                          fontSize: 10,
                          fontFamily: "'Orbitron', monospace",
                          letterSpacing: '.06em',
                        }}
                      >
                        {formatProspectConsensusLabel(prospect.consensusType)}
                      </span>
                      {prospect.buzzOverallRating != null && (
                        <span
                          style={{
                            color: '#8fff45',
                            background: 'rgba(134,239,172,.12)',
                            border: '1px solid rgba(134,239,172,.24)',
                            padding: '3px 6px',
                            fontSize: 10,
                            fontFamily: "'Orbitron', monospace",
                            letterSpacing: '.06em',
                          }}
                        >
                          RATING {prospect.buzzOverallRating.toFixed(1)}
                        </span>
                      )}
                      {prospect.buzzOverallRank != null && (
                        <span
                          style={{
                            color: '#ffcf6b',
                            background: 'rgba(255,182,18,.12)',
                            border: '1px solid rgba(255,182,18,.24)',
                            padding: '3px 6px',
                            fontSize: 10,
                            fontFamily: "'Orbitron', monospace",
                            letterSpacing: '.06em',
                          }}
                        >
                          BUZZ #{prospect.buzzOverallRank}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    alignContent: 'start',
                  }}
                >
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      color: '#78a3c1',
                      fontSize: 10,
                      letterSpacing: '.1em',
                      fontFamily: "'Orbitron', monospace",
                    }}
                  >
                    {prospect.draftSeason != null
                      ? `${prospect.draftSeason} DRAFT OUTLOOK`
                      : 'DRAFT OUTLOOK'}
                  </div>
                  {prospectQuickMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.45)',
                        padding: '9px 10px',
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
                        {metric.label}
                      </div>
                      <div
                        style={{
                          color: metric.tone || C.textPrimary,
                          fontSize: 20,
                          fontWeight: 700,
                          lineHeight: 1.1,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {metric.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={sectionFrameStyle}>
                <div style={sectionHeadingStyle}>SNAPSHOT</div>
                <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                  <div
                    style={{
                      display: 'grid',
                      gap: 10,
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      alignContent: 'start',
                    }}
                  >
                    {prospectSnapshotItems.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          border: `1px solid ${C.border}`,
                          background: 'rgba(0,8,20,.38)',
                          padding: '9px 10px',
                          display: 'grid',
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            color: C.textMuted,
                            fontSize: 9,
                            letterSpacing: '.08em',
                            fontFamily: "'Orbitron', monospace",
                          }}
                        >
                          {item.label}
                        </div>
                        <div style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.35 }}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {prospectRatings.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.38)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          color: C.textMuted,
                          fontSize: 9,
                          letterSpacing: '.08em',
                          fontFamily: "'Orbitron', monospace",
                        }}
                      >
                        GRADES
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gap: 8,
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        }}
                      >
                        {prospectRatings.slice(0, 6).map((item) => (
                          <div
                            key={item.label}
                            style={{
                              border: `1px solid ${C.border}`,
                              background: 'rgba(0,8,20,.42)',
                              padding: '8px 9px',
                              display: 'grid',
                              gap: 4,
                            }}
                          >
                            <div
                              style={{
                                color: C.textMuted,
                                fontSize: 9,
                                letterSpacing: '.08em',
                                fontFamily: "'Orbitron', monospace",
                              }}
                            >
                              {item.label}
                            </div>
                            <div
                              style={{
                                color: C.textPrimary,
                                fontSize: 13,
                                lineHeight: 1.35,
                              }}
                            >
                              {item.value || '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section style={sectionFrameStyle}>
                <div style={sectionHeadingStyle}>SCOUTING REPORT</div>
                <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                  {prospectRecruiting.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.38)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          color: C.textMuted,
                          fontSize: 9,
                          letterSpacing: '.08em',
                          fontFamily: "'Orbitron', monospace",
                        }}
                      >
                        RECRUITING / SERVICE RANKS
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {prospectRecruiting.map((item) => (
                          <span
                            key={item.label}
                            style={{
                              color: '#dff8ff',
                              border: `1px solid ${C.border}`,
                              background: 'rgba(0,8,20,.42)',
                              padding: '5px 7px',
                              fontSize: 10,
                              fontFamily: "'Orbitron', monospace",
                              letterSpacing: '.06em',
                            }}
                          >
                            {item.label} {item.value || '—'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {prospectStrengths.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.38)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          color: '#8fff45',
                          fontSize: 9,
                          letterSpacing: '.08em',
                          fontFamily: "'Orbitron', monospace",
                        }}
                      >
                        STRENGTHS
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {prospectStrengths.map((item) => (
                          <div
                            key={item}
                            style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.45 }}
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {prospectWeaknesses.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.38)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          color: '#ff9cb4',
                          fontSize: 9,
                          letterSpacing: '.08em',
                          fontFamily: "'Orbitron', monospace",
                        }}
                      >
                        WEAKNESSES
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {prospectWeaknesses.map((item) => (
                          <div
                            key={item}
                            style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.45 }}
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(prospectHonors.length > 0 || prospectComparisons.length > 0) && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,8,20,.38)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 10,
                      }}
                    >
                      {prospectHonors.length > 0 && (
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div
                            style={{
                              color: C.textMuted,
                              fontSize: 9,
                              letterSpacing: '.08em',
                              fontFamily: "'Orbitron', monospace",
                            }}
                          >
                            HONORS
                          </div>
                          <div style={{ display: 'grid', gap: 6 }}>
                            {prospectHonors.map((item) => (
                              <div
                                key={item}
                                style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.45 }}
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {prospectComparisons.length > 0 && (
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div
                            style={{
                              color: C.textMuted,
                              fontSize: 9,
                              letterSpacing: '.08em',
                              fontFamily: "'Orbitron', monospace",
                            }}
                          >
                            COMPS
                          </div>
                          <div style={{ display: 'grid', gap: 6 }}>
                            {prospectComparisons.slice(0, 3).map((item) => {
                              const label = [
                                item.name,
                                item.school || null,
                                item.similarity != null ? `${item.similarity}%` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ');
                              return item.sourceUrl ? (
                                <a
                                  key={label}
                                  href={item.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    color: C.linkCyan,
                                    fontSize: 13,
                                    lineHeight: 1.45,
                                    textDecoration: 'underline',
                                    textDecorationColor: 'rgba(99,223,255,.45)',
                                    textUnderlineOffset: '0.2em',
                                  }}
                                >
                                  {label}
                                </a>
                              ) : (
                                <div
                                  key={label}
                                  style={{ color: C.textPrimary, fontSize: 13, lineHeight: 1.45 }}
                                >
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section style={sectionFrameStyle}>
                <div style={sectionHeadingStyle}>DRAFT CONTEXT</div>
                <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                  <div
                    style={{
                      border: `1px solid ${C.border}`,
                      background: 'rgba(0,8,20,.38)',
                      padding: '9px 10px',
                      display: 'grid',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        color: C.textMuted,
                        fontSize: 9,
                        letterSpacing: '.08em',
                        fontFamily: "'Orbitron', monospace",
                      }}
                    >
                      TEAM FITS
                    </div>
                    {prospectFitTeams.length > 0 ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {prospectFitTeams.map((fit) => {
                          const isCurrentTeam =
                            fit.team?.abbreviation &&
                            prospect.teamAbbr &&
                            fit.team.abbreviation === prospect.teamAbbr;
                          return (
                            <div
                              key={`${fit.team?.abbreviation ?? 'team'}-${fit.overallPick ?? fit.pickLabel ?? 'fit'}`}
                              style={{
                                border: `1px solid ${
                                  isCurrentTeam ? 'rgba(99,223,255,.28)' : C.border
                                }`,
                                background: isCurrentTeam
                                  ? 'rgba(10,32,54,.62)'
                                  : 'rgba(0,8,20,.42)',
                                padding: '8px 9px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                  minWidth: 0,
                                  color: C.textPrimary,
                                  fontSize: 13,
                                  lineHeight: 1.35,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  {fit.team?.logoUrl ? (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={fit.team.logoUrl}
                                        alt=""
                                        width={18}
                                        height={18}
                                        style={{ display: 'block', objectFit: 'contain' }}
                                      />
                                    </>
                                  ) : null}
                                  <span>
                                    {fit.team?.displayName || fit.team?.abbreviation || 'Team fit'}
                                  </span>
                                </div>
                                <span style={{ color: C.textSecondary }}>-</span>
                                <span style={{ color: C.textSecondary }}>
                                  {formatProspectFitDetail(fit)}
                                </span>
                                {isCurrentTeam ? (
                                  <span
                                    style={{
                                      color: '#7ee7ff',
                                      fontSize: 9,
                                      letterSpacing: '.08em',
                                      fontFamily: "'Orbitron', monospace",
                                      whiteSpace: 'nowrap',
                                      marginLeft: 'auto',
                                    }}
                                  >
                                    CURRENT
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: C.textSecondary, fontSize: 13, lineHeight: 1.45 }}>
                        {[
                          prospect.fitReason || null,
                          prospect.needLabel ? `${prospect.needLabel} fit` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Team fits will sharpen as draft range and needs settle.'}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            padding: '14px 18px 16px',
            background: 'rgba(0,8,20,.84)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.4 }}>
            {prospect
              ? 'Prospect pages are not live yet. This preview uses consensus fit data plus NFLDraftBuzz scouting info.'
              : 'Full stats, splits, contracts, and history live on the player page.'}
          </div>
          {prospect?.sourceUrl ? (
            <a
              href={prospect.sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                color: pickReadableTextColor(primaryAccent),
                background: primaryAccent,
                textDecoration: 'none',
                padding: '10px 12px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '.08em',
                fontFamily: "'Orbitron', monospace",
                whiteSpace: 'nowrap',
              }}
            >
              VIEW SOURCE
            </a>
          ) : profileHref ? (
            <Link
              href={profileHref}
              onClick={onClose}
              style={{
                color: pickReadableTextColor(primaryAccent),
                background: primaryAccent,
                textDecoration: 'none',
                padding: '10px 12px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '.08em',
                fontFamily: "'Orbitron', monospace",
                whiteSpace: 'nowrap',
              }}
            >
              VIEW FULL PROFILE
            </Link>
          ) : null}
        </div>
      </aside>
    </>
  );
}
