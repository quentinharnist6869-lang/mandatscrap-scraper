// leboncoin.js — selecteurs robustes 2026
const puppeteer = require("puppeteer");
const config    = require("./config");
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
  const m = str.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}
function extrairePieces(str) {
  if (!str) return null;
  const m = str.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

async function scraperPageLBC(page, url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await delai(2000, 4000);

  const annonces = await page.evaluate(() => {
    const items = [];
    const selecteurs = [
      '[data-test-id="ad"]',
      'article[data-qa-id="aditem_container"]',
      'article[class*="styles_adCard"]',
      'article[class*="AdCard"]',
      'li[class*="styles_"]',
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
        const piecesMatch = texte.match(/(\d+)\s*p[ie]/i);

        if (href && titre && titre.length > 3) {
          items.push({
            titre, prixTexte, locTexte, url: annUrl,
            surface: surfaceMatch ? surfaceMatch[0] : "",
            pieces: piecesMatch ? piecesMatch[0] : "",
          });
        }
      } catch(e) {}
    });
    return items;
  });

  return annonces;
}

async function scraperDetailLBC(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await delai(1000, 2000);
    return await page.evaluate(() => {
      const descEl = document.querySelector('[data-test-id="description-text"]') ||
        document.querySelector('[class*="description" i]');
      const description = descEl?.textContent?.trim()?.slice(0, 500) || "";
      const proEl = document.querySelector('[data-test-id="profile-link-name"]') ||
        document.querySelector('[class*="seller" i]');
      const typeVendeurTexte = proEl?.textContent?.trim() || "";
      const texte = document.body.textContent || "";
      const surfaceMatch = texte.match(/(\d+)\s*m[²2]/i);
      const piecesMatch = texte.match(/(\d+)\s*pi[ee]ce/i);
      return {
        description, typeVendeurTexte,
        surface: surfaceMatch ? surfaceMatch[0] : "",
        pieces: piecesMatch ? piecesMatch[0] : "",
      };
    });
  } catch(e) {
    return { description: "", typeVendeurTexte: "", surface: "", pieces: "" };
  }
}

function parserAnnonce(raw, detail, zone) {
  const locMatch = raw.locTexte.match(/^(.+?)\s+(\d{5})/);
  const ville = locMatch ? locMatch[1].trim() : raw.locTexte.split(",")[0].trim();
  const codePostal = locMatch ? locMatch[2] : "";
  const surface = extraireSurface(detail.surface || raw.surface || "");
  const nbPieces = extrairePieces(detail.pieces || raw.pieces || "");

  let typeBien = "inconnu";
  const t = (raw.titre || "").toLowerCase();
  if (t.includes("maison") || t.includes("villa")) typeBien = "maison";
  else if (t.includes("appartement") || t.includes("studio")) typeBien = "appartement";

  let typeVendeur = "particulier";
  const tv = (detail.typeVendeurTexte || "").toLowerCase();
  if (tv.includes("agence") || tv.includes("pro")) typeVendeur = "agence_independante";

  const annonce = {
    source: "leboncoin", url: raw.url, titre: raw.titre,
    prix: extrairePrix(raw.prixTexte), surface, nbPieces,
    ville, codePostal, typeBien, typeVendeur,
    description: detail.description || null, zone,
  };
  annonce.fingerprint = genererFingerprint(annonce);
  return annonce;
}

async function scraperLeBonCoin(zone = "alsace") {
  const zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error("Zone inconnue : " + zone);
  console.log("Demarrage LeBonCoin — Zone:", zoneConfig.label);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
  });

  const annonces = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgentAleatoire());
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,fr;q=0.9" });

    for (let numPage = 1; numPage <= config.maxPages; numPage++) {
      const url = `https://www.leboncoin.fr/recherche?category=9&owner_type=all&real_estate_type=1,2&locations=${zoneConfig.lbcLocation}&page=${numPage}`;
      console.log("  Page", numPage);
      try {
        const brutes = await scraperPageLBC(page, url);
        if (brutes.length === 0) { console.log("  Fin page", numPage); break; }
        console.log(" ", brutes.length, "annonces page", numPage);
        for (const raw of brutes) {
          try {
            await delai(config.delaiEntreAnnonces.min, config.delaiEntreAnnonces.max);
            const detail = await scraperDetailLBC(page, raw.url);
            const annonce = parserAnnonce(raw, detail, zone);
            if (annonce.fingerprint) annonces.push(annonce);
          } catch(e) { console.warn("  Erreur annonce:", e.message); }
        }
        await delai(config.delaiEntrePages.min, config.delaiEntrePages.max);
      } catch(e) { console.error("  Erreur page", numPage, e.message); }
    }
  } finally {
    await browser.close();
  }

  console.log("LeBonCoin termine —", annonces.length, "annonces");
  return annonces;
}

module.exports = { scraperLeBonCoin };
