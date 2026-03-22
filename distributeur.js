// distribution/distributeur.js
// Moteur de distribution intelligente des alertes pige
// Tourne après chaque run scraper (appelé depuis scraper/index.js)

require("dotenv").config();
const admin = require("firebase-admin");
const { calculerAppetence, estBloque } = require("./scoring-agents");

// ─── Init Firebase ────────────────────────────────────────────────────────────
function getDb() {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert({
        project_id:   process.env.FIREBASE_PROJECT_ID,
        private_key:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
  return admin.firestore();
}

// ─── Helpers date ─────────────────────────────────────────────────────────────
function debutAujourdhui() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function finAujourdhui() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// ─── Charger les stats du jour par agent ─────────────────────────────────────
/**
 * Compte combien d'alertes chaque agent a reçu aujourd'hui
 * et récupère son historique de réactivité (10 dernières alertes)
 */
async function chargerStatsAgents(db, agentIds) {
  const stats = {};
  const debut = debutAujourdhui();

  for (const agentId of agentIds) {
    // Alertes envoyées aujourd'hui
    const snapJour = await db.collection("alertes")
      .where("agentId", "==", agentId)
      .where("envoyeeAt", ">=", debut)
      .get();

    // Historique des 10 dernières alertes (pour réactivité)
    const snapHisto = await db.collection("alertes")
      .where("agentId", "==", agentId)
      .orderBy("envoyeeAt", "desc")
      .limit(10)
      .get();

    stats[agentId] = {
      alertesAujourdhui: snapJour.size,
      historiqueAlertes: snapHisto.docs.map(d => d.data()),
    };
  }

  return stats;
}

// ─── Charger tous les agents actifs ──────────────────────────────────────────
async function chargerAgentsActifs(db) {
  const snap = await db.collection("agents")
    .where("statut", "==", "actif")
    .get();
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// ─── Trouver le meilleur agent pour un bien ───────────────────────────────────
/**
 * Retourne l'agent avec le meilleur score d'appétence pour ce bien
 * En excluant les bloqués et ceux qui ont déjà reçu cette alerte
 */
function trouverMeilleurAgent(bien, agents, statsParAgent, alertesDejaEnvoyees) {
  const candidats = [];

  for (const agent of agents) {
    // Agent déjà alerté sur ce bien → skip
    if (alertesDejaEnvoyees.has(`${agent.uid}_${bien.id}`)) continue;

    const stats    = statsParAgent[agent.uid] || {};
    const appetence = calculerAppetence(agent, bien, stats);

    if (!appetence.bloque && appetence.score > 0) {
      candidats.push({ agent, appetence });
    }
  }

  if (candidats.length === 0) return null;

  // Trier par score décroissant — en cas d'égalité, priorité à celui
  // qui a le moins d'alertes aujourd'hui
  candidats.sort((a, b) => {
    if (b.appetence.score !== a.appetence.score) {
      return b.appetence.score - a.appetence.score;
    }
    return (a.appetence.alertesAujourdhui || 0) - (b.appetence.alertesAujourdhui || 0);
  });

  return candidats[0];
}

// ─── Envoyer une alerte Brevo ─────────────────────────────────────────────────
async function envoyerAlerteBrevo(agent, bien, appetence) {
  const nbBaisses = (bien.historiquePrix || []).filter(h => h.baisse).length;
  const prixInitial = bien.prixInitial?.toLocaleString("fr-FR") || "?";
  const prixActuel  = bien.prixActuel?.toLocaleString("fr-FR") || "?";
  const baissePct   = bien.prixInitial && bien.prixActuel < bien.prixInitial
    ? Math.round(((bien.prixInitial - bien.prixActuel) / bien.prixInitial) * 100)
    : 0;

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: "MandatScrap — Alerte Pige",
        email: process.env.BREVO_SENDER_EMAIL || "pige@lafede.immo",
      },
      to: [{ email: agent.email, name: `${agent.prenom} ${agent.nom}` }],
      subject: `🔥 Mandat récupérable · Score ${bien.score}/100 · ${bien.ville}`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
          <div style="background:#CC2B2B;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
            <p style="margin:0 0 4px;font-size:11px;opacity:.8;letter-spacing:.08em">
              ALERTE PIGE · POUR ${(agent.prenom||"").toUpperCase()} ${(agent.nom||"").toUpperCase()}
            </p>
            <h2 style="margin:0;font-size:20px">🔥 Mandat récupérable — Score ${bien.score}/100</h2>
          </div>

          <div style="background:#fff;border:1px solid #eee;padding:20px 22px">

            <h3 style="margin:0 0 14px;color:#1a1a1a">${bien.titre || "Bien immobilier"}</h3>

            <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:#888;font-size:13px;width:44%">Localisation</td>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-weight:600;font-size:13px">${bien.ville} (${bien.codePostal})</td>
              </tr>
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:#888;font-size:13px">En vente depuis</td>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-weight:600;font-size:13px;color:#CC2B2B">${bien.ancienneteMois} mois</td>
              </tr>
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:#888;font-size:13px">Prix actuel</td>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-weight:600;font-size:13px">${prixActuel} €</td>
              </tr>
              ${baissePct > 0 ? `<tr>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:#888;font-size:13px">Prix initial</td>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px">
                  <span style="text-decoration:line-through;color:#bbb">${prixInitial} €</span>
                  <span style="color:#CC2B2B;font-weight:600;margin-left:6px">-${baissePct}%</span>
                </td>
              </tr>` : ""}
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:#888;font-size:13px">Baisses de prix</td>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px;color:${nbBaisses > 1 ? "#CC2B2B" : "#333"};font-weight:${nbBaisses > 1 ? "600" : "400"}">${nbBaisses} baisse${nbBaisses > 1 ? "s" : ""}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:#888;font-size:13px">Type vendeur</td>
                <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px">${bien.typeVendeur === "particulier" ? "👤 Particulier" : "🏢 Agence indép."}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#888;font-size:13px">Source</td>
                <td style="padding:7px 0;font-size:13px">${bien.source}</td>
              </tr>
            </table>

            ${bien.description ? `
            <div style="background:#f9f9f9;border-radius:6px;padding:12px;font-size:12px;color:#555;line-height:1.6;margin-bottom:16px;font-style:italic">
              "${bien.description.slice(0, 200)}${bien.description.length > 200 ? "…" : ""}"
            </div>` : ""}

            <!-- Pourquoi cet agent -->
            <div style="background:#fff8f0;border:1px solid #ffd4a3;border-radius:6px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#8a4500">
              <strong>Pourquoi cette alerte vous est envoyée :</strong><br>
              Score d'appétence ${appetence.score}/100 · 
              Proximité ${appetence.detail?.proximite}/25 · 
              Disponibilité ${appetence.detail?.disponibilite}/30 · 
              Réactivité ${appetence.detail?.reactivite}/35
            </div>

            <div style="text-align:center;margin-bottom:8px">
              <a href="${process.env.DASHBOARD_URL || "https://command.lafede.immo"}"
                 style="background:#CC2B2B;color:#fff;padding:13px 32px;border-radius:6px;
                        text-decoration:none;font-weight:bold;font-size:14px;display:inline-block">
                Ouvrir MandatScrap →
              </a>
            </div>

            <p style="text-align:center;font-size:11px;color:#bbb;margin-top:12px">
              MandatScrap · Alerte ${new Date().toLocaleDateString("fr-FR")} · 
              Quota aujourd'hui : ${(appetence.alertesAujourdhui || 0) + 1}/3
            </p>
          </div>
        </div>`,
    }),
  });

  return resp.ok;
}

// ─── Logger l'alerte dans Firestore ──────────────────────────────────────────
async function loggerAlerte(db, agent, bien, appetence, envoye) {
  const now = new Date().toISOString();
  await db.collection("alertes").add({
    agentId:       agent.uid,
    agentEmail:    agent.email,
    agentNom:      `${agent.prenom} ${agent.nom}`,
    bienId:        bien.id,
    bienTitre:     bien.titre,
    bienVille:     bien.ville,
    bienScore:     bien.score,
    appetenceScore: appetence.score,
    appetenceDetail: appetence.detail,
    statut:        "envoye",       // "envoye" | "contacte" | "rdv" | "mandat" | "ignore"
    emailEnvoye:   envoye,
    envoyeeAt:     now,
    updatedAt:     now,
    // Clé de déduplication
    deduplicationKey: `${agent.uid}_${bien.id}`,
  });

  // Mettre à jour l'annonce : alerteEnvoyee = true + agentAssigne
  await db.collection("annonces").doc(bien.id).update({
    alerteEnvoyee:  true,
    alerteEnvoyeeAt: now,
    agentAssigneId: agent.uid,
    agentAssigneNom: `${agent.prenom} ${agent.nom}`,
    updatedAt:      now,
  });
}

// ─── Traitement des biens en file d'attente ───────────────────────────────────
/**
 * Si aucun agent n'était disponible hier → remettre le bien en file
 * et réessayer aujourd'hui
 */
async function traiterFileAttente(db, agents, statsParAgent, alertesDejaEnvoyees) {
  const snap = await db.collection("alertes_file")
    .where("statut", "==", "en_attente")
    .orderBy("createdAt", "asc")
    .limit(20)
    .get();

  if (snap.empty) return;

  console.log(`  📬 ${snap.size} biens en file d'attente à redistribuer`);

  for (const doc of snap.docs) {
    const item = { id: doc.data().bienId, ...doc.data().bienData };
    const candidat = trouverMeilleurAgent(item, agents, statsParAgent, alertesDejaEnvoyees);

    if (candidat) {
      const envoye = await envoyerAlerteBrevo(candidat.agent, item, candidat.appetence);
      await loggerAlerte(db, candidat.agent, item, candidat.appetence, envoye);

      // Retirer de la file
      await doc.ref.update({ statut: "traite", traiteLe: new Date().toISOString() });

      // Mettre à jour les stats locales
      const uid = candidat.agent.uid;
      statsParAgent[uid].alertesAujourdhui = (statsParAgent[uid].alertesAujourdhui || 0) + 1;
      alertesDejaEnvoyees.add(`${uid}_${item.id}`);

      console.log(`    ✅ File → ${candidat.agent.prenom} (score ${candidat.appetence.score})`);
    }
  }
}

// ─── Mise en file d'attente ───────────────────────────────────────────────────
async function mettreEnFile(db, bien) {
  await db.collection("alertes_file").add({
    bienId:   bien.id,
    bienData: bien,
    statut:   "en_attente",
    tentatives: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`  📥 Bien mis en file : ${bien.titre} (${bien.ville}) — aucun agent disponible`);
}

// ─── Notifier l'admin si file trop longue ─────────────────────────────────────
async function notifierAdminSiNecessaire(db) {
  const snap = await db.collection("alertes_file")
    .where("statut", "==", "en_attente")
    .get();

  if (snap.size >= 10) {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: "MandatScrap", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: process.env.ADMIN_EMAIL }],
        subject: `⚠️ File d'attente : ${snap.size} biens non distribués`,
        htmlContent: `<p>${snap.size} biens en attente de distribution depuis plus de 24h. Vérifiez la couverture des zones agents.</p>`,
      }),
    });
  }
}

