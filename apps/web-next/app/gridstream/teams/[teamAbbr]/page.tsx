'use client';

/**
 * Route: /gridstream/teams/[teamAbbr]
 *
 * Individual franchise page — header + team tabs (Overview, Season Stats, Roster, Free Agency, Schedule, Rankings).
 */

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  fetchGridstreamTeamProfile,
  fetchGridstreamTeamFreeAgentTracker,
  fetchGridstreamTeamStandings,
  formatTeamRecord,
  type GridstreamTeamFreeAgentTrackerResponse,
  type GridstreamTeamProfile,
  type GridstreamTeamStanding,
} from '@atlas/sdk/gridstream';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';

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
import TeamStatsTabs, { type TeamTab } from './TeamStatsTabs';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);

const CURRENT_SEASON = 2025;

function resolveTrackerSeason(currentSeason: number): number | null {
  const today = new Date();
  const offseasonSeason = currentSeason + 1;
  const isOffseasonWindow =
    today.getFullYear() === offseasonSeason && today.getMonth() >= 1 && today.getMonth() < 7;
  return isOffseasonWindow ? offseasonSeason : null;
}

// ---------------------------------------------------------------------------

export default function TeamDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const abbr = ((params?.teamAbbr as string) ?? '').toUpperCase();

  const tabParam = (searchParams.get('tab') as TeamTab | null) ?? 'overview';
  const activeTab: TeamTab = [
    'overview',
    'season-stats',
    'roster',
    'free-agency',
    'schedule',
    'rankings',
  ].includes(tabParam)
    ? (tabParam as TeamTab)
    : 'overview';

  const [profile, setProfile] = useState<GridstreamTeamProfile | null>(null);
  const [currentStanding, setCurrentStanding] = useState<GridstreamTeamStanding | null>(null);
  const [sharedFreeAgencyTracker, setSharedFreeAgencyTracker] =
    useState<GridstreamTeamFreeAgentTrackerResponse | null>(null);
  const [sharedFreeAgencyTrackerLoading, setSharedFreeAgencyTrackerLoading] = useState(true);
  const [sharedFreeAgencyTrackerError, setSharedFreeAgencyTrackerError] = useState<string | null>(
    null
  );
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const trackerSeason = resolveTrackerSeason(CURRENT_SEASON);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!abbr) return;
    let cancelled = false;
    setLoadingProfile(true);
    setError(null);
    setSharedFreeAgencyTracker(null);
    setSharedFreeAgencyTrackerLoading(true);
    setSharedFreeAgencyTrackerError(null);

    Promise.all([
      fetchGridstreamTeamProfile(API_BASE, abbr),
      fetchGridstreamTeamStandings(API_BASE, CURRENT_SEASON),
    ])
      .then(([p, standings]) => {
        if (cancelled) return;
        setProfile(p);
        const s = standings.find((st) => st.abbreviation === abbr) ?? null;
        setCurrentStanding(s);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message ?? err));
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });

    fetchGridstreamTeamFreeAgentTracker(
      API_BASE,
      abbr,
      trackerSeason != null ? { season: trackerSeason } : undefined
    )
      .then((tracker) => {
        if (!cancelled) setSharedFreeAgencyTracker(tracker);
      })
      .catch((err) => {
        if (!cancelled) setSharedFreeAgencyTrackerError(String(err?.message ?? err));
      })
      .finally(() => {
        if (!cancelled) setSharedFreeAgencyTrackerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [abbr, trackerSeason]);

  const handleTabChange = (tab: TeamTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/gridstream/teams/${abbr}?${params.toString()}`);
  };

  if (loadingProfile) {
    return (
      <main
        className="gs-players-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div
          style={{
            color: C.textMuted,
            fontSize: 13,
            letterSpacing: '.1em',
            fontFamily: "'Orbitron', monospace",
          }}
        >
          LOADING TEAM DATA…
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main
        className="gs-players-page"
        style={{
          color: C.textPrimary,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        <div style={{ color: '#ff8fa0', fontSize: 14 }}>{error ?? 'Team not found.'}</div>
        <Link
          href="/gridstream/teams"
          style={{ color: C.linkCyan, fontSize: 12, textDecoration: 'none' }}
        >
          ← Back to Teams
        </Link>
      </main>
    );
  }

  const accent = `#${profile.colorPrimary}`;
  const accentSecondary = profile.colorSecondary
    ? `#${profile.colorSecondary}`
    : 'rgba(255,255,255,.4)';
  const logoUrl = profile.logoScoreboardUrl ?? profile.logoUrl;
  const divisionMeta = [profile.conference, profile.division].filter(Boolean).join(' · ');
  const record = formatTeamRecord(
    currentStanding?.wins ?? null,
    currentStanding?.losses ?? null,
    currentStanding?.ties ?? null
  );
  const mobileHeroStats = [
    { label: 'RECORD', value: record, color: accent, large: true },
    currentStanding?.divRank != null
      ? { label: 'DIV RANK', value: `#${currentStanding.divRank}`, color: accentSecondary }
      : null,
    currentStanding?.pointsFor != null
      ? { label: 'PF', value: String(currentStanding.pointsFor), color: C.textSecondary }
      : null,
    currentStanding?.pointsAgainst != null
      ? { label: 'PA', value: String(currentStanding.pointsAgainst), color: C.textSecondary }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string; color: string; large?: boolean }>;

  return (
    <main className="gs-players-page" style={{ color: C.textPrimary }}>
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Hero header band */}
        <div
          style={{
            background: `linear-gradient(135deg, ${accent}22 0%, rgba(5,12,24,.92) 60%)`,
            borderBottom: `2px solid ${accent}60`,
            padding: isMobile ? '18px 16px 18px' : '28px 24px 24px',
          }}
        >
          <div style={{ maxWidth: 1360, margin: '0 auto' }}>
            {/* Breadcrumb */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: isMobile ? 14 : 16,
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/gridstream"
                style={{
                  color: C.textMuted,
                  fontSize: isMobile ? 10 : 11,
                  textDecoration: 'none',
                  letterSpacing: '.08em',
                }}
              >
                GRIDSTREAM
              </Link>
              <span style={{ color: C.textMuted, fontSize: 10 }}>›</span>
              <Link
                href="/gridstream/teams"
                style={{
                  color: C.textMuted,
                  fontSize: 11,
                  textDecoration: 'none',
                  letterSpacing: '.08em',
                }}
              >
                TEAMS
              </Link>
              <span style={{ color: C.textMuted, fontSize: 10 }}>›</span>
              <span
                style={{
                  color: accent,
                  fontSize: isMobile ? 10 : 11,
                  letterSpacing: '.08em',
                  fontFamily: "'Orbitron', monospace",
                }}
              >
                {abbr}
              </span>
            </div>

            {/* Main header row */}
            <div style={{ display: 'grid', gap: isMobile ? 16 : 24 }}>
              <div
                style={{
                  display: 'grid',
                  gap: isMobile ? 14 : 24,
                  gridTemplateColumns: isMobile ? '1fr' : 'auto minmax(0, 1fr) auto',
                  alignItems: isMobile ? 'stretch' : 'center',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: isMobile ? 14 : 24,
                    minWidth: 0,
                  }}
                >
                  {logoUrl ? (
                    <Image
                      src={logoUrl}
                      alt={profile.displayName}
                      width={isMobile ? 86 : 96}
                      height={isMobile ? 86 : 96}
                      unoptimized
                      loader={remoteImageLoader}
                      style={{
                        objectFit: 'contain',
                        flexShrink: 0,
                        filter: 'drop-shadow(0 0 12px rgba(0,0,0,.8))',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: isMobile ? 86 : 96,
                        height: isMobile ? 86 : 96,
                        background: accent,
                        opacity: 0.3,
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                    />
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    {divisionMeta ? (
                      <div
                        style={{
                          color: accentSecondary,
                          fontSize: isMobile ? 10 : 12,
                          letterSpacing: '.12em',
                          fontFamily: "'Orbitron', monospace",
                          fontWeight: 700,
                          marginBottom: isMobile ? 6 : 4,
                        }}
                      >
                        {divisionMeta}
                      </div>
                    ) : null}
                    <h1
                      style={{
                        margin: '0 0 4px',
                        fontSize: isMobile ? 28 : 'clamp(22px, 3.5vw, 40px)',
                        letterSpacing: '.02em',
                        lineHeight: 1.05,
                        maxWidth: isMobile ? '100%' : undefined,
                      }}
                    >
                      {isMobile ? (
                        <span style={{ color: '#fff' }}>{profile.displayName}</span>
                      ) : (
                        <>
                          <span style={{ color: accentSecondary, marginRight: 10 }}>
                            {profile.location}
                          </span>
                          <span style={{ color: '#fff' }}>{profile.name}</span>
                        </>
                      )}
                    </h1>
                    <div style={{ color: C.textSecondary, fontSize: isMobile ? 12 : 13 }}>
                      {profile.abbreviation}
                    </div>
                  </div>
                </div>

                {!isMobile && currentStanding ? (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                    <StatPill label="RECORD" value={record} color={accent} large />
                    {currentStanding.divRank != null && (
                      <StatPill
                        label="DIV RANK"
                        value={`#${currentStanding.divRank}`}
                        color={accentSecondary}
                      />
                    )}
                    {currentStanding.seed != null && (
                      <StatPill
                        label="SEED"
                        value={`#${currentStanding.seed}`}
                        color={C.accentCyan}
                      />
                    )}
                    {currentStanding.pointsFor != null && (
                      <StatPill
                        label="PF"
                        value={String(currentStanding.pointsFor)}
                        color={C.textSecondary}
                      />
                    )}
                    {currentStanding.pointsAgainst != null && (
                      <StatPill
                        label="PA"
                        value={String(currentStanding.pointsAgainst)}
                        color={C.textSecondary}
                      />
                    )}
                    {currentStanding.streak && (
                      <StatPill
                        label="STREAK"
                        value={currentStanding.streak}
                        color={currentStanding.streak.startsWith('W') ? '#8fff45' : '#ff627e'}
                      />
                    )}
                  </div>
                ) : null}
              </div>

              {isMobile && currentStanding ? (
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  }}
                >
                  {mobileHeroStats.map((stat) => (
                    <div
                      key={stat.label}
                      style={{
                        border: `1px solid ${C.border}`,
                        background: 'rgba(0,10,24,.42)',
                        padding: '10px 12px',
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
                        {stat.label}
                      </div>
                      <div
                        style={{
                          color: stat.color,
                          fontWeight: 700,
                          fontSize: stat.large ? 22 : 18,
                          fontFamily: "'JetBrains Mono', monospace",
                          lineHeight: 1.1,
                        }}
                      >
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Tab content area */}
        <div
          style={{
            maxWidth: 1360,
            margin: '0 auto',
            padding: isMobile ? '18px 16px 48px' : '24px 24px 60px',
          }}
        >
          <TeamStatsTabs
            apiBase={API_BASE}
            profile={profile}
            currentStanding={currentStanding}
            currentSeason={CURRENT_SEASON}
            sharedFreeAgencyTracker={sharedFreeAgencyTracker}
            sharedFreeAgencyTrackerLoading={sharedFreeAgencyTrackerLoading}
            sharedFreeAgencyTrackerError={sharedFreeAgencyTrackerError}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatPill({
  label,
  value,
  color,
  large,
}: {
  label: string;
  value: string;
  color: string;
  large?: boolean;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          color: C.textMuted,
          fontSize: 9,
          letterSpacing: '.1em',
          fontFamily: "'Orbitron', monospace",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontWeight: 700,
          fontSize: large ? 20 : 15,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '.04em',
        }}
      >
        {value}
      </div>
    </div>
  );
}
