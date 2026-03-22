sudo tee /opt/mandatscrap/leboncoin.js > /dev/null << 'ENDOFFILE'
const fetch = require("node-fetch");
const config = require("./config");
const { genererFingerprint } = require("./fingerprint");

function delai(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

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

function buildSearchBody(zoneConfig, offset) {
  return {
    filters: {
      category: { id: "9" },
      enums: { ad_type: ["offer"], real_estate_type: ["1", "2"] },
      location: {
        area: { lat: zoneConfig.lat || 48.5734, lng: zoneConfig.lng || 7.7521, radius: zoneConfig.radius || 80000 },
        regions: zoneConfig.regions || ["13"],
      },
      ranges: {},
      keywords: {},
    },
    limit: 35,
    offset: offset,
    sort_by: "time",
    sort_order: "desc",
    owner_type: "all",
  };
}

function parserAnnonce(ad, zone) {
  var attrs = {};
  if (ad.attributes) {
    ad.attributes.forEach(function(a) {
      var val = a.value_label || (a.values && a.values[0] && a.values[0].value_label) || a.value;
      if (val) attrs[a.key] = val;
    });
  }
  var surface = attrs.square ? parseInt(attrs.square) : null;
  var nbPieces = attrs.rooms ? parseInt(attrs.rooms) : null;
  var typeBien = "inconnu";
  var ret = (attrs.real_estate_type || "").toLowerCase();
  var suj = (ad.subject || "").toLowerCase();
  if (ret.includes("maison") || suj.includes("maison") || suj.includes("villa") || suj.includes("pavillon")) {
    typeBien = "maison";
  } else if (ret.includes("appartement") || suj.includes("appartement") || suj.includes("studio")) {
    typeBien = "appartement";
  }
  var typeVendeur = (ad.owner && ad.owner.type === "pro") ? "agence_independante" : "particulier";
  var ville = (ad.location && ad.location.city) || (ad.location && ad.location.region_name) || "";
  var codePostal = (ad.location && ad.location.zipcode) || "";
  var prix = (ad.price && ad.price[0]) || null;
  var adUrl = ad.url ? (ad.url.startsWith("http") ? ad.url : "https://www.leboncoin.fr" + ad.url) : "";
  var annonce = {
    source: "leboncoin", url: adUrl, titre: ad.subject || "",
    prix: prix, surface: surface, nbPieces: nbPieces,
    ville: ville, codePostal: codePostal, typeBien: typeBien,
    typeVendeur: typeVendeur, description: ad.body ? ad.body.slice(0, 500) : null,
    zone: zone, datePublication: ad.first_publication_date || null,
    nbImages: (ad.images && ad.images.nb_images) || 0,
  };
  annonce.fingerprint = genererFingerprint(annonce);
  return annonce;
}

async function scraperLeBonCoin(zone) {
  if (!zone) zone = "alsace";
  var zoneConfig = config.zones[zone];
  if (!zoneConfig) throw new Error("Zone inconnue : " + zone);
  console.log("Demarrage LeBonCoin (HTTP API) — Zone:", zoneConfig.label);
  var annonces = [];
  var maxPages = config.maxPages || 10;
  for (var page = 0; page < maxPages; page++) {
    var offset = page * 35;
    console.log("  Requete page", page + 1, "/ offset", offset);
    try {
      await delai(1500, 2500);
      var response = await fetch("https://api.leboncoin.fr/finder/search", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(buildSearchBody(zoneConfig, offset)),
      });
      if (!response.ok) { console.warn("  HTTP", response.status); break; }
      var data = await response.json();
      if (!data.ads || data.ads.length === 0) { console.log("  Fin des resultats"); break; }
      console.log(" ", data.ads.length, "annonces (total:", (data.total || "?") + ")");
      for (var i = 0; i < data.ads.length; i++) {
        try {
          var annonce = parserAnnonce(data.ads[i], zone);
          if (annonce.fingerprint) annonces.push(annonce);
        } catch(e) { console.warn("  Erreur parsing:", e.message); }
      }
      if (data.total && offset + 35 >= data.total) { console.log("  Toutes recuperees"); break; }
    } catch(e) { console.error("  Erreur page", page + 1, ":", e.message); break; }
  }
  console.log("LeBonCoin termine —", annonces.length, "annonces");
  return annonces;
}

module.exports = { scraperLeBonCoin };
ENDOFFILE
}

module.exports = { scraperLeBonCoin };
