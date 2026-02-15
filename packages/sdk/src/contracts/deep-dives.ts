// packages/sdk/src/contracts/deep-dives.ts
//
// Shared content definitions for demo deep-dive pages.
// Each framework (Next, Vue, Angular, Svelte) imports these builders
// and renders the returned props through its own component layer.

// ─── Types ───────────────────────────────────────────────────────────

export interface DeepDiveProps {
  /** e.g. "System Architecture // Data_Ingestor_01" */
  designation: string;
  title: string;
  subtitle: string;
  techBadges: TechBadge[];

  /** The 3-card grid below the header */
  cards: DeepDiveCard[];

  /** Two-column prose + code section */
  narrative: DeepDiveNarrative;

  /** Repo link + back button */
  footer: DeepDiveFooter;
}

export interface TechBadge {
  label: string;
  /** First badge gets the highlighted style */
  primary?: boolean;
}

export interface DeepDiveCard {
  label: string;
  title: string;
  description: string;
}

export interface CodeSnippet {
  filename: string;
  language: string;
  /** Raw code string — frameworks handle syntax highlighting */
  code: string;
}

export interface SpecItem {
  label: string;
  value: string;
}

export interface DeepDiveNarrative {
  heading: string;
  /** Paragraphs of prose. Each string is one <p>. */
  paragraphs: string[];
  specs: SpecItem[];
  code: CodeSnippet;
  /** Which side the code panel appears on: 'left' or 'right' */
  codePosition: 'left' | 'right';
}

export interface DeepDiveFooter {
  heading: string;
  description: string;
  repoUrl: string;
  backHref: string;
  backLabel: string;
}

// ─── Registry ────────────────────────────────────────────────────────
// Maps artifact/demo slug to its builder. Frameworks use this to
// resolve which deep-dive to render for a given route.

const deepDiveRegistry: Record<string, () => DeepDiveProps> = {
  'nfl-ingestor': buildNFLIngestorProps,
  'gridstream': buildGridStreamProps,
};

/**
 * Look up a deep-dive by its slug (matches the route segment).
 * Returns null if no deep-dive exists for this slug.
 */
export function getDeepDiveProps(slug: string): DeepDiveProps | null {
  const builder = deepDiveRegistry[slug];
  return builder ? builder() : null;
}

/**
 * Get all registered deep-dive slugs.
 * Useful for static generation (getStaticPaths / generateStaticParams).
 */
export function getAllDeepDiveSlugs(): string[] {
  return Object.keys(deepDiveRegistry);
}

// ─── Builders ────────────────────────────────────────────────────────

export function buildNFLIngestorProps(): DeepDiveProps {
  return {
    designation: 'System Architecture // Data_Ingestor_01',
    title: 'NFL Data Ingestion Pipeline',
    subtitle:
      'Architecting a high-throughput archival engine to transform 25+ years of sparse NFLverse play-by-play data into a query-optimized relational warehouse.',
    techBadges: [
      { label: 'Rust 1.75+', primary: true },
      { label: 'Tokio Async' },
      { label: 'PostgreSQL' },
    ],
    cards: [
      {
        label: 'Latency Optimization',
        title: 'Bulk Ingest Strategy',
        description:
          'Leveraging sqlx::QueryBuilder to saturate Postgres write-ahead logs with 1,000-record atomic batches, maximizing IOPS and minimizing round-trip overhead.',
      },
      {
        label: 'Resource Management',
        title: 'Async Backpressure',
        description:
          'Utilizing tokio and futures-util to stream multi-gigabit datasets with a constant memory footprint, ensuring system stability regardless of file size.',
      },
      {
        label: 'State Integrity',
        title: 'Idempotent Pipelines',
        description:
          'Ensuring data consistency through Upsert logic, allowing for interrupted and resumed archive sequences without duplication or record corruption.',
      },
    ],
    narrative: {
      heading: 'Type-Safe Nullability Handling',
      paragraphs: [
        "The challenge of historical NFL data isn't just missing values — it's the evolution of the league's tracking metrics. Fields like air_yards or epa simply did not exist in the 1999 schema.",
        'By modeling the schema with Option<T> wrappers, the engine treats schema evolution as a compile-time constraint. This eliminates runtime panics and forces explicit handling of sparse historical datasets.',
      ],
      specs: [
        { label: 'Runtime', value: 'Tokio (Multi-threaded)' },
        { label: 'DB Driver', value: 'SQLx (Async / Compiled)' },
        { label: 'Performance', value: '~12k records/sec' },
        { label: 'Pattern', value: 'ETL / Stream-to-Disk' },
      ],
      code: {
        filename: 'models.rs',
        language: 'rust',
        code: `#[derive(Debug, Deserialize, Clone)]
pub struct PlayRecord {
    pub play_id: f64,
    pub game_id: String,

    // Handle schema evolution via Option types
    pub epa: Option<f32>,
    pub touchdown: Option<f32>,
}`,
      },
      codePosition: 'right',
    },
    footer: {
      heading: 'Full Pipeline Source',
      description: 'Explore the batching logic and exhaustive test suites on GitHub.',
      repoUrl: 'https://github.com/batgoose/engineering-atlas/tree/main/apps/service-rust',
      backHref: '/demos',
      backLabel: 'Back to Demos',
    },
  };
}