// ─── DISTRIBUTEUR PRINCIPAL ───────────────────────────────────────────────────
/**
 * Point d'entrée principal — à appeler après chaque run scraper
 * Distribue les nouvelles alertes aux bons agents
 *
 * @param {Object} options
 *   - seuilScore: score minimum du bien pour déclencher une alerte (défaut: 70)
 *   - seuilMois:  ancienneté minimum en mois (défaut: 8)
 */
async function distribuerAlertes(options = {}) {
  const {
    seuilScore = 70,
    seuilMois  = 8,
  } = options;

  const db = getDb();
  const debut = Date.now();

  console.log("\n📡 DISTRIBUTION DES ALERTES");
  console.log(`   Seuil score : ${seuilScore}/100`);
  console.log(`   Seuil ancienneté : ${seuilMois} mois\n`);

  const stats = {
    biensCandidats:  0,
    alertesEnvoyees: 0,
    biensMisEnFile:  0,
    agentsBloqués:   0,
    errors:          0,
  };

  try {
    // ── 1. Charger les agents actifs ───────────────────────────────────────
    const agents = await chargerAgentsActifs(db);
    console.log(`  👥 ${agents.length} agents actifs`);

    if (agents.length === 0) {
      console.log("  ⚠️ Aucun agent actif — distribution impossible");
      return stats;
    }

    // ── 2. Charger les stats du jour par agent ─────────────────────────────
    const agentIds = agents.map(a => a.uid);
    const statsParAgent = await chargerStatsAgents(db, agentIds);

    const bloqués = agents.filter(a => (statsParAgent[a.uid]?.alertesAujourdhui || 0) >= 3);
    stats.agentsBloqués = bloqués.length;
    console.log(`  🔴 ${bloqués.length} agent(s) bloqués (quota atteint)`);
    console.log(`  🟢 ${agents.length - bloqués.length} agent(s) disponibles\n`);

    // ── 3. Charger les clés de déduplication (déjà alerté sur ce bien) ────
    const snapDedup = await db.collection("alertes")
      .where("envoyeeAt", ">=", new Date(Date.now() - 7 * 86400000).toISOString()) // 7 jours
      .select("deduplicationKey")
      .get();
    const alertesDejaEnvoyees = new Set(snapDedup.docs.map(d => d.data().deduplicationKey));

    // ── 4. Traiter la file d'attente d'abord ──────────────────────────────
    await traiterFileAttente(db, agents, statsParAgent, alertesDejaEnvoyees);

    // ── 5. Trouver les biens à alerter ────────────────────────────────────
    const snapBiens = await db.collection("annonces")
      .where("statut", "==", "active")
      .where("alerteEnvoyee", "==", false)
      .where("score", ">=", seuilScore)
      .where("ancienneteMois", ">=", seuilMois)
      .orderBy("score", "desc")
      .limit(50)
      .get();

    stats.biensCandidats = snapBiens.size;
    console.log(`  🏠 ${snapBiens.size} biens candidats (score ≥ ${seuilScore}, ≥ ${seuilMois}m)`);

    // ── 6. Distribuer chaque bien ─────────────────────────────────────────
    for (const docBien of snapBiens.docs) {
      const bien = { id: docBien.id, ...docBien.data() };

      // Trouver le meilleur agent dispo pour ce bien
      const candidat = trouverMeilleurAgent(bien, agents, statsParAgent, alertesDejaEnvoyees);

      if (!candidat) {
        // Aucun agent disponible → file d'attente
        await mettreEnFile(db, bien);
        stats.biensMisEnFile++;
        continue;
      }

      // Envoyer l'alerte Brevo
      try {
        const envoye = await envoyerAlerteBrevo(candidat.agent, bien, candidat.appetence);

        // Logger dans Firestore
        await loggerAlerte(db, candidat.agent, bien, candidat.appetence, envoye);

        // Mettre à jour les stats locales pour les prochains biens
        const uid = candidat.agent.uid;
        statsParAgent[uid].alertesAujourdhui = (statsParAgent[uid].alertesAujourdhui || 0) + 1;
        alertesDejaEnvoyees.add(`${uid}_${bien.id}`);

        stats.alertesEnvoyees++;
        console.log(`  ✅ "${bien.titre}" (${bien.ville}) → ${candidat.agent.prenom} · score appétence ${candidat.appetence.score}/100`);

      } catch(e) {
        console.error(`  ❌ Erreur alerte pour ${bien.titre} : ${e.message}`);
        stats.errors++;
      }
    }

    // ── 7. Notifier l'admin si file trop longue ───────────────────────────
    await notifierAdminSiNecessaire(db);

  } catch(e) {
    console.error(`❌ Erreur distributeur : ${e.message}`);
    stats.errors++;
  }

  const duree = ((Date.now() - debut) / 1000).toFixed(1);
  console.log(`\n📊 Distribution terminée en ${duree}s`);
  console.log(`   Biens candidats   : ${stats.biensCandidats}`);
  console.log(`   Alertes envoyées  : ${stats.alertesEnvoyees}`);
  console.log(`   Mis en file       : ${stats.biensMisEnFile}`);
  console.log(`   Agents bloqués    : ${stats.agentsBloqués}`);
  console.log(`   Erreurs           : ${stats.errors}\n`);

  return stats;
}

module.exports = { distribuerAlertes };
