#!/usr/bin/env node

/**
 * Scraper per aggiornare dati da romagnasport.com:
 *   - Classifica e marcatori → classifica.json
 *   - Risultati partite → matches.json (aggiorna risultati)
 *   - Marcatori per partita → matches.json (aggiorna marcatoriCasa/marcatoriTrasferta)
 *
 * Uso: node scripts/update-classifica.cjs
 *
 * Parametri romagnasport:
 *   id_squadra = 7449 (Sporting Predappio)
 *   gir / id_girone = 271 (2a Categoria Girone N RA 2025/2026)
 *   anno = 2025 (stagione 2025/2026)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  idSquadra: 7449,
  idGirone: 271,
  anno: 2025,
  seasonFolder: '2025-2026',
  teamName: 'Sporting Predappio',
  teamAbbrev: 'Spo',
};

// Map abbreviated names → full names for Sporting players
const PLAYER_NAMES = {
  'Ambrogetti A.': 'Alessio Ambrogetti',
  'Valentini M.': 'Mattia Valentini',
  'Camanzi C.': 'Cesare Camanzi',
  'Valtancoli D.': 'Davide Valtancoli',
  'Argentino G.': 'Glauco Argentino',
  'Charaf A.': 'Abdessamad Charaf',
  'Tani G.': 'Giovanni Tani',
  'Casadei F.': 'Francesco Casadei',
  'Milandri R.': 'Riccardo Milandri',
  'Passero F.': 'Filippo Passero',
  'Rafelli N.': 'Nicola Rafelli',
  'Sansovini N.': 'Nicola Sansovini',
};

const DATA_DIR = path.join(
  __dirname,
  '..',
  'src',
  'data',
  'seasons',
  CONFIG.seasonFolder,
  'prima-squadra'
);

const CLASSIFICA_PATH = path.join(DATA_DIR, 'classifica.json');
const MATCHES_PATH = path.join(DATA_DIR, 'matches.json');

// ── Fetch helper ──────────────────────────────────────────────

function fetchUrl(url, retries = 2) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location, retries).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          if (retries > 0) return setTimeout(() => fetchUrl(url, retries - 1).then(resolve).catch(reject), 500);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', (err) => {
        if (retries > 0) setTimeout(() => fetchUrl(url, retries - 1).then(resolve).catch(reject), 500);
        else reject(err);
      });
  });
}

// ── HTML parsing helpers ──────────────────────────────────────

function extractCells(rowHtml) {
  const cells = [];
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    cells.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  return cells;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .trim();
}

// ── Parse classifica ──────────────────────────────────────────

function parseClassifica(html) {
  const rows = [];
  // Match ALL table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = extractCells(match[1]);
    // The classifica table has 10 cells per row
    // Cell[0] contains "POS\nTeamName", cells[1..8] = Pt, PG, V, N, P, GF, GS, DR
    if (cells.length >= 9) {
      // First cell may contain position + team name
      const firstCell = cells[0].replace(/\s+/g, ' ').trim();
      const posMatch = firstCell.match(/^(\d+)\s+(.+)/);

      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        const squadra = posMatch[2].trim();
        const punti = parseInt(cells[1]);

        if (isNaN(punti) || !squadra) continue;

        rows.push({
          pos,
          squadra,
          punti,
          pg: parseInt(cells[2]) || 0,
          v: parseInt(cells[3]) || 0,
          n: parseInt(cells[4]) || 0,
          p: parseInt(cells[5]) || 0,
          gf: parseInt(cells[6]) || 0,
          gs: parseInt(cells[7]) || 0,
        });
      }
    }
  }

  return rows;
}

function parseGiornata(html) {
  // Try multiple patterns
  const m1 = html.match(/(\d+)[aª]\s*(?:GIORNATA|giornata)/i);
  if (m1) return parseInt(m1[1]);
  const m2 = html.match(/Giornata\s+(\d+)/i);
  if (m2) return parseInt(m2[1]);
  return 0;
}

// ── Parse marcatori ───────────────────────────────────────────

function parseMarcatori(html) {
  const marcatori = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = extractCells(match[1]);
    if (cells.length >= 2) {
      const nome = cells[0];
      const gol = parseInt(cells[1]);
      if (nome && !isNaN(gol) && gol > 0 && !nome.includes('Giocatore') && !nome.includes('Totale')) {
        const entry = { nome, gol };
        if (cells.length >= 3) {
          const rigori = parseInt(cells[2]);
          if (!isNaN(rigori) && rigori > 0) entry.rigori = rigori;
        }
        marcatori.push(entry);
      }
    }
  }

  return marcatori.sort((a, b) => b.gol - a.gol);
}

// ── Parse match results from statistiche_squadra ──────────────

function parseMatchResults(html) {
  const results = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = extractCells(match[1]);
    if (cells.length >= 4) {
      const dateCell = cells.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
      const scoreCell = cells.find((c) => /^\d+-\d+$/.test(c));

      if (dateCell) {
        const nonMeta = cells.filter(
          (c) => c !== dateCell && c !== scoreCell && !/^\d{1,2}$/.test(c) && c.length > 1
        );

        if (nonMeta.length >= 2) {
          const [dd, mm, yyyy] = dateCell.split('/');
          results.push({
            data: `${yyyy}-${mm}-${dd}`,
            casa: nonMeta[0],
            trasferta: nonMeta[1],
            risultato: scoreCell || null,
          });
        }
      }
    }
  }

  return results;
}

// ── Parse tabellino marcatori ─────────────────────────────────

function parseTabellino(html) {
  // Extract teams from title: "romagnasport.com - tabellino TEAM1 - TEAM2"
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let casa = '', trasferta = '';
  if (titleMatch) {
    const title = titleMatch[1]
      .replace(/romagnasport\.com\s*[-–]\s*/i, '')
      .replace(/^tabellino\s*/i, '')
      .trim();
    const parts = title.split(/\s*[-–]\s*/);
    if (parts.length >= 2) {
      casa = parts[0].trim();
      trasferta = parts[parts.length - 1].trim();
    }
  }

  // Extract marcatori section
  // Format: "XX' LastName F. [su rigore] (TeamAbbrev), ..."
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  const marcatoriMatch = text.match(/Marcatori:\s*([\s\S]*?)(?:\.\s*$|\.\s+[A-Z]|\n\n)/m);
  if (!marcatoriMatch) return { casa, trasferta, marcatoriCasa: [], marcatoriTrasferta: [] };

  const marcatoriText = marcatoriMatch[1].replace(/\s+/g, ' ').trim();

  // Parse individual goal entries
  // Pattern: "XX' Name [su rigore] (Abbrev)"
  const goalRegex = /(\d+(?:\+\d+)?)['']\s+([^(]+?)\s*(?:su rigore\s*)?\(([^)]+)\)/g;
  const marcatoriCasa = [];
  const marcatoriTrasferta = [];

  let g;
  while ((g = goalRegex.exec(marcatoriText)) !== null) {
    const minStr = g[1];
    let minuto;
    if (minStr.includes('+')) {
      const [base, extra] = minStr.split('+');
      minuto = parseInt(base) + parseInt(extra);
    } else {
      minuto = parseInt(minStr);
    }

    const rawName = g[2].trim().replace(/,\s*$/, '');
    const teamAbbrev = g[3].trim();
    const isRigore = /su rigore/.test(g[0]);
    const isAutorete = /autogol|autorete|aut\./i.test(g[0]);

    // Determine if this goal is for casa or trasferta
    const casaAbbrev = casa.substring(0, 3);
    const isForCasa = teamAbbrev.substring(0, 3).toLowerCase() === casaAbbrev.substring(0, 3).toLowerCase();

    // Resolve full name for Sporting players
    const fullName = PLAYER_NAMES[rawName] || rawName;

    const entry = { nome: fullName, minuto };
    if (isRigore) entry.rigore = true;
    if (isAutorete) entry.autorete = true;

    if (isForCasa) {
      marcatoriCasa.push(entry);
    } else {
      marcatoriTrasferta.push(entry);
    }
  }

  return { casa, trasferta, marcatoriCasa, marcatoriTrasferta };
}

