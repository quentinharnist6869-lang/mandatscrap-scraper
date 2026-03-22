// scripts/recalcul-scores.js
// Recalcule tous les scores contacts + envoie digest Brevo aux agents
// Tournée via GitHub Actions chaque lundi matin et chaque soir

require("dotenv").config();
const admin = require("firebase-admin");
const { calculerScoreContact } = require("./scoring-contacts");

admin.initializeApp({
  credential: admin.credential.cert({
    project_id:   process.env.FIREBASE_PROJECT_ID,
    private_key:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});
const db = admin.firestore();

// ─── Recalcul de tous les contacts actifs ─────────────────────────────────────
async function recalculerTousLesScores() {
  console.log("⚙️  Recalcul des scores contacts...");

  const snap = await db.collection("contacts")
    .where("statut", "==", "actif")
    .get();

  const BATCH_SIZE = 500;
  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const contact = { id: doc.id, ...doc.data() };
    const scoring = calculerScoreContact(contact);

    batch.update(doc.ref, {
      score:              scoring.score,
      chaleur:            scoring.chaleur,
      scoringDetail:      scoring.detail,
      joursDepuisContact: scoring.joursDepuisContact,
      scoringCalculeLe:   scoring.calculeLe,
      updatedAt:          new Date().toISOString(),
    });

    updated++;
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  console.log(`✅ ${updated} contacts recalculés`);
  return updated;
}

// ─── Récupérer le top N contacts d'un agent ──────────────────────────────────
async function getTopContacts(agentId, n = 5) {
  const snap = await db.collection("contacts")
    .where("agentId", "==", agentId)
    .where("statut", "==", "actif")
    .where("chaleur", "in", ["chaud", "tiede"])
    .orderBy("score", "desc")
    .limit(n)
    .get();

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Récupérer tous les agents uniques ───────────────────────────────────────
async function getTousLesAgents() {
  const snap = await db.collection("contacts")
    .where("statut", "==", "actif")
    .select("agentId")
    .get();

  const agents = new Set(snap.docs.map(d => d.data().agentId).filter(Boolean));
  return [...agents];
}

// ─── Récupérer l'email d'un agent ────────────────────────────────────────────
async function getEmailAgent(agentId) {
  const snap = await db.collection("agents").doc(agentId).get();
  if (!snap.exists) return null;
  return snap.data()?.email || null;
}

// ─── Générer le HTML du digest hebdo ─────────────────────────────────────────
function genererDigestHTML(contacts, agentNom) {
  const lignes = contacts.map(c => {
    const jours = c.joursDepuisContact || 0;
    const chaleurEmoji = c.chaleur === "chaud" ? "🔥" : "🟡";
    return `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0">
        ${chaleurEmoji} <strong>${c.prenom || ""} ${c.nom || ""}</strong>
        ${c.ville ? `<br><span style="font-size:12px;color:#888">${c.ville}</span>` : ""}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;text-align:center">
        <span style="background:${c.chaleur === "chaud" ? "#ffeaea" : "#fff4e5"};
                     color:${c.chaleur === "chaud" ? "#cc3333" : "#e07b35"};
                     padding:3px 8px;border-radius:10px;font-size:13px;font-weight:bold">
          ${c.score}/100
        </span>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px">
        ${jours < 30 ? `${jours}j` : `${Math.round(jours/30)}m`} sans contact
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#555">
        ${c.type === "vendeur" ? "Vendeur" : c.type === "les_deux" ? "Vendeur + Acheteur" : "Acheteur"}
      </td>
    </tr>`;
  }).join("");

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#CC3333;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0;font-size:18px">🔥 Vos contacts à relancer cette semaine</h2>
      <p style="margin:6px 0 0;opacity:.85;font-size:13px">
        Bonjour ${agentNom || ""},<br>
        Voici vos contacts les plus chauds — ne les laissez pas refroidir.
      </p>
    </div>
    <div style="background:#fff;border:1px solid #eee;padding:0;border-radius:0 0 8px 8px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f9f9f9">
            <th style="padding:10px 8px;text-align:left;font-size:12px;color:#888;font-weight:500">Contact</th>
            <th style="padding:10px 8px;text-align:center;font-size:12px;color:#888;font-weight:500">Score</th>
            <th style="padding:10px 8px;text-align:left;font-size:12px;color:#888;font-weight:500">Inactivité</th>
            <th style="padding:10px 8px;text-align:left;font-size:12px;color:#888;font-weight:500">Type</th>
          </tr>
        </thead>
        <tbody>${lignes}</tbody>
      </table>
      <div style="padding:16px 20px;text-align:center">
        <a href="${process.env.DASHBOARD_URL || "https://siana.lafede.immo"}"
           style="background:#CC3333;color:#fff;padding:12px 28px;border-radius:6px;
                  text-decoration:none;font-weight:bold;font-size:14px">
          Ouvrir le dashboard →
        </a>
      </div>
      <p style="text-align:center;font-size:11px;color:#bbb;padding:0 20px 16px">
        LF Immo — Pige Intelligente · Digest du ${new Date().toLocaleDateString("fr-FR")}
      </p>
    </div>
  </div>`;
}

// ─── Envoyer le digest Brevo ──────────────────────────────────────────────────
async function envoyerDigest(agentId, contacts) {
  const emailAgent = await getEmailAgent(agentId);
  if (!emailAgent) {
    console.warn(`  ⚠️ Pas d'email pour l'agent ${agentId}`);
    return;
  }

  const snap = await db.collection("agents").doc(agentId).get();
  const agentNom = snap.exists ? (snap.data()?.prenom || snap.data()?.nom || "") : "";

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: "LF Immo — Copilote Relance",
        email: process.env.BREVO_SENDER_EMAIL || "copilote@lafede.immo",
      },
      to: [{ email: emailAgent, name: agentNom }],
      subject: `🔥 Vos ${contacts.length} contacts à relancer cette semaine`,
      htmlContent: genererDigestHTML(contacts, agentNom),
    }),
  });

  if (resp.ok) {
    console.log(`  ✅ Digest envoyé à ${emailAgent} (agent ${agentId})`);
  } else {
    console.error(`  ❌ Erreur envoi digest ${agentId} : ${resp.status}`);
  }
}

// ─── Run principal ────────────────────────────────────────────────────────────
async function run() {
  const debut = Date.now();
  console.log("═══════════════════════════════════════════════");
  console.log("🤝 LF Immo — Copilote Relance Contacts");
  console.log(`📅 ${new Date().toLocaleString("fr-FR")}`);
  console.log("═══════════════════════════════════════════════\n");

  // 1. Recalculer tous les scores
  await recalculerTousLesScores();

  // 2. Envoyer les digests uniquement le lundi matin
  const estLundi = new Date().getDay() === 1;
  const brevoKey = process.env.BREVO_API_KEY;

  if (estLundi && brevoKey) {
    console.log("\n📧 Envoi des digests hebdomadaires...");
    const agents = await getTousLesAgents();
    console.log(`  ${agents.length} agent(s) détecté(s)`);

    for (const agentId of agents) {
      const top5 = await getTopContacts(agentId, 5);
      if (top5.length > 0) {
        await envoyerDigest(agentId, top5);
      }
    }
  } else if (!estLundi) {
    console.log("\nℹ️ Digest hebdo uniquement le lundi — skipped");
  }

  const duree = ((Date.now() - debut) / 1000).toFixed(1);
  console.log(`\n✅ Run terminé en ${duree}s`);
}

run().catch(e => {
  console.error("💥 Erreur fatale :", e);
  process.exit(1);
});
