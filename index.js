// scraper/index.js
// Orchestrateur principal — lance le run complet de scraping
// Appelé par GitHub Actions toutes les 6 heures

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
  getAnnoncesAlerteAEnvoyer,
  marquerAlerteEnvoyee,
  getStats,
} = require("./firebase");
const { calculerScore } = require("./scoring");
const config = require("./config");
const { distribuerAlertes } = require("../distribution/distributeur");

// ─── Stats du run ─────────────────────────────────────────────────────────────
const stats = {
  nouvelles: 0,
  miseAJour: 0,
  baissesPrix: 0,
  republications: 0,
  alertesEnvoyees: 0,
  erreurs: 0,
};

// ─── Traitement d'une annonce ─────────────────────────────────────────────────

/**
 * Traite une annonce : crée ou met à jour dans Firebase
 */
async function traiterAnnonce(annonce) {
  try {
    // Chercher si ce bien existe déjà
    const existant = await getAnnonceParFingerprint(annonce.fingerprint);

    if (!existant) {
      // ── Nouvelle annonce ──────────────────────────────────────────────
      // Calculer le score initial (ancienneté = 0, pas de baisses)
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
      // ── Annonce existante — mettre à jour ─────────────────────────────
      // Détecter baisse de prix
      const ancienPrix = existant.prixActuel;
      if (annonce.prix && annonce.prix < ancienPrix) {
        stats.baissesPrix++;
      }

      // Détecter republication (nouvelle URL pour le même fingerprint)
      const urlsVues = existant.urlsVues || [];
      if (annonce.url && !urlsVues.includes(annonce.url)) {
        stats.republications++;
      }

      // Recalculer le score avec toutes les données à jour
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
    console.error(`❌ Erreur traitement annonce ${annonce.titre} : ${e.message}`);
    stats.erreurs++;
  }
}

// ─── Envoi des alertes Brevo ──────────────────────────────────────────────────

/**
 * Envoie les alertes email pour les nouveaux biens chauds
 * via l'API Brevo transactionnelle
 */
async function envoyerAlertes(zone) {
  const annoncesAlerter = await getAnnoncesAlerteAEnvoyer(
    zone,
    config.ancienneteAlerte
  );

  if (annoncesAlerter.length === 0) {
    console.log("ℹ️ Aucune nouvelle alerte à envoyer");
    return;
  }

  console.log(`\n📧 ${annoncesAlerter.length} alerte(s) à envoyer...`);

  for (const annonce of annoncesAlerter) {
    try {
      // Appel API Brevo pour envoyer l'email d'alerte
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": process.env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: {
            name: "LF Immo — Pige Intelligente",
            email: process.env.BREVO_SENDER_EMAIL || "pige@lafede.immo",
          },
          // Envoyer à tous les agents de la zone
          // En V2 : filtrer par zone agent
          to: [{ email: process.env.ADMIN_EMAIL || "quentin@lafede.immo" }],
          subject: `🔥 Nouveau bien récupérable — ${annonce.ville} (Score ${annonce.score}/100)`,
          htmlContent: genererEmailAlerte(annonce),
        }),
      });

      if (response.ok) {
        await marquerAlerteEnvoyee(annonce.id);
        stats.alertesEnvoyees++;
        console.log(`  ✅ Alerte envoyée pour ${annonce.titre} — ${annonce.ville}`);
      } else {
        console.error(`  ❌ Erreur envoi alerte : ${response.status}`);
      }

    } catch (e) {
      console.error(`  ❌ Erreur alerte ${annonce.titre} : ${e.message}`);
    }
  }
}

/**
 * Génère le HTML de l'email d'alerte
 */
