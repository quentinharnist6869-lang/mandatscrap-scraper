// leboncoin-api.js — scraper via API interne LeBonCoin
// Intercepte les requetes XHR de l'app LBC au lieu de parser le HTML
// Beaucoup plus stable car l'API change moins souvent que le HTML

const puppeteer = require("puppeteer");
const config    = require("./config");
const { genererFingerprint } = require("./fingerprint");

function delai(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

function userAgentAleatoire() {
  return config.userAgents[Math.floor(Math.random() * config.userAgents.length)];
}

/**
 * Scrape LeBonCoin en interceptant les reponses API JSON
 * LBC charge ses annonces via fetch() vers api.leboncoin.fr
 * On intercepte ces reponses directement
 */
async function scraperLeBonCoinAPI(zone = "alsace") {
  const zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error("Zone inconnue : " + zone);
  console.log("Demarrage LeBonCoin (API) — Zone:", zoneConfig.label);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu",
      "--single-process",
    ],
  });

  const annoncesRecuperees = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgentAleatoire());
    await page.setViewport({ width: 1366, height: 768 });

    // Intercepter toutes les reponses reseau
    const reponsesAPI = [];

    page.on("response", async response => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";

      // On cherche les appels API qui retournent des annonces
      if (
        (url.includes("api.leboncoin.fr") || url.includes("leboncoin.fr/api")) &&
        contentType.includes("application/json")
      ) {
        try {
          const body = await response.json();
          if (body?.ads && Array.isArray(body.ads)) {
            console.log("  API interceptee:", url.slice(0, 80));
            console.log("  Annonces dans la reponse:", body.ads.length);
            reponsesAPI.push(body);
          }
        } catch(e) {}
      }
    });

    // Naviguer sur la page de recherche — LBC va faire ses appels API
    for (let numPage = 1; numPage <= config.maxPages; numPage++) {
      reponsesAPI.length = 0; // Reset

      const url = `https://www.leboncoin.fr/recherche?category=9&owner_type=all&real_estate_type=1,2&locations=${zoneConfig.lbcLocation}&page=${numPage}`;
      console.log("  Page", numPage + "/" + config.maxPages);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await delai(2000, 3000);

        if (reponsesAPI.length === 0) {
          console.log("  Aucune reponse API interceptee — tentative scraping HTML");
          // Fallback HTML si l'API n'est pas interceptee
          const annoncesFallback = await scraperPageHTML(page, url);
          if (annoncesFallback.length === 0) {
            console.log("  Fin des resultats");
            break;
          }
          annoncesRecuperees.push(...annoncesFallback.map(a => parserAnnonceHTML(a, zone)));
          continue;
        }

        // Parser les annonces depuis les reponses API
        for (const reponse of reponsesAPI) {
          const annonces = parserAnnoncesAPI(reponse.ads, zone);
          annoncesRecuperees.push(...annonces);
          console.log("  " + annonces.length + " annonces parsees depuis l'API");

          // Verifier s'il y a d'autres pages
          if (reponse.total && reponse.total <= numPage * 35) {
            console.log("  Toutes les annonces recuperees");
            break;
          }
        }

        await delai(config.delaiEntrePages.min, config.delaiEntrePages.max);

      } catch(e) {
        console.error("  Erreur page", numPage, ":", e.message);
      }
    }

  } finally {
    await browser.close();
  }

  console.log("LeBonCoin API termine —", annoncesRecuperees.length, "annonces");
  return annoncesRecuperees;
}

/**
 * Parser les annonces depuis la reponse JSON de l'API LBC
 * Structure typique : { ads: [{ subject, price, location, attributes, url, ... }] }
 */