// ── Merge results into existing matches.json ──────────────────

function mergeMatchResults(existingMatches, scrapedResults) {
  let updated = 0;

  for (const partita of existingMatches.partite) {
    if (partita.risultato !== null) continue;

    const found = scrapedResults.find((r) => {
      const casaMatch =
        r.casa.includes(partita.casa.substring(0, 8)) ||
        partita.casa.includes(r.casa.substring(0, 8));
      const trasfMatch =
        r.trasferta.includes(partita.trasferta.substring(0, 8)) ||
        partita.trasferta.includes(r.trasferta.substring(0, 8));
      return casaMatch && trasfMatch && r.risultato;
    });

    if (found) {
      partita.risultato = found.risultato;
      if (found.data !== partita.data) {
        console.log(`   📅 ${partita.casa} vs ${partita.trasferta}: data aggiornata ${partita.data} → ${found.data}`);
        partita.data = found.data;
      }
      if (partita.nota === 'Rinviata') {
        delete partita.nota;
      }
      updated++;
    }
  }

  return updated;
}

// ── Merge tabellino data into matches.json ──────────────────

function mergeTabellini(existingMatches, tabelliniData) {
  let updated = 0;

  for (const partita of existingMatches.partite) {
    if (partita.risultato === null) continue;
    // Skip if already has marcatori
    if (partita.marcatoriCasa && partita.marcatoriCasa.length > 0) continue;
    if (partita.marcatoriTrasferta && partita.marcatoriTrasferta.length > 0) continue;

    const tab = tabelliniData.find((t) => {
      const casaMatch =
        t.casa.includes(partita.casa.substring(0, 8)) ||
        partita.casa.includes(t.casa.substring(0, 8));
      const trasfMatch =
        t.trasferta.includes(partita.trasferta.substring(0, 8)) ||
        partita.trasferta.includes(t.trasferta.substring(0, 8));
      return casaMatch && trasfMatch;
    });

    if (tab && (tab.marcatoriCasa.length > 0 || tab.marcatoriTrasferta.length > 0)) {
      partita.marcatoriCasa = tab.marcatoriCasa;
      partita.marcatoriTrasferta = tab.marcatoriTrasferta;
      updated++;
    }
  }

  return updated;
}

