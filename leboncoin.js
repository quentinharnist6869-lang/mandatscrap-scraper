// scraper/leboncoin.js
// Scraper LeBonCoin Immobilier
// Récupère les annonces de vente de la zone configurée

const puppeteer = require("puppeteer");
const config = require("./config");
const { genererFingerprint } = require("./fingerprint");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Délai aléatoire pour simuler un comportement humain */
function delai(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** User-agent aléatoire depuis la liste config */
function userAgentAleatoire() {
  const list = config.userAgents;
  return list[Math.floor(Math.random() * list.length)];
}

/** Extrait un prix depuis un string "289 000 €" → 289000 */
function extrairePrix(str) {
  if (!str) return null;
  const n = str.replace(/[^0-9]/g, "");
  return n ? parseInt(n) : null;
}

/** Extrait une surface depuis "95 m²" → 95 */
function extraireSurface(str) {
  if (!str) return null;
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

/** Extrait le nb de pièces depuis "4 pièces" → 4 */
function extrairePieces(str) {
  if (!str) return null;
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

/** Détermine si c'est un particulier ou une agence */
function detecterTypeVendeur(texteProPage) {
  if (!texteProPage) return "inconnu";
  const texte = texteProPage.toLowerCase();
  if (texte.includes("particulier")) return "particulier";
  if (texte.includes("exclusivité") || texte.includes("exclusif")) return "mandat_exclusif";
  if (texte.includes("agence") || texte.includes("immobilier") || texte.includes("mandataire")) return "agence_independante";
  return "particulier"; // LeBonCoin est majoritairement des particuliers
}

// ─── Scraping de la liste ─────────────────────────────────────────────────────

/**
 * Scrape une page de résultats LeBonCoin et retourne les annonces
 */
async function scraperPage(page, url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await delai(2000, 4000);

  // Extraire les annonces de la page de résultats
  const annonces = await page.evaluate(() => {
    const items = [];

    // Sélecteur des cartes annonces LeBonCoin (peut changer si LBC update leur HTML)
    const cartes = document.querySelectorAll('[data-test-id="ad"]') ||
                   document.querySelectorAll('li[data-qa-id="aditem_container"]') ||
                   document.querySelectorAll('article');

    cartes.forEach(carte => {
      try {
        // Titre
        const titreEl = carte.querySelector('[data-test-id="ad-title"]') ||
                        carte.querySelector('h2') ||
                        carte.querySelector('.Title_title__');
        const titre = titreEl?.textContent?.trim() || "";

        // Prix
        const prixEl = carte.querySelector('[data-test-id="price"]') ||
                       carte.querySelector('[aria-label*="prix"]') ||
                       carte.querySelector('.Price_price__');
        const prixTexte = prixEl?.textContent?.trim() || "";

        // Localisation
        const locEl = carte.querySelector('[data-test-id="location"]') ||
                      carte.querySelector('[aria-label*="location"]') ||
                      carte.querySelector('.LocationAndDateContainer_locationAndDateContainer__');
        const locTexte = locEl?.textContent?.trim() || "";

        // URL
        const lienEl = carte.querySelector('a[href*="/ventes_immobilieres/"]') ||
                       carte.querySelector('a');
        const url = lienEl ? lienEl.href : "";

        // Attributs (surface, pièces)
        const attributs = [];
        carte.querySelectorAll('[data-test-id="attribute"]').forEach(a => {
          attributs.push(a.textContent.trim());
        });

        if (url && titre) {
          items.push({ titre, prixTexte, locTexte, url, attributs });
        }
      } catch (e) {}
    });

    return items;
  });

  return annonces;
}

/**
 * Scrape la page détail d'une annonce pour obtenir plus d'infos
 */
async function scraperDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await delai(1500, 3000);

    const detail = await page.evaluate(() => {
      // Description
      const descEl = document.querySelector('[data-test-id="description-text"]') ||
                     document.querySelector('[itemprop="description"]');
      const description = descEl?.textContent?.trim()?.slice(0, 500) || ""; // Limiter à 500 chars

      // Type vendeur (pro ou particulier)
      const proEl = document.querySelector('[data-test-id="profile-link-name"]') ||
                    document.querySelector('[data-test-id="seller-type"]');
      const typeVendeurTexte = proEl?.textContent?.trim() || "";

      // Nom vendeur
      const nomEl = document.querySelector('[data-test-id="author-name"]');
      const nomVendeur = nomEl?.textContent?.trim() || "";

      // Attributs détaillés
      const attributsDetail = {};
      document.querySelectorAll('[data-test-id="criteria_item"]').forEach(item => {
        const key = item.querySelector('[data-test-id="criteria_label"]')?.textContent?.trim();
        const val = item.querySelector('[data-test-id="criteria_value"]')?.textContent?.trim();
        if (key && val) attributsDetail[key] = val;
      });

      return { description, typeVendeurTexte, nomVendeur, attributsDetail };
    });

    return detail;
  } catch (e) {
    console.warn(`⚠️ Impossible de scraper le détail de ${url} : ${e.message}`);
    return { description: "", typeVendeurTexte: "", nomVendeur: "", attributsDetail: {} };
  }
}

// ─── Parser les données brutes ────────────────────────────────────────────────

/**
 * Transforme les données brutes d'une carte LBC en objet structuré
 */
function parserAnnonce(raw, detail, zone) {
  // Parser la localisation "Strasbourg 67000"
  const locMatch = raw.locTexte.match(/^(.+?)\s+(\d{5})/);
  const ville = locMatch ? locMatch[1].trim() : raw.locTexte.split(",")[0].trim();
  const codePostal = locMatch ? locMatch[2] : "";

  // Parser les attributs (surface, pièces)
  let surface = null;
  let nbPieces = null;

  raw.attributs.forEach(attr => {
    if (attr.includes("m²") || attr.includes("m2")) {
      surface = extraireSurface(attr);
    }
    if (attr.includes("pièce") || attr.includes("piece")) {
      nbPieces = extrairePieces(attr);
    }
  });

  // Aussi chercher dans les attributs détaillés si disponibles
  if (detail?.attributsDetail) {
    const attrs = detail.attributsDetail;
    if (!surface && attrs["Surface"]) surface = extraireSurface(attrs["Surface"]);
    if (!nbPieces && attrs["Pièces"]) nbPieces = extrairePieces(attrs["Pièces"]);
  }

  // Type bien (maison vs appartement depuis le titre)
  let typeBien = "inconnu";
  const titreMin = raw.titre.toLowerCase();
  if (titreMin.includes("maison") || titreMin.includes("villa") || titreMin.includes("pavillon")) {
    typeBien = "maison";
  } else if (titreMin.includes("appartement") || titreMin.includes("appart") || titreMin.includes("studio") || titreMin.includes("t2") || titreMin.includes("t3") || titreMin.includes("t4")) {
    typeBien = "appartement";
  }

  const typeVendeur = detecterTypeVendeur(detail?.typeVendeurTexte);

  const annonceParsee = {
    source: "leboncoin",
    url: raw.url,
    titre: raw.titre,
    prix: extrairePrix(raw.prixTexte),
    surface,
    nbPieces,
    ville,
    codePostal,
    typeBien,
    typeVendeur,
    nomVendeur: detail?.nomVendeur || null,
    description: detail?.description || null,
    zone,
  };

  // Générer le fingerprint
  annonceParsee.fingerprint = genererFingerprint(annonceParsee);

  return annonceParsee;
}

// ─── Scraper principal ────────────────────────────────────────────────────────

/**
 * Lance le scraper LeBonCoin complet pour une zone
 * Retourne toutes les annonces parsées
 */
async function scraperLeBonCoin(zone = "alsace") {
  const zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error(`Zone inconnue : ${zone}`);

  console.log(`\n🔍 Démarrage scraping LeBonCoin — Zone: ${zoneConfig.label}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  });

  const annoncesRecuperees = [];

  try {
    const page = await browser.newPage();

    // Configurer le navigateur pour ressembler à un humain
    await page.setUserAgent(userAgentAleatoire());
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "fr-FR,fr;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    });

    // ── Scraper les pages de résultats ────────────────────────────────────
    for (let numPage = 1; numPage <= config.maxPages; numPage++) {

      // URL LeBonCoin vente immobilier avec localisation
      // Catégorie 9 = Immobilier, sous-catégorie vente
      const url = `https://www.leboncoin.fr/recherche?category=9&owner_type=all&real_estate_type=1,2&locations=${zoneConfig.lbcLocation}&page=${numPage}`;

      console.log(`  📄 Page ${numPage}/${config.maxPages} — ${url}`);

      try {
        const annoncesBrutes = await scraperPage(page, url);

        if (annoncesBrutes.length === 0) {
          console.log(`  ℹ️ Plus d'annonces à partir de la page ${numPage}`);
          break;
        }

        console.log(`  ✓ ${annoncesBrutes.length} annonces trouvées sur la page ${numPage}`);

        // ── Pour chaque annonce, scraper la page détail ──────────────────
        for (const raw of annoncesBrutes) {
          try {
            await delai(
              config.delaiEntreAnnonces.min,
              config.delaiEntreAnnonces.max
            );

            // Scraper le détail uniquement pour les annonces potentiellement intéressantes
            // (optimisation : on peut sauter le détail des annonces récentes)
            const detail = await scraperDetail(page, raw.url);
            const annonce = parserAnnonce(raw, detail, zone);

            if (annonce.fingerprint) {
              annoncesRecuperees.push(annonce);
            } else {
              console.warn(`  ⚠️ Fingerprint impossible pour ${raw.titre} — données insuffisantes`);
            }

          } catch (e) {
            console.warn(`  ⚠️ Erreur sur l'annonce ${raw.url} : ${e.message}`);
          }
        }

        // Délai entre les pages
        await delai(
          config.delaiEntrePages.min,
          config.delaiEntrePages.max
        );

      } catch (e) {
        console.error(`  ❌ Erreur page ${numPage} : ${e.message}`);
        // On continue avec la page suivante
      }
    }

  } finally {
    await browser.close();
  }

  console.log(`✅ LeBonCoin terminé — ${annoncesRecuperees.length} annonces récupérées\n`);
  return annoncesRecuperees;
}

module.exports = { scraperLeBonCoin };