function genererEmailAlerte(annonce) {
  const anciennete = annonce.ancienneteMois;
  const baisses = annonce.historiquePrix?.filter(h => h.baisse)?.length || 0;
  const prixInitial = annonce.prixInitial?.toLocaleString("fr-FR") || "?";
  const prixActuel = annonce.prixActuel?.toLocaleString("fr-FR") || "?";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #CC3333; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">🔥 Bien récupérable détecté</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">Score de récupérabilité : ${annonce.score}/100</p>
      </div>
      <div style="background: #fff; border: 1px solid #eee; padding: 20px; border-radius: 0 0 8px 8px;">
        <h3 style="color: #333; margin-top: 0;">${annonce.titre}</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #666;">Localisation</td><td style="padding: 6px 0; font-weight: bold;">${annonce.ville} (${annonce.codePostal})</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">En vente depuis</td><td style="padding: 6px 0; font-weight: bold; color: #CC3333;">${anciennete} mois</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Prix actuel</td><td style="padding: 6px 0; font-weight: bold;">${prixActuel} €</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Prix initial</td><td style="padding: 6px 0; text-decoration: line-through; color: #999;">${prixInitial} €</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Baisses de prix</td><td style="padding: 6px 0; color: ${baisses > 0 ? '#CC3333' : '#666'}">${baisses} baisse(s)</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Type vendeur</td><td style="padding: 6px 0;">${annonce.typeVendeur}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Source</td><td style="padding: 6px 0;">${annonce.source}</td></tr>
        </table>
        <div style="margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 6px; font-style: italic; font-size: 14px;">
          "${annonce.description?.slice(0, 200) || 'Pas de description disponible'}..."
        </div>
        <div style="margin-top: 16px; text-align: center;">
          <a href="${annonce.urlOrigine}" style="background: #CC3333; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            Voir l'annonce originale →
          </a>
        </div>
        <p style="margin-top: 16px; font-size: 12px; color: #999; text-align: center;">
          LF Immo — Pige Intelligente · Généré automatiquement le ${new Date().toLocaleDateString("fr-FR")}
        </p>
      </div>
    </div>
  `;
}

// ─── Run principal ────────────────────────────────────────────────────────────

async function run() {
  const debutRun = Date.now();
  const zone = config.zoneActive;

  console.log("═══════════════════════════════════════════════");
  console.log(`🏠 LF Immo — Pige Longue Durée`);
  console.log(`📅 ${new Date().toLocaleString("fr-FR")}`);
  console.log(`🗺️  Zone : ${config.zones[zone].label}`);
  console.log("═══════════════════════════════════════════════\n");

  // Initialiser Firebase
  initFirebase();

  // ── 1. Scraper 3 sources — une erreur n'arrête pas les autres ─────────────
  console.log('🚀 Lancement des 3 scrapers...
');
  let annonces = [];

  try {
    const lbc = await scraperLeBonCoin(zone);
    annonces.push(...lbc);
    console.log(`  ✅ LeBonCoin : ${lbc.length} annonces`);
  } catch(e) {
    console.error(`  ❌ LeBonCoin échoué : ${e.message}`);
  }

  try {
    const pap = await scraperPAP(zone);
    annonces.push(...pap);
    console.log(`  ✅ PAP.fr : ${pap.length} annonces`);
  } catch(e) {
    console.error(`  ❌ PAP.fr échoué : ${e.message}`);
  }

  try {
    const ava = await scraperAVA(zone);
    annonces.push(...ava);
    console.log(`  ✅ AVendreALouer : ${ava.length} annonces`);
  } catch(e) {
    console.error(`  ❌ AVendreALouer échoué : ${e.message}`);
  }

  console.log(`
📦 Total toutes sources : ${annonces.length} annonces
`);

  // ── 2. Traiter chaque annonce (créer ou mettre à jour) ───────────────────
  console.log(`\n⚙️  Traitement de ${annonces.length} annonces...`);
  for (const annonce of annonces) {
    await traiterAnnonce(annonce);
  }

  // ── 3. Marquer les annonces disparues ────────────────────────────────────
  console.log("\n🔍 Vérification des annonces disparues...");
  const nbDisparues = await marquerAnnoncesDisparues(zone);

  // ── 4. Distribution intelligente des alertes ────────────────────────────
  if (process.env.BREVO_API_KEY) {
    await distribuerAlertes({ seuilScore: 70, seuilMois: 8 });
  } else {
    console.log("ℹ️ BREVO_API_KEY non configurée — distribution désactivée");
  }

  // ── 5. Afficher le résumé du run ─────────────────────────────────────────
  const duree = Math.round((Date.now() - debutRun) / 1000);
  const statsGlobales = await getStats(zone);

  console.log("\n═══════════════════════════════════════════════");
  console.log("📊 RÉSUMÉ DU RUN");
  console.log("═══════════════════════════════════════════════");
  console.log(`⏱️  Durée : ${duree}s`);
  console.log(`✨  Nouvelles annonces : ${stats.nouvelles}`);
  console.log(`🔄  Mises à jour : ${stats.miseAJour}`);
  console.log(`📉  Baisses de prix détectées : ${stats.baissesPrix}`);
  console.log(`🔁  Republications détectées : ${stats.republications}`);
  console.log(`🔴  Annonces disparues : ${nbDisparues}`);
  console.log(`📧  Alertes envoyées : ${stats.alertesEnvoyees}`);
  console.log(`❌  Erreurs : ${stats.erreurs}`);
  console.log("───────────────────────────────────────────────");
  console.log(`📦  Total en base : ${statsGlobales.total}`);
  console.log(`✅  Actives : ${statsGlobales.actives}`);
  console.log(`🔥  Chaudes : ${statsGlobales.chaudes}`);
  console.log(`🟡  Tièdes : ${statsGlobales.tièdes}`);
  console.log("═══════════════════════════════════════════════\n");
}

// Lancer le run
run().catch(e => {
  console.error("💥 Erreur fatale :", e);
  process.exit(1);
});
