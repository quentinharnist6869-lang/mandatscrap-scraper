// scraper/fingerprint.js
// Génère un identifiant unique par bien immobilier
// Permet de reconnaître le même bien même s'il est republié sous une nouvelle URL

const crypto = require("crypto");

/**
 * Normalise une chaîne pour le fingerprint
 * Ex: "  67 500  " → "67500"
 */
function normaliser(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Normalise un prix
 * Ex: "289 000 €" → "289000"
 */
function normaliserPrix(prix) {
  if (!prix) return "";
  return String(prix).replace(/[^0-9]/g, "");
}

/**
 * Normalise une surface
 * Ex: "95 m²" → "95"
 */
function normaliserSurface(surface) {
  if (!surface) return "";
  const n = String(surface).replace(/[^0-9]/g, "");
  // Arrondi à la dizaine la plus proche pour absorber les légères variations
  // Ex: 94m² et 95m² = même bien probable → arrondi à 90
  return String(Math.round(parseInt(n) / 10) * 10);
}

/**
 * Normalise le nombre de pièces
 * Ex: "4 pièces" → "4"
 */
function normaliserPieces(pieces) {
  if (!pieces) return "";
  return String(pieces).replace(/[^0-9]/g, "").slice(0, 1);
}

/**
 * Normalise le code postal
 * Ex: "67 500" → "67500"
 */
function normaliserCP(cp) {
  if (!cp) return "";
  return String(cp).replace(/[^0-9]/g, "").slice(0, 5);
}

/**
 * Génère le fingerprint unique d'une annonce
 * 
 * IMPORTANT : On N'inclut PAS le prix dans le hash
 * car il change lors des baisses — on veut reconnaître le bien malgré ça
 * 
 * @param {Object} annonce - Les données de l'annonce
 * @returns {string} - Hash MD5 de 32 caractères
 */
function genererFingerprint(annonce) {
  const {
    surface,
    nbPieces,
    codePostal,
    typebien,
    // On n'utilise PAS : prix, titre, url, description
  } = annonce;

  // Composantes du fingerprint
  const composantes = [
    normaliserSurface(surface),
    normaliserPieces(nbPieces),
    normaliserCP(codePostal),
    normaliser(typebian || typewell || ""),
  ].join("|");

  // Si les données sont trop incomplètes, on ne peut pas faire un bon fingerprint
  if (!normaliserSurface(surface) && !normaliserCP(codePostal)) {
    // Fallback : on utilise un bout de l'URL comme fingerprint partiel
    return null;
  }

  return crypto.createHash("md5").update(composantes).digest("hex");
}

/**
 * Génère un fingerprint enrichi avec plus de données
 * Utilisé quand on a scrapt la page détail de l'annonce
 */
function genererFingerprintEnrichi(annonce) {
  const {
    surface,
    nbPieces,
    codePostal,
    typesBien,
    ville,
    // On peut ajouter l'étage, le DPE, etc. si disponible
  } = annonce;

  const composantes = [
    normaliserSurface(surface),
    normaliserPieces(nbPieces),
    normaliserCP(codePostal),
    normaliser(ville),
  ].join("|");

  return crypto.createHash("md5").update(composantes).digest("hex");
}

/**
 * Vérifie si deux annonces sont probablement le même bien
 * (double-check au-delà du fingerprint)
 */
function memebienprobable(annonce1, annonce2) {
  // Même fingerprint = même bien (quasi-certain)
  if (annonce1.fingerprint === annonce2.fingerprint) return true;

  // Vérification supplémentaire : même surface ±5%, même CP, même nb pièces
  const surf1 = parseInt(String(annonce1.surface).replace(/[^0-9]/g, ""));
  const surf2 = parseInt(String(annonce2.surface).replace(/[^0-9]/g, ""));
  const diffSurface = Math.abs(surf1 - surf2) / Math.max(surf1, surf2);

  if (
    diffSurface < 0.05 && // Surface similaire à 5% près
    normaliserCP(annonce1.codePostal) === normaliserCP(annonce2.codePostal) &&
    normaliserPieces(annonce1.nbPieces) === normaliserPieces(annonce2.nbPieces)
  ) {
    return true;
  }

  return false;
}

module.exports = {
  genererFingerprint,
  genererFingerprintEnrichi,
  memebienprobable,
  normaliserPrix,
};
