// scraper/avendrealouer.js
// Scraper AVendreALouer — agences régionales indépendantes
// Protection faible, bon complément à LBC et PAP

const puppeteer = require("puppeteer");
const config = require("./config");
const { genererFingerprint } = require("./fingerprint");

function delai(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

function userAgentAleatoire() {
  return config.userAgents[Math.floor(Math.random() * config.userAgents.length)];
}

function extrairePrix(str) {
  if (!str) return null;
  const n = str.replace(/[^0-9]/g, "");
  return n ? parseInt(n) : null;
}

function extraireSurface(str) {
  if (!str) return null;
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function extrairePieces(str) {
  if (!str) return null;
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function extraireCodePostal(str) {
  if (!str) return null;
  const match = str.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

// ─── Scraping liste AVA ───────────────────────────────────────────────────────

async function scraperPageAVA(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await delai(2000, 4000);

  const annonces = await page.evaluate(() => {
    const items = [];
    const cartes = document.querySelectorAll(
      '.ad-content, .listing-item, article[class*="ad"], [class*="property-card"]'
    );

    cartes.forEach(carte => {
      try {
        const titreEl = carte.querySelector('h2, h3, .ad-title, [class*="title"]');
        const titre = titreEl?.textContent?.trim() || "";

        const prixEl = carte.querySelector('[class*="prix"], [class*="price"], .ad-price');
        const prixTexte = prixEl?.textContent?.trim() || "";

        const locEl = carte.querySelector('[class*="city"], [class*="location"], .ad-city');
        const locTexte = locEl?.textContent?.trim() || "";

        const lienEl = carte.querySelector('a[href*="/annonce/"], a[href*="/vente/"], a[href*="/achat/"]');
        const href = lienEl?.getAttribute("href") || "";
        const url = href.startsWith("http") ? href : "https://www.avendrealouer.fr" + href;

        const surfaceEl = carte.querySelector('[class*="surface"], .ad-surface');
        const piecesEl = carte.querySelector('[class*="piece"], [class*="room"], .ad-rooms');

        if (href && titre) {
          items.push({
            titre,
            prixTexte,
            locTexte,
            url,
            surface: surfaceEl?.textContent?.trim() || "",
            pieces: piecesEl?.textContent?.trim() || "",
          });
        }
      } catch(e) {}
    });

    return items;
  });

  return annonces;
}

async function scraperDetailAVA(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await delai(1000, 2000);

    return await page.evaluate(() => {
      const descEl = document.querySelector('.ad-description, [class*="description"]');
      const description = descEl?.textContent?.trim()?.slice(0, 600) || "";

      const agenceEl = document.querySelector('.agency-name, [class*="agence"], [class*="agency"]');
      const nomAgence = agenceEl?.textContent?.trim() || "";

      const surfaceEl = document.querySelector('.ad-surface span, [itemprop="floorSize"]');
      const surface = surfaceEl?.textContent?.trim() || "";

      const piecesEl = document.querySelector('.ad-rooms span, [class*="pieces"]');
      const pieces = piecesEl?.textContent?.trim() || "";

      const cpEl = document.querySelector('[itemprop="addressLocality"], .ad-location');
      const localisation = cpEl?.textContent?.trim() || "";

      return { description, nomAgence, surface, pieces, localisation };
    });

  } catch(e) {
    console.warn(`⚠️ Détail AVA inaccessible : ${e.message}`);
    return { description: "", nomAgence: "", surface: "", pieces: "", localisation: "" };
  }
}

function parserAnnonceAVA(raw, detail, zone) {
  const locSource = detail.localisation || raw.locTexte || "";
  const codePostal = extraireCodePostal(locSource);
  const ville = locSource.replace(/\s*\d{5}\s*/, "").replace(/\([^)]*\)/, "").trim();

  const surface = extraireSurface(detail.surface || raw.surface || "");
  const nbPieces = extrairePieces(detail.pieces || raw.pieces || "");

  let typeBien = "inconnu";
  const t = raw.titre.toLowerCase();
  if (t.includes("maison") || t.includes("villa") || t.includes("pavillon")) typeBien = "maison";
  else if (t.includes("appartement") || t.includes("studio") || t.includes("t2") || t.includes("t3") || t.includes("t4")) typeBien = "appartement";

  // AVA = majoritairement des agences indépendantes
  const typeVendeur = detail.nomAgence ? "agence_independante" : "particulier";

  const annonce = {
    source: "avendrealouer",
    url: raw.url,
    titre: raw.titre,
    prix: extrairePrix(raw.prixTexte),
    surface,
    nbPieces,
    ville,
    codePostal,
    typeBien,
    typeVendeur,
    nomVendeur: detail.nomAgence || null,
    description: detail.description || null,
    zone,
  };

  annonce.fingerprint = genererFingerprint(annonce);
  return annonce;
}

async function scraperAVA(zone = "alsace") {
  const zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error(`Zone inconnue : ${zone}`);

  console.log(`\n🔍 Démarrage scraping AVendreALouer — Zone: ${zoneConfig.label}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const annoncesRecuperees = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgentAleatoire());
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,fr;q=0.9" });

    // AVA : recherche par département
    // URL format : /vente-maison-appartement/{cp}.htm
    const cp = zoneConfig.codesPostaux[0]?.slice(0, 2) || "67"; // département
    const urls = [
      `https://www.avendrealouer.fr/vente-maison.html?localite=${cp}`,
      `https://www.avendrealouer.fr/vente-appartement.html?localite=${cp}`,
    ];

    for (const urlBase of urls) {
      for (let numPage = 1; numPage <= Math.ceil(config.maxPages / 2); numPage++) {
        const url = numPage === 1 ? urlBase : `${urlBase}&page=${numPage}`;
        console.log(`  📄 Page ${numPage} — ${url}`);

        try {
          const brutes = await scraperPageAVA(page, url);
          if (brutes.length === 0) break;
          console.log(`  ✓ ${brutes.length} annonces`);

          for (const raw of brutes) {
            try {
              await delai(config.delaiEntreAnnonces.min, config.delaiEntreAnnonces.max);
              const detail = await scraperDetailAVA(page, raw.url);
              const annonce = parserAnnonceAVA(raw, detail, zone);
              if (annonce.fingerprint) annoncesRecuperees.push(annonce);
            } catch(e) {
              console.warn(`  ⚠️ ${e.message}`);
            }
          }

          await delai(config.delaiEntrePages.min, config.delaiEntrePages.max);
        } catch(e) {
          console.error(`  ❌ Erreur page ${numPage} AVA : ${e.message}`);
        }
      }
    }

  } finally {
    await browser.close();
  }

  console.log(`✅ AVendreALouer terminé — ${annoncesRecuperees.length} annonces\n`);
  return annoncesRecuperees;
}

module.exports = { scraperAVA };
