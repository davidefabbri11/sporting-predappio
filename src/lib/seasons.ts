/**
 * Season data loading utilities.
 * Uses static imports for Astro/Vite compatibility with JSON files.
 */

// Static imports for config and season manifests
import seasonsConfig from '../data/seasons/config.json';

// Import all season data using import.meta.glob (eager)
const seasonManifests = import.meta.glob('../data/seasons/*/season.json', { eager: true });
const firstTeamRosters = import.meta.glob('../data/seasons/*/prima-squadra/team.json', { eager: true });
const firstTeamStaffs = import.meta.glob('../data/seasons/*/prima-squadra/staff.json', { eager: true });
const firstTeamMatches = import.meta.glob('../data/seasons/*/prima-squadra/matches.json', { eager: true });
const firstTeamClassifica = import.meta.glob('../data/seasons/*/prima-squadra/classifica.json', { eager: true });
const youthRosters = import.meta.glob('../data/seasons/*/giovanili/*/team.json', { eager: true });
const youthStaffs = import.meta.glob('../data/seasons/*/giovanili/*/staff.json', { eager: true });

// Types
export interface SeasonEntry {
  id: string;
  label: string;
}

export interface YouthCategory {
  id: string;
  nome: string;
  annate: string;
}

export interface SeasonManifest {
  id: string;
  label: string;
  primaSquadra: {
    categoria: string;
    girone: string;
    regione: string;
  };
  giovanili: YouthCategory[];
  responsabileGiovanili?: StaffMember;
}

export interface Player {
  nome: string;
  ruolo: string;
  anno: number;
  foto: string;
}

export interface StaffMember {
  nome: string;
  ruolo: string;
  tipo?: string;
  foto: string;
}

export interface Match {
  giornata: number;
  data: string;
  ora: string;
  casa: string;
  trasferta: string;
  risultato: string | null;
  luogo: string;
  nota?: string;
}

export interface MatchData {
  campionato: {
    nome: string;
    girone: string;
    stagione: string;
    regione: string;
  };
  partite: Match[];
}

export interface ClassificaEntry {
  pos: number;
  squadra: string;
  punti: number;
  pg: number;
  v: number;
  n: number;
  p: number;
  gf: number;
  gs: number;
}

export interface Marcatore {
  nome: string;
  gol: number;
  rigori?: number;
}

export interface ClassificaData {
  aggiornamento: string;
  giornata: number;
  classifica: ClassificaEntry[];
  marcatori: Marcatore[];
}

// Helper to resolve glob results by season ID
function findBySeasonId<T>(globResult: Record<string, any>, seasonId: string): T | null {
  const key = Object.keys(globResult).find(k => k.includes(`/${seasonId}/`));
  if (!key) return null;
  const mod = globResult[key];
  return (mod.default ?? mod) as T;
}

// Helper to resolve glob results by season ID + category
function findBySeasonAndCategory<T>(globResult: Record<string, any>, seasonId: string, categoryId: string): T | null {
  const key = Object.keys(globResult).find(k => k.includes(`/${seasonId}/`) && k.includes(`/${categoryId}/`));
  if (!key) return null;
  const mod = globResult[key];
  return (mod.default ?? mod) as T;
}

/** Get all seasons from config */
export function getAllSeasons(): SeasonEntry[] {
  return seasonsConfig.seasons;
}

/** Get the current season ID */
export function getCurrentSeasonId(): string {
  return seasonsConfig.currentSeason;
}

/** Get the season manifest for a given season */
export function getSeasonManifest(seasonId: string): SeasonManifest | null {
  return findBySeasonId<SeasonManifest>(seasonManifests, seasonId);
}

/** Get first team roster */
export function getFirstTeamRoster(seasonId: string): Player[] {
  return findBySeasonId<Player[]>(firstTeamRosters, seasonId) ?? [];
}

/** Get first team technical staff */
export function getFirstTeamStaff(seasonId: string): StaffMember[] {
  return findBySeasonId<StaffMember[]>(firstTeamStaffs, seasonId) ?? [];
}

/** Get first team match data */
export function getFirstTeamMatches(seasonId: string): MatchData | null {
  return findBySeasonId<MatchData>(firstTeamMatches, seasonId);
}

/** Get first team classifica/standings data */
export function getFirstTeamClassifica(seasonId: string): ClassificaData | null {
  return findBySeasonId<ClassificaData>(firstTeamClassifica, seasonId);
}

/** Get youth category roster */
export function getYouthRoster(seasonId: string, categoryId: string): Player[] {
  return findBySeasonAndCategory<Player[]>(youthRosters, seasonId, categoryId) ?? [];
}

/** Get youth category staff */
export function getYouthStaff(seasonId: string, categoryId: string): StaffMember[] {
  return findBySeasonAndCategory<StaffMember[]>(youthStaffs, seasonId, categoryId) ?? [];
}

/** Check if a season ID is valid */
export function isValidSeason(seasonId: string): boolean {
  return seasonsConfig.seasons.some((s: SeasonEntry) => s.id === seasonId);
}

/** Get season label from ID */
export function getSeasonLabel(seasonId: string): string {
  const season = seasonsConfig.seasons.find((s: SeasonEntry) => s.id === seasonId);
  return season?.label ?? seasonId;
}
