#!/usr/bin/env node

/**
 * Scraper per aggiornare classifica e marcatori da romagnasport.com
 *
 * Uso: node scripts/update-classifica.js
 *
 * Parametri romagnasport:
 *   id_squadra = 7449 (Sporting Predappio)
 *   gir / id_girone = 271 (2a Categoria Girone N RA 2025/2026)
 *   anno = 2025 (stagione 2025/2026)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  idSquadra: 7449,
  idGirone: 271,
  anno: 2025,
  seasonFolder: '2025-2026',
};

const OUTPUT_PATH = path.join(
  __dirname,
  '..',
  'src',
  'data',
  'seasons',
  CONFIG.seasonFolder,
  'prima-squadra',
  'classifica.json'
);

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function parseClassifica(html) {
  const rows = [];
  // Match table rows with team data
  const rowRegex =
    /<tr[^>]*class="[^"]*riga[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    if (cells.length >= 9) {
      rows.push({
        pos: parseInt(cells[0]) || rows.length + 1,
        squadra: cells[1],
        punti: parseInt(cells[2]) || 0,
        pg: parseInt(cells[3]) || 0,
        v: parseInt(cells[4]) || 0,
        n: parseInt(cells[5]) || 0,
        p: parseInt(cells[6]) || 0,
        gf: parseInt(cells[7]) || 0,
        gs: parseInt(cells[8]) || 0,
      });
    }
  }

  return rows;
}

function parseMarcatori(html) {
  const marcatori = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    // Looking for rows with player name and goal count
    if (cells.length >= 2) {
      const nome = cells[0];
      const gol = parseInt(cells[1]);
      if (nome && !isNaN(gol) && gol > 0 && !nome.includes('Giocatore')) {
        const entry = { nome, gol };
        // Check for penalty info in remaining cells
        if (cells.length >= 3) {
          const rigori = parseInt(cells[2]);
          if (!isNaN(rigori) && rigori > 0) {
            entry.rigori = rigori;
          }
        }
        marcatori.push(entry);
      }
    }
  }

  return marcatori.sort((a, b) => b.gol - a.gol);
}

function parseGiornata(html) {
  const match = html.match(/Giornata\s+(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

async function main() {
  console.log('🔄 Aggiornamento classifica da romagnasport.com...\n');

  try {
    // Fetch classifica
    const classificaUrl = `https://www.romagnasport.com/tuttocalcio/classifica.php?gir=${CONFIG.idGirone}&anno=${CONFIG.anno}`;
    console.log(`📊 Scaricando classifica...`);
    const classificaHtml = await fetch(classificaUrl);
    const classifica = parseClassifica(classificaHtml);
    const giornata = parseGiornata(classificaHtml);

    if (classifica.length === 0) {
      console.log('⚠️  Nessun dato trovato nella classifica. Il formato della pagina potrebbe essere cambiato.');
      console.log('    Aggiorna manualmente il file classifica.json');
      process.exit(1);
    }

    console.log(`   ✅ ${classifica.length} squadre trovate (giornata ${giornata})`);

    // Fetch marcatori
    const marcatoriUrl = `https://www.romagnasport.com/tuttocalcio/marcatori.php?id_girone=${CONFIG.idGirone}&anno=${CONFIG.anno}&id_squadra=${CONFIG.idSquadra}`;
    console.log(`⚽ Scaricando marcatori...`);
    const marcatoriHtml = await fetch(marcatoriUrl);
    const marcatori = parseMarcatori(marcatoriHtml);

    console.log(`   ✅ ${marcatori.length} marcatori trovati`);

    // Build output
    const today = new Date().toISOString().split('T')[0];
    const data = {
      aggiornamento: today,
      giornata,
      classifica,
      marcatori,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n');
    console.log(`\n✅ Dati salvati in ${path.relative(process.cwd(), OUTPUT_PATH)}`);

    // Show our position
    const noi = classifica.find((t) => t.squadra.includes('Sporting'));
    if (noi) {
      console.log(`\n🏆 Sporting Predappio: ${noi.pos}° posto con ${noi.punti} punti (${noi.v}V ${noi.n}N ${noi.p}P)`);
    }

    if (marcatori.length > 0) {
      console.log(`⚽ Capocannoniere: ${marcatori[0].nome} con ${marcatori[0].gol} gol`);
    }
  } catch (err) {
    console.error('❌ Errore:', err.message);
    console.log('\n💡 Se il formato della pagina è cambiato, aggiorna manualmente classifica.json');
    process.exit(1);
  }
}

main();
