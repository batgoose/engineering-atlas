import { LeagueClient } from '@atlas/sdk';

// Using the internal docker networking URL for server side rendering
const api = new LeagueClient(process.env.API_URL || 'http://api-django:8000/api');

const games = await api.getSchedule(2024, 1);
