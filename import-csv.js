// scripts/import-csv.js
// Importe les contacts depuis un export CSV Liucy vers Firebase
// Usage : node scripts/import-csv.js chemin/vers/export.csv [agentId]

require("dotenv").config();
const fs      = require("fs");
const path    = require("path");
const admin   = require("firebase-admin");
const { calculerScoreContact } = require("./scoring-contacts");

// ─── Init Firebase ────────────────────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    project_id:   process.env.FIREBASE_PROJECT_ID,
    private_key:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});
const db = admin.firestore();

// ─── Mapping colonnes CSV Liucy → champs Firebase ────────────────────────────
// Adapter selon l'export réel de Liucy
// Les clés sont les noms de colonnes CSV (insensible à la casse)
// Les valeurs sont les noms de champs Firebase
const MAPPING_COLONNES = {
  // Identité
  "nom":           "nom",
  "prenom":        "prenom",
  "prénom":        "prenom",
  "firstname":     "prenom",
  "lastname":      "nom",

  // Contact
  "telephone":     "telephone",
  "téléphone":     "telephone",
  "tel":           "telephone",
  "mobile":        "telephone",
  "email":         "email",
  "mail":          "email",

  // Localisation
  "ville":         "ville",
  "city":          "ville",
  "code postal":   "codePostal",
  "codepostal":    "codePostal",
  "cp":            "codePostal",

  // Type prospect
  "type":          "type",
  "profil":        "type",
  "categorie":     "type",
  "catégorie":     "type",

  // Dates
  "date contact":          "dateDernierContact",
  "dernier contact":       "dateDernierContact",
  "dernière relance":      "dateDernierContact",
  "date création":         "datePremierContact",
  "date creation":         "datePremierContact",
  "date d'entrée":         "datePremierContact",
  "date entree":           "datePremierContact",

  // Projet
  "notes":         "notes",
  "commentaires":  "notes",
  "remarques":     "notes",
  "budget":        "budget",
  "projet":        "notesProjet",
};

// ─── Normalisation du type prospect ──────────────────────────────────────────
function normaliserType(valeur) {
  if (!valeur) return "inconnu";
  const v = valeur.toLowerCase().trim();

  if (v.includes("vendeur") && v.includes("acheteur")) return "les_deux";
  if (v.includes("vendeur") || v.includes("vente") || v.includes("seller")) return "vendeur";
  if (v.includes("acquéreur") || v.includes("acheteur") || v.includes("acquereur") || v.includes("buyer")) return "acquereur";
  return "inconnu";
}

// ─── Normalisation d'une date ─────────────────────────────────────────────────
function normaliserDate(valeur) {
  if (!valeur || valeur.trim() === "") return null;

  // Essayer plusieurs formats courants
  // "15/01/2024", "2024-01-15", "15-01-2024", "15/01/24"
  const formats = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
    /^(\d{2})-(\d{2})-(\d{4})$/,   // DD-MM-YYYY
    /^(\d{2})\/(\d{2})\/(\d{2})$/,  // DD/MM/YY
  ];

  for (const fmt of formats) {
    const m = valeur.match(fmt);
    if (m) {
      const year = m[3].length === 2 ? "20" + m[3] : m[3];
      const d = new Date(`${year}-${m[2]}-${m[1]}`);
      if (!isNaN(d)) return d.toISOString();
    }
  }

  // Format ISO direct
  const d = new Date(valeur);
  if (!isNaN(d)) return d.toISOString();

  return null;
}

// ─── Parser une ligne CSV ─────────────────────────────────────────────────────
function parserLigne(ligne, headers) {
  const contact = {};

  headers.forEach((header, i) => {
    const cle = header.toLowerCase().trim();
    const champFirebase = MAPPING_COLONNES[cle];
    if (!champFirebase) return;

    let valeur = (ligne[i] || "").trim();
    if (!valeur) return;

    // Normaliser selon le type de champ
    if (champFirebase === "type") {
      valeur = normaliserType(valeur);
    } else if (champFirebase.startsWith("date")) {
      valeur = normaliserDate(valeur);
    }

    contact[champFirebase] = valeur;
  });

  return contact;
}

