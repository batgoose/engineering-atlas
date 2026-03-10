import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { GridstreamPlayerProfile } from '@atlas/sdk/gridstream';
import type { AnchorHTMLAttributes } from 'react';
import PlayerQuickViewDrawer from '../PlayerQuickViewDrawer';

const { mockFetchGridstreamPlayerProfile } = vi.hoisted(() => ({
  mockFetchGridstreamPlayerProfile: vi.fn(),
}));
const { mockFetchGridstreamPlayerGamelogPage } = vi.hoisted(() => ({
  mockFetchGridstreamPlayerGamelogPage: vi.fn(),
}));

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

vi.mock('@atlas/sdk/gridstream', () => ({
  fetchGridstreamPlayerProfile: mockFetchGridstreamPlayerProfile,
  fetchGridstreamPlayerGamelogPage: mockFetchGridstreamPlayerGamelogPage,
  formatGridstreamDraftLabel: () => '2016 · R2 · P39',
  formatGridstreamSeasonRange: () => '2016-2025',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('PlayerQuickViewDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders position-specific stats from the fetched player profile', async () => {
    const profile: GridstreamPlayerProfile = {
      id: '123',
      slug: 'hunter-henry',
      displayName: 'Hunter Henry',
      shortName: 'H. Henry',
      teamAbbr: 'NE',
      currentTeamName: 'New England Patriots',
      currentTeamColors: { primary: '002244', secondary: 'C60C30' },
      position: 'TE',
      positionGroup: 'TE',
      age: 31,
      draftYear: 2016,
      draftRound: 2,
      draftPick: 39,
      rosterStatus: 'Active',
      isActive: true,
      gamesPlayed: 135,
      seasonsPlayed: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
      receptions: 97,
      receivingYards: 1145,
      receivingTds: 9,
      yardsPerReception: 11.8,
      contracts: [],
      recentTransactions: [],
    };

    mockFetchGridstreamPlayerProfile.mockResolvedValue(profile);
    mockFetchGridstreamPlayerGamelogPage.mockResolvedValue({
      items: [
        {
          id: 1,
          seasonYear: 2025,
          week: 1,
          seasonType: 'REG',
          teamAbbr: 'NE',
          opponentAbbr: 'BUF',
          passComp: 0,
          passAtt: 0,
          passYards: 0,
          passTd: 0,
          interceptionsThrown: 0,
          passingEpa: null,
          carries: 0,
          rushYards: 0,
          rushTd: 0,
          rushingEpa: null,
          receptions: 6,
          receivingYards: 82,
          receivingTd: 1,
          receivingEpa: null,
          targetShare: null,
          airYardsShare: null,
          wopr: null,
          tacklesTotal: 0,
          sacksMade: 0,
          qbHits: 0,
          passesDefended: 0,
          interceptionsCaught: 0,
          interceptionTds: 0,
          forcedFumbles: 0,
          defensiveTds: 0,
          fantasyPointsPpr: 0,
        },
        {
          id: 2,
          seasonYear: 2025,
          week: 2,
          seasonType: 'REG',
          teamAbbr: 'NE',
          opponentAbbr: 'MIA',
          passComp: 0,
          passAtt: 0,
          passYards: 0,
          passTd: 0,
          interceptionsThrown: 0,
          passingEpa: null,
          carries: 0,
          rushYards: 0,
          rushTd: 0,
          rushingEpa: null,
          receptions: 5,
          receivingYards: 76,
          receivingTd: 1,
          receivingEpa: null,
          targetShare: null,
          airYardsShare: null,
          wopr: null,
          tacklesTotal: 0,
          sacksMade: 0,
          qbHits: 0,
          passesDefended: 0,
          interceptionsCaught: 0,
          interceptionTds: 0,
          forcedFumbles: 0,
          defensiveTds: 0,
          fantasyPointsPpr: 0,
        },
      ],
      count: 2,
      page: 1,
      pageSize: 40,
      totalPages: 1,
      next: null,
      previous: null,
    });

    render(
      <PlayerQuickViewDrawer
        apiBase="http://localhost:8000/api/gridstream"
        playerId="123"
        playerLabel="Hunter Henry"
        open
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockFetchGridstreamPlayerProfile).toHaveBeenCalledWith({
        apiBase: 'http://localhost:8000/api/gridstream',
        playerId: '123',
        signal: expect.any(AbortSignal),
      });
    });
    expect(mockFetchGridstreamPlayerGamelogPage).toHaveBeenCalledWith({
      apiBase: 'http://localhost:8000/api/gridstream',
      playerId: '123',
      page: 1,
      pageSize: 40,
      signal: expect.any(AbortSignal),
    });

    const seasonSelect = await screen.findByRole('combobox', { name: /season/i });
    expect(seasonSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2025 SEASON' })).toBeInTheDocument();
    expect(screen.getByText('Receptions')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('Rec Yds')).toBeInTheDocument();
    expect(screen.getByText('158')).toBeInTheDocument();
    expect(screen.getByText('Rec TD')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Yds/Rec')).toBeInTheDocument();
    expect(screen.getByText('14.4')).toBeInTheDocument();
  });

  it('shows expired contract wording and cleans recent transaction copy', async () => {
    const profile: GridstreamPlayerProfile = {
      id: '124',
      slug: 'klavon-chaisson',
      displayName: "K'Lavon Chaisson",
      shortName: 'K. Chaisson',
      teamAbbr: 'NE',
      currentTeamName: 'New England Patriots',
      currentTeamColors: { primary: '002244', secondary: 'C60C30' },
      position: 'LB',
      positionGroup: 'LB',
      age: 27,
      draftYear: 2020,
      draftRound: 1,
      draftPick: 20,
      rosterStatus: 'ACT',
      isActive: true,
      yearsExperience: 6,
      gamesPlayed: 79,
      seasonsPlayed: [2020, 2021, 2022, 2023, 2024, 2025],
      contracts: [
        {
          id: 9,
          teamAbbr: 'NE',
          isActive: true,
          yearSigned: 2025,
          years: 1,
          totalValue: 3000000,
          apy: 3000000,
          yearDetails: [{ year: 2025 }],
        },
      ],
      recentTransactions: [
        {
          id: 4,
          transactionType: 'signed',
          date: '2026-02-24',
          fromTeamAbbr: 'FA',
          toTeamAbbr: 'NE',
          description: "Roster sync: K'Lavon Chaisson moved from FA to NE",
          season: 2026,
        },
      ],
    };

    mockFetchGridstreamPlayerProfile.mockResolvedValue(profile);
    mockFetchGridstreamPlayerGamelogPage.mockResolvedValue({
      items: [],
      count: 0,
      page: 1,
      pageSize: 40,
      totalPages: 0,
      next: null,
      previous: null,
    });

    render(
      <PlayerQuickViewDrawer
        apiBase="http://localhost:8000/api/gridstream"
        playerId="124"
        playerLabel="K'Lavon Chaisson"
        open
        onClose={() => {}}
      />
    );

    expect(await screen.findByText(/Expired after 2025/i)).toBeInTheDocument();
    const contractCard = screen.getByText('CONTRACT').parentElement;
    expect(contractCard).toBeTruthy();
    const contractText = normalizeWhitespace(contractCard?.textContent ?? '');
    expect(contractText).toContain('Expired after 2025');
    expect(contractText).toContain('1 yr');
    expect(contractText).toMatch(/\$3(\.0)?M total/);
    expect(contractText).toMatch(/\$3(\.0)?M APY/);
    expect(screen.getAllByText("K'Lavon Chaisson").length).toBeGreaterThan(0);
    expect(screen.getByText('Free Agent · FA')).toBeInTheDocument();
    expect(screen.getByText('UFA')).toBeInTheDocument();
    expect(screen.getByText(/Signed with NE · 2025 offseason · 1-year deal/i)).toBeInTheDocument();
  });

  it('shows Spotrac contract terms for newly added players with stale old-team contract data', async () => {
    const profile: GridstreamPlayerProfile = {
      id: '20197',
      slug: 'tim-settle',
      displayName: 'Tim Settle',
      shortName: 'T. Settle',
      teamAbbr: 'WAS',
      currentTeamName: 'Washington Commanders',
      currentTeamColors: { primary: '5A1414', secondary: 'FFB612' },
      position: 'DT',
      positionGroup: 'DL',
      rosterStatus: 'ACT',
      isActive: true,
      yearsExperience: 7,
      gamesPlayed: 95,
      seasonsPlayed: [2019, 2020, 2021, 2022, 2023, 2024, 2025],
      contracts: [
        {
          id: 1,
          teamAbbr: 'HOU',
          isActive: false,
          yearSigned: 2024,
          years: 2,
          totalValue: 6000000,
          apy: 3000000,
          yearDetails: [{ year: 2024 }, { year: 2025 }],
        },
      ],
      recentTransactions: [
        {
          id: 1,
          transactionType: 'signed',
          date: '2026-03-08',
          fromTeamAbbr: null,
          toTeamAbbr: 'WAS',
          description: 'Signed with Washington',
          contractYears: 3,
          contractTotalValue: 24000000,
          contractApy: 8000000,
          contractGuaranteed: 0,
          season: 2026,
        },
      ],
    };

    mockFetchGridstreamPlayerProfile.mockResolvedValue(profile);
    mockFetchGridstreamPlayerGamelogPage.mockResolvedValue({
      items: [],
      count: 0,
      page: 1,
      pageSize: 40,
      totalPages: 0,
      next: null,
      previous: null,
    });

    render(
      <PlayerQuickViewDrawer
        apiBase="http://localhost:8000/api/gridstream"
        playerId="20197"
        playerLabel="Tim Settle"
        open
        onClose={() => {}}
      />
    );

    expect(await screen.findByText('Washington Commanders · WAS')).toBeInTheDocument();
    expect(screen.getByText('ACT')).toBeInTheDocument();
    const contractCard = screen.getByText('CONTRACT').parentElement;
    expect(contractCard).toBeTruthy();
    const contractText = normalizeWhitespace(contractCard?.textContent ?? '');
    expect(contractText).toContain('2026-2028');
    expect(contractText).toContain('3 yrs');
    expect(contractText).toMatch(/\$24(\.0)?M total/);
    expect(contractText).toMatch(/\$8(\.0)?M APY/);
    expect(screen.queryByText(/Expired after 2025/i)).not.toBeInTheDocument();
  });

  it('renders draft prospects with prospect-specific context and skips player fetches', async () => {
    render(
      <PlayerQuickViewDrawer
        apiBase="http://localhost:8000/api/gridstream"
        playerId={null}
        prospect={{
          name: 'Arvell Reese',
          position: 'LB',
          school: 'Ohio State',
          classYear: 'Junior',
          hometown: 'Cleveland, OH',
          jerseyNumber: '7',
          draftProjection: '1st - Mid 1st',
          buzzOverallRating: 89.0,
          buzzOverallRank: 7,
          buzzPositionRank: 1,
          buzzPositionRankGroup: 'LB',
          height: '6-4',
          weight: 241,
          age: 21.1,
          summary: 'Violent downhill linebacker with real range in space.',
          strengths: ['Closes downhill fast', 'Comfortable playing through traffic'],
          weaknesses: ['Can overrun angles'],
          honors: ['2025 First-Team All-Big Ten'],
          productionStats: [
            { label: 'Tackles', value: '92', percentile: 88 },
            { label: 'TFL', value: '14', percentile: 85 },
            { label: 'Sacks', value: '4.5', percentile: 73 },
            { label: 'INT', value: '2', percentile: 60 },
          ],
          scoutingGrades: [
            { label: 'Run Defense', value: '94%', percent: 94 },
            { label: 'Coverage', value: '82%', percent: 82 },
          ],
          recruitingRatings: [{ label: '247', value: '94/100' }],
          comparisonPlayers: [
            {
              name: 'Jeremiah Owusu-Koramoah',
              school: 'Notre Dame',
              similarity: 71,
              sourceUrl: 'https://example.com/comp',
            },
          ],
          overallRank: 18,
          trueAdp: 13.2,
          needLabel: 'Linebacker',
          fitReason: "Matches Washington Commanders' #3 need at Linebacker",
          teamMockCount: 6,
          totalMockCount: 44,
          consensusType: 'decisive',
          range: 'Picks 10-20',
          fitTeams: [
            {
              team: {
                abbreviation: 'WAS',
                displayName: 'Washington Commanders',
                shortDisplayName: 'Commanders',
                colorPrimary: '5A1414',
                colorSecondary: 'FFB612',
                logoUrl: 'https://example.com/was.png',
              },
              needKey: 'LB',
              needLabel: 'Linebacker',
              needRank: 3,
              pickLabel: 'Pick #7',
              round: 1,
              overallPick: 7,
            },
            {
              team: {
                abbreviation: 'TB',
                displayName: 'Tampa Bay Buccaneers',
                shortDisplayName: 'Buccaneers',
                colorPrimary: 'D50A0A',
                colorSecondary: '0A0A08',
                logoUrl: 'https://example.com/tb.png',
              },
              needKey: 'LB',
              needLabel: 'Linebacker',
              needRank: 2,
              pickLabel: 'Pick #19',
              round: 1,
              overallPick: 19,
            },
          ],
          teamAbbr: 'WAS',
          draftSeason: 2026,
          pickLabel: 'Pick #7',
          sourceLabel: 'NFLDraftBuzz scouting report',
          sourceUrl: 'https://example.com/prospect',
        }}
        open
        onClose={() => {}}
      />
    );

    expect(screen.getByText('DRAFT PROSPECT PREVIEW')).toBeInTheDocument();
    expect(screen.getByText('2026 DRAFT OUTLOOK')).toBeInTheDocument();
    expect(screen.getAllByText('Arvell Reese').length).toBeGreaterThan(0);
    expect(screen.getByText('Ohio State · Junior')).toBeInTheDocument();
    expect(screen.getByText('STRENGTHS')).toBeInTheDocument();
    expect(screen.getByText('Closes downhill fast')).toBeInTheDocument();
    expect(screen.getByText('Run Defense')).toBeInTheDocument();
    expect(screen.getByText('TEAM FITS')).toBeInTheDocument();
    expect(screen.getByText('Washington Commanders')).toBeInTheDocument();
    expect(screen.getByText('Pick #7 - Need #3')).toBeInTheDocument();
    expect(screen.getByText('Tampa Bay Buccaneers')).toBeInTheDocument();
    expect(screen.getByText('Pick #19 - Need #2')).toBeInTheDocument();
    expect(screen.getByText('Consensus Range')).toBeInTheDocument();
    expect(screen.getByText('2025 First-Team All-Big Ten')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view source/i })).toHaveAttribute(
      'href',
      'https://example.com/prospect'
    );
    expect(
      screen.getByText(
        'Prospect pages are not live yet. This preview uses consensus fit data plus NFLDraftBuzz scouting info.'
      )
    ).toBeInTheDocument();
    expect(mockFetchGridstreamPlayerProfile).not.toHaveBeenCalled();
    expect(mockFetchGridstreamPlayerGamelogPage).not.toHaveBeenCalled();
  });
});