// ── Find tabellino links from classifica page ─────────────────

function findTabellinoIds(html) {
  // Look for tabellino.php?id_partita=XXXXX links
  const ids = [];
  const linkRegex = /tabellino\.php\?id_partita=(\d+)/g;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    ids.push(parseInt(m[1]));
  }
  return [...new Set(ids)]; // Deduplicate
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🔄 Aggiornamento dati da romagnasport.com...\n');

  try {
    // ── 1. Classifica ──
    const classificaUrl = `https://www.romagnasport.com/tuttocalcio/classifica.php?gir=${CONFIG.idGirone}&anno=${CONFIG.anno}`;
    console.log('📊 Scaricando classifica...');
    const classificaHtml = await fetchUrl(classificaUrl);
    const classifica = parseClassifica(classificaHtml);
    const giornata = parseGiornata(classificaHtml);

    if (classifica.length === 0) {
      console.log('⚠️  Nessun dato nella classifica. Formato pagina cambiato?');
      console.log('   Aggiorna manualmente classifica.json');
    } else {
      console.log(`   ✅ ${classifica.length} squadre (giornata ${giornata})`);
    }

    // ── 2. Marcatori ──
    const marcatoriUrl = `https://www.romagnasport.com/tuttocalcio/marcatori.php?id_girone=${CONFIG.idGirone}&anno=${CONFIG.anno}&id_squadra=${CONFIG.idSquadra}`;
    console.log('⚽ Scaricando marcatori...');
    const marcatoriHtml = await fetchUrl(marcatoriUrl);
    const marcatori = parseMarcatori(marcatoriHtml);
    console.log(`   ✅ ${marcatori.length} marcatori`);

    // Save classifica - preserve existing marcatori if new parse fails
    if (classifica.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      let finalMarcatori = marcatori;
      if (marcatori.length === 0 && fs.existsSync(CLASSIFICA_PATH)) {
        const existing = JSON.parse(fs.readFileSync(CLASSIFICA_PATH, 'utf-8'));
        if (existing.marcatori && existing.marcatori.length > 0) {
          finalMarcatori = existing.marcatori;
          console.log('   ℹ️  Marcatori non trovati, mantenuti dati esistenti');
        }
      }
      const classificaData = { aggiornamento: today, giornata, classifica, marcatori: finalMarcatori };
      fs.writeFileSync(CLASSIFICA_PATH, JSON.stringify(classificaData, null, 2) + '\n');
      console.log(`\n   💾 ${path.relative(process.cwd(), CLASSIFICA_PATH)} aggiornato`);
    }

    // ── 3. Risultati partite ──
    const statsUrl = `https://www.romagnasport.com/tuttocalcio/statistiche_squadra.php?id_squadra=${CONFIG.idSquadra}&anno=${CONFIG.anno}`;
    console.log('\n📅 Scaricando risultati partite...');
    const statsHtml = await fetchUrl(statsUrl);
    const scrapedResults = parseMatchResults(statsHtml);
    console.log(`   ✅ ${scrapedResults.length} risultati trovati`);

    if (scrapedResults.length > 0 && fs.existsSync(MATCHES_PATH)) {
      const existingMatches = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf-8'));
      const updated = mergeMatchResults(existingMatches, scrapedResults);

      if (updated > 0) {
        fs.writeFileSync(MATCHES_PATH, JSON.stringify(existingMatches, null, 2) + '\n');
        console.log(`   💾 ${updated} nuovi risultati aggiornati in matches.json`);
      } else {
        console.log('   ℹ️  Nessun nuovo risultato da aggiornare');
      }
    }

    // ── 4. Tabellini (marcatori per partita) ──
    // Find tabellino IDs from the classifica page
    const tabellinoIds = findTabellinoIds(classificaHtml);
    console.log(`\n📋 Trovati ${tabellinoIds.length} tabellino link nella pagina classifica`);

    // Also look for IDs that might be Sporting Predappio matches
    // Filter to only fetch tabellini that contain "Sporting"
    const tabelliniData = [];
    for (const id of tabellinoIds) {
      try {
        const tabUrl = `https://www.romagnasport.com/tabellino.php?id_partita=${id}`;
        const tabHtml = await fetchUrl(tabUrl);
        if (tabHtml.includes('Sporting')) {
          const tabData = parseTabellino(tabHtml);
          if (tabData.marcatoriCasa.length > 0 || tabData.marcatoriTrasferta.length > 0) {
            tabelliniData.push(tabData);
            console.log(`   ✅ ${tabData.casa} vs ${tabData.trasferta}`);
          }
        }
      } catch (err) {
        // Ignore errors for individual tabellini
      }
    }

    if (tabelliniData.length > 0 && fs.existsSync(MATCHES_PATH)) {
      const existingMatches = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf-8'));
      const updatedTab = mergeTabellini(existingMatches, tabelliniData);
      if (updatedTab > 0) {
        fs.writeFileSync(MATCHES_PATH, JSON.stringify(existingMatches, null, 2) + '\n');
        console.log(`   💾 ${updatedTab} tabellini aggiornati in matches.json`);
      }
    }

    // ── Riepilogo ──
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const noi = classifica.find((t) => t.squadra.includes('Sporting'));
    if (noi) {
      console.log(`🏆 Sporting Predappio: ${noi.pos}° posto con ${noi.punti} punti`);
      console.log(`   ${noi.v}V ${noi.n}N ${noi.p}P | Gol: ${noi.gf}-${noi.gs} (${noi.gf - noi.gs > 0 ? '+' : ''}${noi.gf - noi.gs})`);
    }
    if (marcatori.length > 0) {
      console.log(`⚽ Capocannoniere: ${marcatori[0].nome} (${marcatori[0].gol} gol)`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (err) {
    console.error('❌ Errore:', err.message);
    console.log('\n💡 Se il formato è cambiato, aggiorna i file manualmente');
    process.exit(1);
  }
}

main();
