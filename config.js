// scraper/config.js
// Configuration centrale — zones, seuils, paramètres

const config = {

  // ─── Zones géographiques à surveiller ────────────────────────────────────
  // Codes postaux ou villes cibles pour LF Immo Alsace
  zones: {
    alsace: {
      label: "Alsace",
      codesPostaux: ["67000", "67100", "67200", "67300", "67400", "67500",
                     "67600", "67700", "67800", "67410", "67160", "67120",
                     "68000", "68100", "68200", "68300"],
      // Pour LeBonCoin : paramètre de localisation dans l'URL
      lbcLocation: "Bas-Rhin__67",
      lat: 48.5734,
      lng: 7.7521,
      radius: 80000,
      regions: ["13"],
      papLocation: "alsace",
    }
  },

  // Zone active pour ce run
  zoneActive: "alsace",

  // ─── Seuils de scoring ────────────────────────────────────────────────────
  scoring: {
    seuilChaud: 70,   // Score >= 70 → bien CHAUD, alerte immédiate agent
    seuilTiede: 45,   // Score >= 45 → bien TIÈDE
    // En dessous de 45 → FROID, pas d'alerte
  },

  // ─── Seuil ancienneté pour alerter les agents ────────────────────────────
  ancienneteAlerte: 8, // mois — en dessous, pas d'alerte même si score élevé

  // ─── Fréquence (indicatif, géré par GitHub Actions cron) ─────────────────
  frequenceHeures: 6,

  // ─── Types de biens à surveiller ─────────────────────────────────────────
  typesBiens: ["vente maison", "vente appartement"],

  // ─── User agents pour rotation anti-détection ────────────────────────────
  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  ],

  // ─── Délais entre requêtes (ms) — pour ne pas surcharger les serveurs ────
  delaiEntrePages: { min: 3000, max: 7000 },
  delaiEntreAnnonces: { min: 1000, max: 3000 },

  // ─── Nombre maximum de pages à scraper par run ───────────────────────────
  maxPages: 10, // ~250 annonces par run — ajuster selon le volume réel

};

module.exports = config;