export function buildGridStreamProps(): DeepDiveProps {
  return {
    designation: 'Real-Time Subsystem // Grid_Stream_02',
    title: 'GridStream WebSocket Hub',
    subtitle:
      'A live NFL data pipeline that polls ESPN, diffs game state, and broadcasts typed event envelopes over WebSocket to thousands of concurrent clients — backed by Redis pub/sub for cross-service distribution.',
    techBadges: [
      { label: 'Go 1.24+', primary: true },
      { label: 'WebSockets' },
      { label: 'Redis Pub/Sub' },
      { label: 'ESPN API' },
    ],
    cards: [
      {
        label: 'Data Ingestion',
        title: 'Adaptive ESPN Poller',
        description:
          'A state-diffing polling loop that adapts its interval based on game activity — 8s during live games, 60s pre-game, 5min post-game — and emits granular events only when scores, status, or clock actually change.',
      },
      {
        label: 'Fan-Out Architecture',
        title: 'Hub & Spoke Broadcast',
        description:
          'Per-client write pumps with buffered channels ensure slow consumers get disconnected rather than blocking the broadcast loop. Clients subscribe to specific games or receive all events in scoreboard mode.',
      },
      {
        label: 'Cross-Service Mesh',
        title: 'Redis Event Bridge',
        description:
          'Every game event is published to Redis alongside the WebSocket broadcast, letting Django and other services consume the live stream without a direct WebSocket connection. A command channel enables remote simulation control.',
      },
    ],
    narrative: {
      heading: 'State-Diff Polling Engine',
      paragraphs: [
        'The poller maintains a snapshot of every tracked game and compares it against each ESPN fetch. Only meaningful changes — score updates, status transitions, quarter changes — produce events. This eliminates redundant broadcasts and keeps the WebSocket channel focused on data the frontend actually needs to react to.',
        'When a game transitions from scheduled to in-progress, the poller fires a full GameContext envelope so newly connected clients get venue, weather, odds, and team metadata in a single message. Subsequent updates are lightweight GameUpdate payloads carrying only the fields that changed.',
        'For active games, the poller also fetches detailed play-by-play from the ESPN summary endpoint and emits individual Play and ScoringPlay events with full drive context — down, distance, yard line, possession, and yards gained.',
      ],
      specs: [
        { label: 'Protocol', value: 'RFC 6455 (WebSocket)' },
        { label: 'Event Format', value: 'Typed JSON Envelopes' },
        { label: 'Event Types', value: '12 (play, score, drive, stats, ...)' },
        { label: 'Poll Interval', value: '8s live / 60s pre / 5m post' },
        { label: 'Max Clients', value: '10k+ per instance' },
        { label: 'Redis Channels', value: 'live_updates + commands' },
      ],
      code: {
        filename: 'poller.go',
        language: 'go',
        code: `func (p *Poller) poll(ctx context.Context) {
    sb, err := p.client.FetchScoreboard(ctx)
    if err != nil {
        p.logger.Error("scoreboard poll failed", "error", err)
        return
    }

    for _, ev := range sb.Events {
        prev, exists := p.states[ev.ID]
        curr := extractState(ev)

        if !exists {
            // First contact — emit full game context
            p.states[ev.ID] = curr
            gc := EventToGameContext(ev, sb.Season.Year, sb.Week.Number, seasonType)
            p.emit(events.MustEnvelope(events.TypeGameContext, ev.ID, now, gc))
            continue
        }

        // Diff: only emit when something actually changed
        if curr.HomeScore != prev.HomeScore || curr.AwayScore != prev.AwayScore ||
           curr.Status != prev.Status || curr.Quarter != prev.Quarter {
            gu := EventToGameUpdate(ev)
            p.emit(events.MustEnvelope(events.TypeGameUpdate, ev.ID, now, gu))
        }

        p.states[ev.ID] = curr
    }
}`,
      },
      codePosition: 'left',
    },
    footer: {
      heading: 'Full Pipeline Source',
      description: 'Explore the ESPN adapter, event types, hub implementation, and test suites on GitHub.',
      repoUrl: 'https://github.com/batgoose/engineering-atlas/tree/main/apps/service-go/gridstream',
      backHref: '/demos',
      backLabel: 'Back to Demos',
    },
  };
}
