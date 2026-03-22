// distribution/scoring-agents.js
// Calcule le score d'appétence de chaque agent pour recevoir une alerte
// Score 0-100 — plus c'est élevé, plus l'agent mérite l'alerte

/**
 * SCORE D'APPÉTENCE = 4 critères pondérés
 *
 *  1. Réactivité (35 pts) — a-t-il agi sur ses dernières alertes ?
 *  2. Disponibilité (30 pts) — combien d'alertes actives non traitées ?
 *  3. Proximité (25 pts) — est-il proche géographiquement du bien ?
 *  4. Ancienneté réseau (10 pts) — agent senior = priorité légère
 */

// ─── Critère 1 — Réactivité (max 35 pts) ─────────────────────────────────────
// Basé sur les 10 dernières alertes reçues par l'agent
// Taux = alertes traitées (contacté/rdv/mandat) / alertes reçues
//
// 0%   traitement →  0 pts (agent fantôme)
// 25%              →  8 pts
// 50%              → 18 pts
// 75%              → 27 pts
// 100%             → 35 pts (agent très réactif)
function scoreReactivite(historiqueAlertes) {
  if (!historiqueAlertes || historiqueAlertes.length === 0) {
    // Nouvel agent sans historique → score neutre 50% = 17 pts
    // On lui donne sa chance
    return 17;
  }

  const dernieres = historiqueAlertes.slice(-10);
  const traitees  = dernieres.filter(a =>
    ["contacte", "rdv", "mandat"].includes(a.statut)
  ).length;

  const taux = traitees / dernieres.length;
  return Math.round(taux * 35);
}

// ─── Critère 2 — Disponibilité (max 30 pts) ──────────────────────────────────
// Combien d'alertes actives non traitées a-t-il aujourd'hui ?
// Max 3 alertes/jour → au-delà, score 0 et agent bloqué
//
// 0 alertes aujourd'hui → 30 pts (totalement disponible)
// 1 alerte              → 20 pts
// 2 alertes             → 8 pts
// 3 alertes             →  0 pts + BLOQUÉ pour aujourd'hui
function scoreDisponibilite(alertesAujourdhui) {
  const n = alertesAujourdhui || 0;
  if (n >= 3) return 0;  // Bloqué
  if (n === 2) return 8;
  if (n === 1) return 20;
  return 30;
}

function estBloque(alertesAujourdhui) {
  return (alertesAujourdhui || 0) >= 3;
}

// ─── Critère 3 — Proximité géographique (max 25 pts) ─────────────────────────
// Compare le code postal du bien avec les zones déclarées de l'agent
// ET avec son code postal de résidence (plus fin)
//
// CP exact dans ses zones           → 25 pts
// Même département (2 premiers)     → 15 pts
// Zone déclarée mais pas CP exact   → 10 pts
// Hors zone mais département pareil →  5 pts
// Hors département                  →  0 pts
function scoreProximite(cpBien, zonesAgent, cpResidenceAgent) {
  if (!cpBien) return 5; // Pas d'info → score neutre bas

  const deptBien = cpBien.slice(0, 2);

  // CP exact dans ses zones déclarées
  if (zonesAgent?.includes(cpBien)) return 25;

  // CP de résidence de l'agent = même département que le bien
  if (cpResidenceAgent?.slice(0, 2) === deptBien) return 20;

  // Une de ses zones est dans le même département
  const zoneMemeDept = zonesAgent?.some(z => z.slice(0, 2) === deptBien);
  if (zoneMemeDept) return 15;

  // Même département mais rien de précis
  if (deptBien === "67" || deptBien === "68") return 5; // Alsace = toujours un peu pertinent

  return 0;
}

// ─── Critère 4 — Ancienneté réseau (max 10 pts) ──────────────────────────────
// Agent senior = légère priorité sur un nouveau (expérience de conversion)
// < 1 mois  →  2 pts (nouvel agent)
// 1-6 mois  →  5 pts
// 6-12 mois →  8 pts
// 1 an+     → 10 pts
function scoreAnciennete(dateInscription) {
  if (!dateInscription) return 2;
  const jours = Math.floor((Date.now() - new Date(dateInscription)) / 86400000);
  if (jours < 30)  return 2;
  if (jours < 180) return 5;
  if (jours < 365) return 8;
  return 10;
}

// ─── Score final ──────────────────────────────────────────────────────────────
/**
 * Calcule le score d'appétence complet d'un agent pour un bien donné
 *
 * @param {Object} agent   - Profil agent depuis Firestore
 * @param {Object} bien    - Annonce pige depuis Firestore
 * @param {Object} stats   - Stats du jour de l'agent (alertes reçues, historique)
 * @returns {Object}       - { score, detail, bloque, raison }
 */
function calculerAppetence(agent, bien, stats) {
  const alertesAujourdhui = stats?.alertesAujourdhui || 0;

  // Si l'agent est bloqué (3 alertes déjà envoyées aujourd'hui)
  if (estBloque(alertesAujourdhui)) {
    return {
      score: 0,
      bloque: true,
      raison: `Quota atteint (${alertesAujourdhui}/3 alertes aujourd'hui)`,
      detail: { reactivite: 0, disponibilite: 0, proximite: 0, anciennete: 0 },
    };
  }

  // Si l'agent est inactif
  if (agent.statut !== "actif") {
    return {
      score: 0,
      bloque: true,
      raison: "Compte inactif",
      detail: {},
    };
  }

  const detail = {
    reactivite:   scoreReactivite(stats?.historiqueAlertes),
    disponibilite: scoreDisponibilite(alertesAujourdhui),
    proximite:    scoreProximite(bien.codePostal, agent.zones, agent.codePostal),
    anciennete:   scoreAnciennete(agent.createdAt),
  };

  const score = Object.values(detail).reduce((a, b) => a + b, 0);

  return {
    score: Math.min(score, 100),
    bloque: false,
    raison: null,
    detail,
    alertesAujourdhui,
    agentId: agent.uid,
    agentNom: `${agent.prenom} ${agent.nom}`,
  };
}

module.exports = {
  calculerAppetence,
  estBloque,
  scoreReactivite,
  scoreDisponibilite,
  scoreProximite,
};
