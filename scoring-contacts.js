// scripts/scoring-contacts.js
// Calcule le score de priorité de relance pour chaque contact
// Score 0-100 — plus c'est élevé, plus c'est urgent de relancer

/**
 * Nombre de jours depuis une date ISO
 */
function joursDepuis(dateISO) {
  if (!dateISO) return 9999;
  return Math.floor((Date.now() - new Date(dateISO)) / 86400000);
}

/**
 * Score lié au temps sans contact (max 40 pts)
 *
 * < 15 jours   →  0  (trop récent)
 * 15-30 jours  →  8  (commence à tiédir)
 * 1-2 mois     → 16  (tiède)
 * 2-3 mois     → 25  (à relancer)
 * 3-6 mois     → 33  (chaud)
 * 6+ mois      → 40  (critique — contact dormant)
 */
function scoreAnciennete(dateDernierContact) {
  const j = joursDepuis(dateDernierContact);
  if (j < 15)  return 0;
  if (j < 30)  return 8;
  if (j < 60)  return 16;
  if (j < 90)  return 25;
  if (j < 180) return 33;
  return 40;
}

/**
 * Score lié au type de prospect (max 25 pts)
 *
 * Vendeur seul           → 25 (priorité absolue — CA direct)
 * Vendeur + acheteur     → 22 (double potentiel)
 * Acheteur qualifié      → 15 (peut mener à un vendeur)
 * Acheteur non qualifié  →  5
 * Inconnu                →  8
 */
function scoreType(type) {
  const scores = {
    vendeur: 25,
    vendeur_acheteur: 22,
    les_deux: 22,
    acquereur_qualifie: 15,
    acquereur: 10,
    acheteur: 10,
    inconnu: 8,
  };
  return scores[type?.toLowerCase()] ?? 8;
}

/**
 * Score lié aux notes libres de l'agent (max 20 pts)
 * Détecte les mots-clés signalant une intention forte
 *
 * Mots urgents : "vendre", "vente", "projet", "urgent", "divorce",
 *               "succession", "déménage", "mutation", "héritage"
 * Mots modérés : "peut-être", "envisage", "réfléchit", "dans X mois"
 */
function scoreNotes(notes) {
  if (!notes || notes.trim().length === 0) return 0;

  const texte = notes.toLowerCase();

  const motsUrgents = [
    "vendre", "vente", "vend", "urgent", "divorce", "succession",
    "mutation", "déménage", "demenage", "héritage", "heritage",
    "oblig", "contraint", "séparation", "separation", "retraite",
    "liquidat", "dettes", "besoin de vendre",
  ];

  const motsMoyens = [
    "projet", "envisage", "réfléchit", "reflechit", "peut-être",
    "dans quelques mois", "bientôt", "prochainement", "intéressé",
    "interesse", "rappeler", "à relancer", "relancer",
  ];

  let pts = 0;

  if (motsUrgents.some(m => texte.includes(m))) pts += 20;
  else if (motsMoyens.some(m => texte.includes(m))) pts += 10;
  else if (texte.length > 20) pts += 3; // Note présente mais neutre

  return Math.min(pts, 20);
}

/**
 * Score lié au nombre d'échanges passés (max 10 pts)
 * Un contact qu'on a déjà appelé plusieurs fois est plus chaud
 *
 * 0 échange    → 0
 * 1 échange    → 3
 * 2-3 échanges → 6
 * 4+ échanges  → 10
 */
function scoreHistorique(nbEchanges) {
  if (!nbEchanges || nbEchanges === 0) return 0;
  if (nbEchanges === 1) return 3;
  if (nbEchanges <= 3)  return 6;
  return 10;
}

/**
 * Score lié à l'ancienneté de la relation (max 5 pts)
 * Un contact rencontré il y a longtemps + pas relancé = opportunité
 *
 * < 1 mois     → 0
 * 1-6 mois     → 2
 * 6-12 mois    → 4
 * 1 an+        → 5 (contact vieillissant — maintenant ou jamais)
 */
function scoreAncienneteRelation(datePremierContact) {
  const j = joursDepuis(datePremierContact);
  if (j < 30)  return 0;
  if (j < 180) return 2;
  if (j < 365) return 4;
  return 5;
}

/**
 * Calcule le score final et la chaleur du contact
 *
 * @param {Object} contact — données du contact depuis Firebase
 * @returns {Object} — { score, chaleur, detail, priorite }
 */
function calculerScoreContact(contact) {
  const {
    dateDernierContact,
    datePremierContact,
    type,
    notes,
    nbEchanges,
    statut,
  } = contact;

  // Contacts avec statut terminal → score 0
  if (["mandat_signe", "vendu", "perdu_definitif", "ne_pas_rappeler"].includes(statut)) {
    return { score: 0, chaleur: "inactif", detail: {}, priorite: 999 };
  }

  const detail = {
    anciennete:         scoreAnciennete(dateDernierContact),
    type:               scoreType(type),
    notes:              scoreNotes(notes),
    historique:         scoreHistorique(nbEchanges),
    ancienneteRelation: scoreAncienneteRelation(datePremierContact),
  };

  const score = Math.min(
    Object.values(detail).reduce((a, b) => a + b, 0),
    100
  );

  // Chaleur
  let chaleur;
  if (score >= 70)      chaleur = "chaud";
  else if (score >= 45) chaleur = "tiede";
  else if (score >= 20) chaleur = "froid";
  else                  chaleur = "inactif";

  // Priorité pour le tri (plus petit = plus urgent)
  const priorite = 100 - score;

  return {
    score,
    chaleur,
    detail,
    priorite,
    joursDepuisContact: joursDepuis(dateDernierContact),
    calculeLe: new Date().toISOString(),
  };
}

module.exports = { calculerScoreContact, joursDepuis };
