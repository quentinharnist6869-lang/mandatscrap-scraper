// ─── INTÉGRATION DANS scraper/index.js ────────────────────────────────────────
// Ajouter ces 3 lignes en haut du fichier :

const { distribuerAlertes } = require("../distribution/distributeur");

// Puis à la fin de la fonction run(), après marquerAnnoncesDisparues() :
// Remplacer le bloc "envoyerAlertes(zone)" existant par :

/*
  // ── 4. Distribution intelligente des alertes ────────────────────────────
  console.log("\n📡 Lancement de la distribution...");
  await distribuerAlertes({
    seuilScore: 70,   // Score minimum pour déclencher une alerte
    seuilMois:  8,    // Ancienneté minimum en mois
  });
*/

// ─── NOUVELLE STRUCTURE FIRESTORE REQUISE ─────────────────────────────────────

/*
Collection "alertes" — une entrée par alerte envoyée
{
  agentId:          "uid_agent",
  agentEmail:       "thomas@lafede.immo",
  agentNom:         "Thomas Dupont",
  bienId:           "id_annonce",
  bienTitre:        "Maison 5p Haguenau",
  bienVille:        "Haguenau",
  bienScore:        91,
  appetenceScore:   78,
  appetenceDetail:  { reactivite: 28, disponibilite: 20, proximite: 25, anciennete: 5 },
  statut:           "envoye",   // → agent peut mettre à jour via dashboard
  emailEnvoye:      true,
  envoyeeAt:        "2026-03-21T08:00:00Z",
  deduplicationKey: "uid_agent_id_annonce",
  updatedAt:        "..."
}

Collection "alertes_file" — biens en attente de distribution
{
  bienId:     "id_annonce",
  bienData:   { ...données complètes du bien },
  statut:     "en_attente" | "traite",
  tentatives: 1,
  createdAt:  "...",
  updatedAt:  "..."
}
*/

// ─── RÈGLE FIRESTORE À AJOUTER dans firestore.rules ──────────────────────────

/*
// Alertes — un agent peut lire ses propres alertes et mettre à jour le statut
match /alertes/{alerteId} {
  allow read: if estConnecte() && (
    estAdmin() ||
    resource.data.agentId == monUid()
  );
  allow create: if estAdmin();
  allow update: if estConnecte() && (
    estAdmin() ||
    // L'agent peut seulement changer le statut (contacté, rdv, mandat)
    (resource.data.agentId == monUid() &&
     request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['statut', 'updatedAt']))
  );
}

// File d'attente — admin seulement
match /alertes_file/{fileId} {
  allow read, write: if estAdmin();
}
*/
