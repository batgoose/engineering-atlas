import { LeagueClient } from '@atlas/sdk';

// Using the internal docker networking URL for server side rendering
const leagueApi = new LeagueClient(process.env.API_URL || 'http://api-django:8000/api');

export async function getSchedule(season: number, week: number) {
  return leagueApi.getSchedule(season, week);
}

export async function getGameDetails(gameId: string) {
  return leagueApi.getGameDetails(gameId);
}
