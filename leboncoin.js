// leboncoin.js — API HTTP directe, sans Puppeteer
// Appel direct vers api.leboncoin.fr comme le fait l'app mobile LBC
// Pas de browser = pas de detection bot sur les IPs GitHub Actions

const fetch = require("node-fetch");
const config = require("./config");
const { genererFingerprint } = require("./fingerprint");

function delai(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

// Headers qui imitent l'app mobile LBC
function getHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "User-Agent": "LeBonCoin/7.0 (iPhone; iOS 16.0; Scale/3.00)",
    "api_key": "ba0c2dad52b3565fd3cc2f8b4b1a4c84",
    "Origin": "https://www.leboncoin.fr",
    "Referer": "https://www.leboncoin.fr/",
  };
}

// Construire le body de la requete de recherche
function buildSearchBody(zoneConfig, offset = 0) {
  return {
    filters: {
      category: { id: "9" },                          // Immobilier
      enums: {
        ad_type: ["offer"],
        real_estate_type: ["1", "2"],                  // Maison + Appartement
      },
      location: {
        area: {
          lat: zoneConfig.lat || 48.5734,
          lng: zoneConfig.lng || 7.7521,
          radius: zoneConfig.radius || 50000,
        },
        regions: zoneConfig.regions || ["13"],         // Alsace
      },
      ranges: {},
      keywords: {},
    },
    limit: 35,
    offset,
    sort_by: "time",
    sort_order: "desc",
    owner_type: "all",
  };
}

async function scraperLeBonCoin(zone = "alsace") {
  const zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error("Zone inconnue : " + zone);
  console.log("Demarrage LeBonCoin (HTTP API) — Zone:", zoneConfig.label);

  const annonces = [];
  const maxPages = config.maxPages || 10;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 35;
    console.log("  Requete page", page + 1, "/ offset", offset);

    try {
      await delai(1500, 3000);

      const response = await fetch("https://api.leboncoin.fr/finder/search", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(buildSearchBody(zoneConfig, offset)),
      });

      if (!response.ok) {
        console.warn("  HTTP", response.status, "— arret");
        break;
      }

      const data = await response.json();

      if (!data.ads || data.ads.length === 0) {
        console.log("  Fin des resultats offset", offset);
        break;
      }

      console.log("  " + data.ads.length + " annonces (total: " + (data.total || "?") + ")");

      for (const ad of data.ads) {
        try {
          const annonce = parserAnnonce(ad, zone);
          if (annonce.fingerprint) annonces.push(annonce);
        } catch(e) {
          console.warn("  Erreur parsing:", e.message);
        }
      }

      // Si on a tout recupere
      if (data.total && offset + 35 >= data.total) {
        console.log("  Toutes les annonces recuperees");
        break;
      }

    } catch(e) {
      console.error("  Erreur page", page + 1, ":", e.message);
      break;
    }
  }

  console.log("LeBonCoin HTTP termine —", annonces.length, "annonces");
  return annonces;
}

function parserAnnonce(ad, zone) {
  // Extraire les attributs
  const attrs = {};
  if (ad.attributes) {
    ad.attributes.forEach(a => {
      const val = a.value_label || a.values?.[0]?.value_label || a.value;
      if (val) attrs[a.key] = val;
    });
  }

  const surface  = attrs.square ? parseInt(attrs.square)  : null;
  const nbPieces = attrs.rooms  ? parseInt(attrs.rooms)   : null;

  // Type de bien
  let typeBien = "inconnu";
  const ret = (attrs.real_estate_type || "").toLowerCase();
  const suj = (ad.subject || "").toLowerCase();
  if (ret.includes("maison") || suj.includes("maison") || suj.includes("villa") || suj.includes("pavillon")) {
    typeBien = "maison";
  } else if (ret.includes("appartement") || suj.includes("appartement") || suj.includes("studio")) {
    typeBien = "appartement";
  }

  // Type vendeur
  const typeVendeur = ad.owner?.type === "pro" ? "agence_independante" : "particulier";

  // Localisation
  const ville      = ad.location?.city        || ad.location?.region_name || "";
  const codePostal = ad.location?.zipcode     || "";

  // Prix
  const prix = ad.price?.[0] || null;

  // URL
  const adUrl = ad.url
    ? (ad.url.startsWith("http") ? ad.url : "https://www.leboncoin.fr" + ad.url)
    : "";

  const annonce = {
    source:           "leboncoin",
    url:              adUrl,
    titre:            ad.subject || "",
    prix,
    surface,
    nbPieces,
    ville,
    codePostal,
    typeBien,
    typeVendeur,
    description:      ad.body?.slice(0, 500) || null,
    zone,
    datePublication:  ad.first_publication_date || null,
    nbImages:         ad.images?.nb_images || 0,
  };

  annonce.fingerprint = genererFingerprint(annonce);
  return annonce;
}

module.exports = { scraperLeBonCoin };
