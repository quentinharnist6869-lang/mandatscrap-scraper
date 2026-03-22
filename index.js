// scraper/index.js
// Orchestrateur principal

require("dotenv").config();

const { scraperLeBonCoin } = require("./leboncoin");
const { scraperPAP }       = require("./pap");
const { scraperAVA }       = require("./avendrealouer");
const {
  initFirebase,
  getAnnonceParFingerprint,
  creerAnnonce,
  mettreAJourAnnonce,
  marquerAnnoncesDisparues,
  getStats,
} = require("./firebase");
const { calculerScore } = require("./scoring");
const config = require("./config");

const stats = {
  nouvelles: 0,
  miseAJour: 0,
  baissesPrix: 0,
  republications: 0,
  errors: 0,
};

async function traiterAnnonce(annonce) {
  try {
    const existant = await getAnnonceParFingerprint(annonce.fingerprint);

    if (!existant) {
      const scoring = calculerScore({
        firstSeenAt: new Date().toISOString(),
        historiquePrix: [],
        typeVendeur: annonce.typeVendeur,
        nbRepublications: 0,
        prixActuel: annonce.prix,
      });
      await creerAnnonce(annonce, scoring);
      stats.nouvelles++;
    } else {
      const ancienPrix = existant.prixActuel;
      if (annonce.prix && annonce.prix < ancienPrix) stats.baissesPrix++;

      const urlsVues = existant.urlsVues || [];
      if (annonce.url && !urlsVues.includes(annonce.url)) stats.republications++;

      const historiqueComplet = existant.historiquePrix || [];
      if (annonce.prix && annonce.prix !== ancienPrix) {
        historiqueComplet.push({ prix: annonce.prix, date: new Date().toISOString() });
      }

      const scoring = calculerScore({
        firstSeenAt: existant.firstSeenAt,
        historiquePrix: historiqueComplet,
        typeVendeur: existant.typeVendeur || annonce.typeVendeur,
        nbRepublications: existant.nbRepublications || 0,
        prixActuel: annonce.prix || ancienPrix,
      });

      await mettreAJourAnnonce(existant.id, existant, annonce, scoring);
      stats.miseAJour++;
    }
  } catch (e) {
    console.error("Erreur traitement annonce:", annonce.titre, e.message);
    stats.errors++;
  }
}

async function run() {
  const debutRun = Date.now();
  const zone = config.zoneActive;

  console.log("=== MandatScrap - Pige Longue Duree ===");
  console.log("Date:", new Date().toLocaleString("fr-FR"));
  console.log("Zone:", config.zones[zone].label);
  console.log("========================================");

  initFirebase();

  console.log("Lancement des 3 scrapers...");
  let annonces = [];

  try {
    const lbc = await scraperLeBonCoin(zone);
    annonces.push(...lbc);
    console.log("LeBonCoin:", lbc.length, "annonces");
  } catch(e) {
    console.error("LeBonCoin echoue:", e.message);
  }

  try {
    const pap = await scraperPAP(zone);
    annonces.push(...pap);
    console.log("PAP.fr:", pap.length, "annonces");
  } catch(e) {
    console.error("PAP.fr echoue:", e.message);
  }

  try {
    const ava = await scraperAVA(zone);
    annonces.push(...ava);
    console.log("AVendreALouer:", ava.length, "annonces");
  } catch(e) {
    console.error("AVendreALouer echoue:", e.message);
  }

  console.log("Total toutes sources:", annonces.length, "annonces");

  console.log("Traitement de", annonces.length, "annonces...");
  for (const annonce of annonces) {
    await traiterAnnonce(annonce);
  }

  console.log("Verification des annonces disparues...");
  const nbDisparues = await marquerAnnoncesDisparues(zone);

  const duree = Math.round((Date.now() - debutRun) / 1000);
  const statsGlobales = await getStats(zone);

  console.log("========================================");
  console.log("RESUME DU RUN");
  console.log("========================================");
  console.log("Duree:", duree + "s");
  console.log("Nouvelles annonces:", stats.nouvelles);
  console.log("Mises a jour:", stats.miseAJour);
  console.log("Baisses de prix:", stats.baissesPrix);
  console.log("Republications:", stats.republications);
  console.log("Annonces disparues:", nbDisparues);
  console.log("Erreurs:", stats.errors);
  console.log("Total en base:", statsGlobales.total);
  console.log("Actives:", statsGlobales.actives);
  console.log("Chaudes:", statsGlobales.chaudes);
  console.log("========================================");
}

run().catch(e => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