// ─── Parser CSV manuellement (sans dépendance) ───────────────────────────────
function parserCSV(contenu) {
  const lignes = contenu.split("\n").filter(l => l.trim());
  if (lignes.length === 0) return [];

  // Détecter le séparateur (virgule, point-virgule, tabulation)
  const premiereLigne = lignes[0];
  const separateur = premiereLigne.includes(";") ? ";" :
                     premiereLigne.includes("\t") ? "\t" : ",";

  const headers = premiereLigne.split(separateur).map(h => h.replace(/['"]/g, "").trim());
  const rows = [];

  for (let i = 1; i < lignes.length; i++) {
    const valeurs = lignes[i].split(separateur).map(v => v.replace(/^["']|["']$/g, "").trim());
    rows.push(valeurs);
  }

  return { headers, rows };
}

// ─── Import principal ─────────────────────────────────────────────────────────
async function importerCSV(cheminFichier, agentId) {
  console.log(`\n📂 Import CSV — ${cheminFichier}`);
  console.log(`👤 Agent : ${agentId}\n`);

  if (!fs.existsSync(cheminFichier)) {
    console.error(`❌ Fichier introuvable : ${cheminFichier}`);
    process.exit(1);
  }

  const contenu = fs.readFileSync(cheminFichier, "utf8");
  const { headers, rows } = parserCSV(contenu);

  console.log(`📊 ${rows.length} contacts détectés`);
  console.log(`📋 Colonnes : ${headers.join(", ")}\n`);

  let crees = 0, miseAJour = 0, ignores = 0;

  // Traitement par batch de 50 pour Firebase
  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const segment = rows.slice(i, i + BATCH_SIZE);

    for (const row of segment) {
      const contactBrut = parserLigne(row, headers);

      // Ignorer les lignes sans nom ni téléphone
      if (!contactBrut.nom && !contactBrut.telephone) {
        ignores++;
        continue;
      }

      // Calculer le score initial
      const scoring = calculerScoreContact({
        ...contactBrut,
        dateDernierContact: contactBrut.dateDernierContact || contactBrut.datePremierContact,
        statut: "actif",
      });

      const now = new Date().toISOString();

      const docData = {
        agentId,
        ...contactBrut,
        // Valeurs par défaut si manquantes
        type:              contactBrut.type || "inconnu",
        statut:            "actif",
        nbEchanges:        0,
        // Scoring initial
        score:             scoring.score,
        chaleur:           scoring.chaleur,
        scoringDetail:     scoring.detail,
        joursDepuisContact: scoring.joursDepuisContact,
        scoringCalculeLe:  scoring.calculeLe,
        // Meta
        sourceImport:      "csv",
        importeLe:         now,
        createdAt:         now,
        updatedAt:         now,
      };

      // Chercher si le contact existe déjà (par téléphone)
      if (contactBrut.telephone) {
        const existant = await db.collection("contacts")
          .where("agentId", "==", agentId)
          .where("telephone", "==", contactBrut.telephone)
          .limit(1)
          .get();

        if (!existant.empty) {
          // Mettre à jour uniquement les données modifiables
          const ref = existant.docs[0].ref;
          batch.update(ref, {
            ...contactBrut,
            score:             scoring.score,
            chaleur:           scoring.chaleur,
            scoringDetail:     scoring.detail,
            scoringCalculeLe:  scoring.calculeLe,
            joursDepuisContact: scoring.joursDepuisContact,
            updatedAt:         now,
          });
          miseAJour++;
          continue;
        }
      }

      // Nouveau contact
      const ref = db.collection("contacts").doc();
      batch.set(ref, docData);
      crees++;
    }

    await batch.commit();
    console.log(`  ✅ Batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} traité (${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length})`);
  }

  console.log(`\n═══════════════════════════════════`);
  console.log(`✨ Nouveaux contacts   : ${crees}`);
  console.log(`🔄 Contacts mis à jour : ${miseAJour}`);
  console.log(`⏭️  Ignorés (vides)     : ${ignores}`);
  console.log(`═══════════════════════════════════\n`);
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cheminFichier = args[0];
const agentId       = args[1] || "agent_default";

if (!cheminFichier) {
  console.log("Usage : node scripts/import-csv.js <chemin_csv> <agentId>");
  console.log("Ex    : node scripts/import-csv.js export_liucy.csv agent_thomas");
  process.exit(1);
}

importerCSV(cheminFichier, agentId).catch(e => {
  console.error("❌ Erreur import :", e.message);
  process.exit(1);
});
