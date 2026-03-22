// scraper/scoring.js
// Calcule le score de récupérabilité d'un bien (0-100)
// Plus le score est élevé, plus le vendeur est susceptible d'accepter un RDV

/**
 * Calcule l'ancienneté réelle en jours depuis firstSeenAt
 */
function ancienneteJours(firstSeenAt) {
  const debut = new Date(firstSeenAt);
  const maintenant = new Date();
  return Math.floor((maintenant - debut) / (1000 * 60 * 60 * 24));
}

/**
 * Calcule les points liés à l'ancienneté (max 35 pts)
 * 
 * 0-3 mois   → 0 pts  (trop tôt, le vendeur n'est pas encore fatigué)
 * 3-6 mois   → 10 pts (commence à s'impatienter)
 * 6-9 mois   → 20 pts (clairement en difficulté)
 * 9-12 mois  → 30 pts (très récupérable)
 * 12+ mois   → 35 pts (score maximum, vendeur probablement désespéré)
 */
function scoreAnciennete(firstSeenAt) {
  const jours = ancienneteJours(firstSeenAt);
  const mois = jours / 30;

  if (mois < 3)  return 0;
  if (mois < 6)  return 10;
  if (mois < 9)  return 20;
  if (mois < 12) return 30;
  return 35;
}

/**
 * Calcule les points liés aux baisses de prix (max 25 pts)
 * 
 * 0 baisse  → 0 pts
 * 1 baisse  → 10 pts
 * 2 baisses → 20 pts
 * 3+ baisses → 25 pts (vendeur très motivé à vendre)
 */
function scoreBaissesPrix(historiquePrix) {
  if (!historiquePrix || historiquePrix.length === 0) return 0;

  // Compter les vraies baisses (pas les hausses)
  let nbBaisses = 0;
  for (let i = 1; i < historiquePrix.length; i++) {
    if (historiquePrix[i].prix < historiquePrix[i - 1].prix) {
      nbBaisses++;
    }
  }

  if (nbBaisses === 0) return 0;
  if (nbBaisses === 1) return 10;
  if (nbBaisses === 2) return 20;
  return 25;
}

/**
 * Calcule les points liés au type de vendeur (max 20 pts)
 * 
 * Particulier          → 20 pts (pas d'agence, contact direct, plus réceptif)
 * Agence indépendante  → 12 pts (petit réseau, plus flexible)
 * Mandat simple agence → 8 pts  (vendeur peut changer)
 * Mandat exclusif      → 3 pts  (contrat en cours, difficile à récupérer)
 */
function scoreTypeVendeur(typeVendeur) {
  const types = {
    "particulier": 20,
    "agence_independante": 12,
    "mandat_simple": 8,
    "mandat_exclusif": 3,
    "inconnu": 5, // Valeur par défaut si on ne sait pas
  };
  return types[typeVendeur] || types["inconnu"];
}

/**
 * Calcule les points liés aux republications (max 10 pts)
 * Une republication = l'agence/particulier a remis l'annonce au top
 * pour masquer l'ancienneté réelle → signal de difficulté
 * 
 * 0 répub  → 0 pts
 * 1 répub  → 3 pts
 * 2 répubs → 7 pts
 * 3+ répubs → 10 pts
 */
function scoreRepublications(nbRepublications) {
  if (!nbRepublications || nbRepublications === 0) return 0;
  if (nbRepublications === 1) return 3;
  if (nbRepublications === 2) return 7;
  return 10;
}

/**
 * Calcule les points liés à la surévaluation du prix (max 10 pts)
 * Nécessite le prix médian du marché local (dispo en V2 avec DVF)
 * 
 * Dans les prix du marché (±5%)    → 0 pts
 * 5-10% au-dessus du marché        → 5 pts
 * 10-20% au-dessus du marché       → 8 pts
 * 20%+ au-dessus du marché         → 10 pts
 */
function scoreSurevaluation(prixActuel, prixMedianMarche) {
  // Si on n'a pas le prix médian du marché (V2), on retourne 0
  if (!prixMedianMarche || !prixActuel) return 0;

  const ecart = (prixActuel - prixMedianMarche) / prixMedianMarche;

  if (ecart < 0.05)  return 0;  // Dans les prix
  if (ecart < 0.10)  return 5;  // Légèrement au-dessus
  if (ecart < 0.20)  return 8;  // Clairement surévalué
  return 10;                     // Très surévalué
}

/**
 * Calcule le score final de récupérabilité (0-100)
 * 
 * @param {Object} bien - Les données du bien depuis Firebase
 * @returns {Object} - { score, chaleur, detail }
 */
function calculerScore(bien) {
  const {
    firstSeenAt,
    historiquePrix,
    typeVendeur,
    nbRepublications,
    prixActuel,
    prixMedianMarche, // null en V1, rempli en V2
  } = bien;

  // Calcul de chaque composante
  const points = {
    anciennete: scoreAnciennete(firstSeenAt),
    baissesPrix: scoreBaissesPrix(historiquePrix),
    typeVendeur: scoreTypeVendeur(typeVendeur),
    republications: scoreRepublications(nbRepublications),
    surevaluation: scoreSurevaluation(prixActuel, prixMedianMarche),
  };

  // Score total
  const scoreTotal = Object.values(points).reduce((a, b) => a + b, 0);

  // Chaleur
  let chaleur;
  if (scoreTotal >= 70) chaleur = "chaud";
  else if (scoreTotal >= 45) chaleur = "tiede";
  else chaleur = "froid";

  // Ancienneté en mois pour l'affichage
  const anciennete = Math.floor(ancienneteJours(firstSeenAt) / 30);

  return {
    score: Math.min(scoreTotal, 100),
    chaleur,
    ancienneteJours: ancienneteJours(firstSeenAt),
    ancienneteMois: anciennete,
    detail: points, // Pour debug et affichage dans le dashboard
    calculeLe: new Date().toISOString(),
  };
}

module.exports = {
  calculerScore,
  ancienneteJours,
};
