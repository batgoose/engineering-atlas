export interface Team {
  id: string;
  name: string;
  abbrev: string;
  logoUrl?: string;
  primaryColor?: string;
}

export interface Game {
  id: string;
  homeTeam: Team;
  awayTeam: Team;
  week: number;
  season: number;
  kickoff: string; // ISO Date string
  status: 'scheduled' | 'live' | 'final';
  score?: {
    home: number;
    away: number;
  };
}

export class LeagueClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });

      if (!res.ok) {
        throw new Error(`LeagueAPI Error: ${res.status} ${res.statusText}`);
      }

      return res.json() as Promise<T>;
    } catch (error) {
      console.error(`Fetch failed for ${url}`, error);
      throw error;
    }
  }

  /**
   * Fetch the schedule for a specific week/season
   */
  async getSchedule(season: number, week: number): Promise<Game[]> {
    return this.request<Game[]>(`/games?season=${season}&week=${week}`);
  }

  /**
   * Fetch details for a single game
   */
  async getGameDetails(gameId: string): Promise<Game> {
    return this.request<Game>(`/games/${gameId}`);
  }
}

// Export a factory or default instance if preferred,
// but exporting the class is usually safer for SSR/Env handling
