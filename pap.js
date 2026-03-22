// scraper/pap.js
// Scraper PAP.fr — 100% particuliers, souvent avec téléphone visible
// PAP est peu protégé, HTML majoritairement statique → très fiable

const puppeteer = require("puppeteer");
const config = require("./config");
const { genererFingerprint } = require("./fingerprint");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delai(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

function userAgentAleatoire() {
  const list = config.userAgents;
  return list[Math.floor(Math.random() * list.length)];
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

function extraireVille(str) {
  if (!str) return str;
  // "Paris 75001" → "Paris"
  return str.replace(/\s*\d{5}\s*/, "").replace(/\s*\(\d{2}\)\s*/, "").trim();
}

// ─── Scraping liste PAP ───────────────────────────────────────────────────────

/**
 * Scrape une page de résultats PAP.fr
 * PAP utilise du HTML statique majoritairement — très simple à parser
 */
async function scraperPagePAP(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await delai(1500, 3000);

  const annonces = await page.evaluate(() => {
    const items = [];

    // PAP liste les annonces dans des articles ou divs avec class contenant "annonce"
    const cartes = document.querySelectorAll(
      'article.annonce, div.annonce-item, [class*="liste-annonces"] > div, ' +
      '.search-list-item, [data-id]'
    );

    cartes.forEach(carte => {
      try {
        // Titre
        const titreEl = carte.querySelector('h2, h3, .title, [class*="title"]');
        const titre = titreEl?.textContent?.trim() || "";

        // Prix
        const prixEl = carte.querySelector('[class*="prix"], [class*="price"], .prix');
        const prixTexte = prixEl?.textContent?.trim() || "";

        // Localisation
        const locEl = carte.querySelector('[class*="ville"], [class*="location"], .localisation, [class*="city"]');
        const locTexte = locEl?.textContent?.trim() || "";

        // URL de l'annonce
        const lienEl = carte.querySelector('a[href*="/annonce/"], a[href*="/vente/"]');
        const href = lienEl?.getAttribute("href") || "";
        const url = href.startsWith("http") ? href : "https://www.pap.fr" + href;

        // Attributs (surface, pièces)
        const surfaceEl = carte.querySelector('[class*="surface"], [class*="area"]');
        const piecesEl = carte.querySelector('[class*="piece"], [class*="room"]');
        const surface = surfaceEl?.textContent?.trim() || "";
        const pieces = piecesEl?.textContent?.trim() || "";

        // Date publication (PAP affiche souvent "il y a X jours")
        const dateEl = carte.querySelector('[class*="date"], time');
        const dateTexte = dateEl?.textContent?.trim() || "";

        if (href && titre) {
          items.push({ titre, prixTexte, locTexte, url, surface, pieces, dateTexte });
        }
      } catch(e) {}
    });

    return items;
  });

  return annonces;
}

// ─── Scraping détail PAP ──────────────────────────────────────────────────────

/**
 * Scrape la page détail d'une annonce PAP
 * PAP est la seule plateforme qui affiche parfois le téléphone — mine d'or
 */
async function scraperDetailPAP(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await delai(1000, 2500);

    const detail = await page.evaluate(() => {
      // Description
      const descEl = document.querySelector(
        '[class*="description"], [itemprop="description"], .annonce-description'
      );
      const description = descEl?.textContent?.trim()?.slice(0, 600) || "";

      // Téléphone (affiché sur PAP pour les particuliers)
      // PAP masque souvent le téléphone derrière un clic — on récupère ce qui est visible
      const telEl = document.querySelector(
        '[class*="telephone"], [class*="phone"], a[href^="tel:"]'
      );
      const telephone = telEl?.textContent?.trim()
        || telEl?.getAttribute("href")?.replace("tel:", "")
        || null;

      // Surface détaillée
      const surfaceEl = document.querySelector(
        '[class*="surface"] span, [itemprop="floorSize"], .critere-surface'
      );
      const surface = surfaceEl?.textContent?.trim() || "";

      // Pièces
      const piecesEl = document.querySelector(
        '[class*="piece"] span, [class*="nbpieces"], .critere-pieces'
      );
      const pieces = piecesEl?.textContent?.trim() || "";

      // Code postal / ville
      const locEl = document.querySelector(
        '[class*="localisation"] span, [itemprop="addressLocality"], .annonce-ville'
      );
      const localisation = locEl?.textContent?.trim() || "";

      // DPE si affiché
      const dpeEl = document.querySelector('[class*="dpe"], [class*="energie"]');
      const dpe = dpeEl?.textContent?.trim() || null;

      // Critères supplémentaires (garage, cave, etc.)
      const criteres = [];
      document.querySelectorAll('[class*="critere"], [class*="feature"]').forEach(c => {
        const t = c.textContent?.trim();
        if (t && t.length < 50) criteres.push(t);
      });

      // Date de publication
      const dateEl = document.querySelector(
        '[class*="date-parution"], time, [class*="posted"]'
      );
      const datePublication = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";

      return {
        description,
        telephone,
        surface,
        pieces,
        localisation,
        dpe,
        criteres: criteres.slice(0, 10),
        datePublication,
      };
    });

    return detail;

  } catch(e) {
    console.warn(`⚠️ Détail PAP inaccessible pour ${url} : ${e.message}`);
    return {
      description: "",
      telephone: null,
      surface: "",
      pieces: "",
      localisation: "",
      dpe: null,
      criteres: [],
      datePublication: "",
    };
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parserAnnoncePAP(raw, detail, zone) {
  // Localisation depuis le détail ou la liste
  const locSource = detail.localisation || raw.locTexte || "";
  const codePostal = extraireCodePostal(locSource);
  const ville = extraireVille(locSource);

  // Surface : priorité au détail, fallback sur la liste
  const surfaceStr = detail.surface || raw.surface || "";
  const surface = extraireSurface(surfaceStr);

  // Pièces
  const piecesStr = detail.pieces || raw.pieces || "";
  const nbPieces = extrairePieces(piecesStr);

  // Type de bien depuis le titre
  let typeBien = "inconnu";
  const titreMin = raw.titre.toLowerCase();
  if (titreMin.includes("maison") || titreMin.includes("villa") || titreMin.includes("corps de ferme")) {
    typeBien = "maison";
  } else if (titreMin.includes("appartement") || titreMin.includes("studio") || titreMin.includes("duplex") || titreMin.includes("loft")) {
    typeBien = "appartement";
  } else if (titreMin.includes("terrain")) {
    typeBien = "terrain";
  }

  // PAP = toujours un particulier (c'est leur positionnement)
  const typeVendeur = "particulier";

  const annonce = {
    source: "pap",
    url: raw.url,
    titre: raw.titre,
    prix: extrairePrix(raw.prixTexte),
    surface,
    nbPieces,
    ville,
    codePostal,
    typeBien,
    typeVendeur,
    telephone: detail.telephone || null, // 🔑 Uniquement PAP expose ça
    description: detail.description || null,
    dpe: detail.dpe || null,
    criteres: detail.criteres || [],
    zone,
  };

  annonce.fingerprint = genererFingerprint(annonce);
  return annonce;
}

// ─── Construction des URLs PAP par zone ──────────────────────────────────────

/**
 * Génère les URLs de recherche PAP pour une zone
 * PAP permet de filtrer par département ou par ville
 */
function genererURLsPAP(zoneConfig) {
  const urls = [];

  // PAP recherche par localisation — on passe le département
  // Format URL PAP : /annonce/ventes-immobilieres-67.htm pour le Bas-Rhin
  // On génère une URL par type de bien pour maximiser la couverture

  const baseUrl = `https://www.pap.fr/annonce/ventes-immobilieres`;
  const locationPAP = zoneConfig.papLocation || "alsace"; // ex: "67" pour Bas-Rhin

  // Maisons + appartements dans un seul appel
  urls.push(`${baseUrl}-${locationPAP}.htm`);

  return urls;
}

// ─── Scraper principal PAP ────────────────────────────────────────────────────

async function scraperPAP(zone = "alsace") {
  const zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error(`Zone inconnue : ${zone}`);

  console.log(`\n🔍 Démarrage scraping PAP.fr — Zone: ${zoneConfig.label}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
    ],
  });

  const annoncesRecuperees = [];

  try {
    const page = await browser.newPage();

    await page.setUserAgent(userAgentAleatoire());
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "fr-FR,fr;q=0.9",
      "Referer": "https://www.pap.fr/",
    });

    const urlsBase = genererURLsPAP(zoneConfig);

    for (const urlBase of urlsBase) {

      // ── Scraper les pages de résultats ──────────────────────────────────
      for (let numPage = 1; numPage <= config.maxPages; numPage++) {
        const separator = urlBase.includes("?") ? "&" : "?";
        const url = numPage === 1
          ? urlBase
          : `${urlBase}${separator}page=${numPage}`;

        console.log(`  📄 Page ${numPage} — ${url}`);

        try {
          const annoncesBrutes = await scraperPagePAP(page, url);

          if (annoncesBrutes.length === 0) {
            console.log(`  ℹ️ Fin des résultats à la page ${numPage}`);
            break;
          }

          console.log(`  ✓ ${annoncesBrutes.length} annonces trouvées`);

          // ── Scraper chaque détail ──────────────────────────────────────
          for (const raw of annoncesBrutes) {
            try {
              await delai(
                config.delaiEntreAnnonces.min,
                config.delaiEntreAnnonces.max
              );

              const detail = await scraperDetailPAP(page, raw.url);
              const annonce = parserAnnoncePAP(raw, detail, zone);

              if (annonce.fingerprint) {
                annoncesRecuperees.push(annonce);

                // Log si téléphone trouvé — info précieuse
                if (annonce.telephone) {
                  console.log(`  📞 Téléphone trouvé : ${annonce.titre} — ${annonce.telephone}`);
                }
              }

            } catch(e) {
              console.warn(`  ⚠️ Erreur détail : ${e.message}`);
            }
          }

          await delai(config.delaiEntrePages.min, config.delaiEntrePages.max);

        } catch(e) {
          console.error(`  ❌ Erreur page ${numPage} PAP : ${e.message}`);
        }
      }
    }

  } finally {
    await browser.close();
  }

  const avecTel = annoncesRecuperees.filter(a => a.telephone).length;
  console.log(`✅ PAP.fr terminé — ${annoncesRecuperees.length} annonces (dont ${avecTel} avec téléphone)\n`);
  return annoncesRecuperees;
}

module.exports = { scraperPAP };
