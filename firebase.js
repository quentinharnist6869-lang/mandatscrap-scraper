// scraper/firebase.js
// Toutes les opérations Firebase Firestore pour les annonces

const admin = require("firebase-admin");

// ─── Initialisation Firebase ──────────────────────────────────────────────────
// Les credentials viennent des variables d'environnement (GitHub Actions Secrets)
let db;

function initFirebase() {
  if (admin.apps.length > 0) return; // Déjà initialisé

  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  db = admin.firestore();
  console.log("✅ Firebase initialisé");
}

function getDb() {
  if (!db) initFirebase();
  return db;
}

// ─── Lecture ──────────────────────────────────────────────────────────────────

/**
 * Récupère une annonce existante par fingerprint
 * Retourne null si elle n'existe pas encore
 */
async function getAnnonceParFingerprint(fingerprint) {
  const db = getDb();
  const snap = await db
    .collection("annonces")
    .where("fingerprint", "==", fingerprint)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Récupère toutes les annonces actives d'une zone
 */
async function getAnnoncesActives(zone) {
  const db = getDb();
  const snap = await db
    .collection("annonces")
    .where("zone", "==", zone)
    .where("statut", "==", "active")
    .get();

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Écriture ─────────────────────────────────────────────────────────────────

/**
 * Crée une nouvelle annonce dans Firebase
 * Appelé uniquement quand le fingerprint est inconnu = première détection
 */
async function creerAnnonce(annonce, scoring) {
  const db = getDb();
  const now = new Date().toISOString();

  const doc = {
    // Identification
    fingerprint: annonce.fingerprint,
    source: annonce.source, // "leboncoin" | "pap" | "avendrealouer"
    urlOrigine: annonce.url,
    zone: annonce.zone,

    // Données du bien
    titre: annonce.titre,
    typebienvente: annonce.typeBien,
    surface: annonce.surface,
    nbPieces: annonce.nbPieces,
    ville: annonce.ville,
    codePostal: annonce.codePostal,
    typeVendeur: annonce.typeVendeur, // "particulier" | "agence_independante" | etc.
    nomVendeur: annonce.nomVendeur || null,
    description: annonce.description || null,

    // Prix
    prixActuel: annonce.prix,
    prixInitial: annonce.prix, // Figé à la première détection
    historiquePrix: [{ prix: annonce.prix, date: now }],

    // Dates clés — firstSeenAt est IMMUABLE
    firstSeenAt: now,
    lastSeenAt: now,
    lastScrapedAt: now,

    // Détection des republications
    nbRepublications: 0,
    urlsVues: [annonce.url], // Toutes les URLs sous lesquelles ce bien a été vu

    // Scoring
    score: scoring.score,
    chaleur: scoring.chaleur,
    scoringDetail: scoring.detail,
    scoringCalculeLe: scoring.calculeLe,
    ancienneteMois: scoring.ancienneteMois,

    // Workflow agent
    statut: "active", // "active" | "disparue" | "vendue"
    agentStatut: null, // "contacte" | "rdv" | "mandat" | "pas_interesse"
    agentId: null,
    alerteEnvoyee: false,

    // Meta
    createdAt: now,
    updatedAt: now,
  };

  const ref = await db.collection("annonces").add(doc);
  console.log(`✅ Nouvelle annonce créée : ${annonce.titre} (${annonce.ville}) — Score: ${scoring.score}`);
  return ref.id;
}

/**
 * Met à jour une annonce existante
 * Gère : baisse de prix, republication, mise à jour du score
 */
async function mettreAJourAnnonce(id, annonceExistante, nouvelleData, scoring) {
  const db = getDb();
  const now = new Date().toISOString();

  const updates = {
    lastSeenAt: now,
    lastScrapedAt: now,
    score: scoring.score,
    chaleur: scoring.chaleur,
    scoringDetail: scoring.detail,
    scoringCalculeLe: scoring.calculeLe,
    ancienneteMois: scoring.ancienneteMois,
    updatedAt: now,
  };

  // ── Détection baisse de prix ────────────────────────────────────────────
  const prixActuel = annonceExistante.prixActuel;
  const nouveauPrix = nouvelleData.prix;

  if (nouveauPrix && nouveauPrix !== prixActuel) {
    updates.prixActuel = nouveauPrix;
    updates.historiquePrix = admin.firestore.FieldValue.arrayUnion({
      prix: nouveauPrix,
      prixPrecedent: prixActuel,
      date: now,
      baisse: nouveauPrix < prixActuel,
      montantBaisse: prixActuel - nouveauPrix,
    });

    if (nouveauPrix < prixActuel) {
      const montant = prixActuel - nouveauPrix;
      const pct = Math.round((montant / prixActuel) * 100);
      console.log(`📉 Baisse de prix détectée : ${annonceExistante.titre} — -${montant.toLocaleString()}€ (-${pct}%)`);
    }
  }

  // ── Détection republication ─────────────────────────────────────────────
  const urlsVues = annonceExistante.urlsVues || [];
  if (nouvelleData.url && !urlsVues.includes(nouvelleData.url)) {
    updates.nbRepublications = (annonceExistante.nbRepublications || 0) + 1;
    updates.urlsVues = admin.firestore.FieldValue.arrayUnion(nouvelleData.url);
    updates.urlOrigine = nouvelleData.url; // On garde la dernière URL active
    console.log(`🔄 Republication détectée : ${annonceExistante.titre} (${updates.nbRepublications}x)`);
  }

  await db.collection("annonces").doc(id).update(updates);
}

/**
 * Marque les annonces non vues depuis 2 jours comme "disparues"
 * Elles ont probablement été retirées (vendu, loué, abandonnées)
 */
async function marquerAnnoncesDisparues(zone) {
  const db = getDb();
  const seuilDisparition = new Date();
  seuilDisparition.setDate(seuilDisparition.getDate() - 2); // 2 jours sans scraping = disparue

  const snap = await db
    .collection("annonces")
    .where("zone", "==", zone)
    .where("statut", "==", "active")
    .where("lastScrapedAt", "<", seuilDisparition.toISOString())
    .get();

  const batch = db.batch();
  let count = 0;

  snap.docs.forEach(doc => {
    batch.update(doc.ref, {
      statut: "disparue",
      disparueAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    count++;
  });

  if (count > 0) {
    await batch.commit();
    console.log(`🔴 ${count} annonces marquées comme disparues`);
  }

  return count;
}

/**
 * Récupère les annonces chaudes pour lesquelles aucune alerte n'a encore été envoyée
 */
async function getAnnoncesAlerteAEnvoyer(zone, seuilMois = 8) {
  const db = getDb();
  const snap = await db
    .collection("annonces")
    .where("zone", "==", zone)
    .where("statut", "==", "active")
    .where("chaleur", "==", "chaud")
    .where("alerteEnvoyee", "==", false)
    .where("ancienneteMois", ">=", seuilMois)
    .get();

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Marque une alerte comme envoyée
 */
async function marquerAlerteEnvoyee(id) {
  const db = getDb();
  await db.collection("annonces").doc(id).update({
    alerteEnvoyee: true,
    alerteEnvoyeeAt: new Date().toISOString(),
  });
}

// ─── Stats & monitoring ───────────────────────────────────────────────────────

/**
 * Retourne les stats du dernier run pour monitoring
 */
async function getStats(zone) {
  const db = getDb();
  const snap = await db
    .collection("annonces")
    .where("zone", "==", zone)
    .get();

  const annonces = snap.docs.map(d => d.data());

  return {
    total: annonces.length,
    actives: annonces.filter(a => a.statut === "active").length,
    chaudes: annonces.filter(a => a.chaleur === "chaud" && a.statut === "active").length,
    tièdes: annonces.filter(a => a.chaleur === "tiede" && a.statut === "active").length,
    disparues: annonces.filter(a => a.statut === "disparue").length,
    avecBaisses: annonces.filter(a => a.historiquePrix?.length > 1).length,
  };
}

module.exports = {
  initFirebase,
  getAnnonceParFingerprint,
  getAnnoncesActives,
  creerAnnonce,
  mettreAJourAnnonce,
  marquerAnnoncesDisparues,
  getAnnoncesAlerteAEnvoyer,
  marquerAlerteEnvoyee,
  getStats,
};