function parserAnnoncesAPI(ads, zone) {
  const annonces = [];

  for (const ad of ads) {
    try {
      // Extraire les attributs (surface, pieces, type)
      const attrs = {};
      if (ad.attributes) {
        ad.attributes.forEach(a => {
          attrs[a.key] = a.value_label || a.values?.[0]?.value_label || a.value;
        });
      }

      const surface  = attrs.square ? parseInt(attrs.square) : null;
      const nbPieces = attrs.rooms  ? parseInt(attrs.rooms)  : null;

      // Type de bien
      let typeBien = "inconnu";
      const realEstateType = attrs.real_estate_type?.toLowerCase() || "";
      const sujet = (ad.subject || "").toLowerCase();
      if (realEstateType.includes("maison") || sujet.includes("maison") || sujet.includes("villa")) {
        typeBien = "maison";
      } else if (realEstateType.includes("appartement") || sujet.includes("appartement") || sujet.includes("studio")) {
        typeBien = "appartement";
      }

      // Type vendeur
      const typeVendeur = ad.owner?.type === "pro" ? "agence_independante" : "particulier";

      // Localisation
      const ville      = ad.location?.city || ad.location?.region_name || "";
      const codePostal = ad.location?.zipcode || "";

      // Prix
      const prix = ad.price?.[0] || null;

      // URL
      const adUrl = ad.url
        ? (ad.url.startsWith("http") ? ad.url : "https://www.leboncoin.fr" + ad.url)
        : "";

      const annonce = {
        source:      "leboncoin",
        url:         adUrl,
        titre:       ad.subject || "",
        prix,
        surface,
        nbPieces,
        ville,
        codePostal,
        typeBien,
        typeVendeur,
        description: ad.body?.slice(0, 500) || null,
        zone,
        // Donnees supplementaires disponibles via l'API
        datePublication: ad.first_publication_date || null,
        nbImages:        ad.images?.nb_images || 0,
      };

      annonce.fingerprint = genererFingerprint(annonce);
      if (annonce.fingerprint) annonces.push(annonce);

    } catch(e) {
      console.warn("  Erreur parsing annonce API:", e.message);
    }
  }

  return annonces;
}

/**
 * Fallback HTML si l'API n'est pas interceptee
 */
async function scraperPageHTML(page, url) {
  const annonces = await page.evaluate(() => {
    const items = [];
    const selecteurs = [
      '[data-test-id="ad"]',
      'article[data-qa-id]',
      'article[class*="styles_adCard"]',
      'article[class*="AdCard"]',
      'article',
    ];

    let cartes = [];
    for (const sel of selecteurs) {
      cartes = Array.from(document.querySelectorAll(sel));
      if (cartes.length > 2) break;
    }

    cartes.forEach(carte => {
      try {
        const titreEl = carte.querySelector('[data-test-id="ad-title"]') ||
          carte.querySelector('h2') || carte.querySelector('h3') ||
          carte.querySelector('[class*="title" i]');
        const titre = titreEl?.textContent?.trim() || "";

        const prixEl = carte.querySelector('[data-test-id="price"]') ||
          carte.querySelector('[class*="price" i]') ||
          carte.querySelector('[class*="prix" i]');
        const prixTexte = prixEl?.textContent?.trim() || "";

        const locEl = carte.querySelector('[data-test-id="location"]') ||
          carte.querySelector('[class*="location" i]') ||
          carte.querySelector('[class*="city" i]');
        const locTexte = locEl?.textContent?.trim() || "";

        const lienEl = carte.querySelector('a[href*="/ventes_immobilieres/"]') ||
          carte.querySelector('a[href*="/annonces/"]') ||
          carte.querySelector('a[href]');
        const href = lienEl?.getAttribute("href") || "";
        const annUrl = href.startsWith("http") ? href : "https://www.leboncoin.fr" + href;

        const texte = carte.textContent || "";
        const surfaceMatch = texte.match(/(\d+)\s*m[²2]/i);
        const piecesMatch = texte.match(/(\d+)\s*pi/i);

        if (href && titre && titre.length > 3) {
          items.push({
            titre, prixTexte, locTexte, url: annUrl,
            surface: surfaceMatch ? surfaceMatch[1] : "",
            pieces: piecesMatch ? piecesMatch[1] : "",
          });
        }
      } catch(e) {}
    });
    return items;
  });
  return annonces;
}

function parserAnnonceHTML(raw, zone) {
  const locMatch = (raw.locTexte || "").match(/^(.+?)\s+(\d{5})/);
  const ville = locMatch ? locMatch[1].trim() : (raw.locTexte || "").split(",")[0].trim();
  const codePostal = locMatch ? locMatch[2] : "";
  const prix = raw.prixTexte ? parseInt(raw.prixTexte.replace(/[^0-9]/g, "")) || null : null;
  const surface = raw.surface ? parseInt(raw.surface) || null : null;
  const nbPieces = raw.pieces ? parseInt(raw.pieces) || null : null;

  let typeBien = "inconnu";
  const t = (raw.titre || "").toLowerCase();
  if (t.includes("maison") || t.includes("villa")) typeBien = "maison";
  else if (t.includes("appartement") || t.includes("studio")) typeBien = "appartement";

  const annonce = {
    source: "leboncoin", url: raw.url, titre: raw.titre,
    prix, surface, nbPieces, ville, codePostal,
    typeBien, typeVendeur: "particulier",
    description: null, zone,
  };
  annonce.fingerprint = genererFingerprint(annonce);
  return annonce;
}

module.exports = { scraperLeBonCoin: scraperLeBonCoinAPI };
