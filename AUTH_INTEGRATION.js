// auth.js
// Module d'authentification à inclure dans index.html (MandatScrap)
// Protège la page — redirige vers login.html si non connecté
// Expose window.AGENT_ID, window.AGENT_PROFIL, etc.

// ── À coller dans le <script type="module"> de index.html ────────────────────
// Remplace le bloc Firebase existant par celui-ci

/*
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, query, where, orderBy,
         onSnapshot, doc, updateDoc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "VOTRE_API_KEY",
  authDomain:        "mandatscrap.firebaseapp.com",
  projectId:         "mandatscrap",
  storageBucket:     "mandatscrap.appspot.com",
  messagingSenderId: "000000000000",
  appId:             "1:000000000000:web:xxxxxxxxxxxxxxxx",
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── GUARD AUTH ────────────────────────────────────────────────────────────────
// Afficher un écran de chargement pendant la vérif
document.body.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;height:100vh;
    background:#0C0C0C;font-family:'JetBrains Mono',monospace;font-size:12px;
    color:#444;letter-spacing:.1em">
    CHARGEMENT…
  </div>`;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Non connecté → page de login
    window.location.href = "login.html";
    return;
  }

  // Récupérer le profil agent depuis Firestore
  const profilSnap = await getDoc(doc(db, "agents", user.uid));

  if (!profilSnap.exists()) {
    // Pas de profil = compte non complété
    window.location.href = "register.html";
    return;
  }

  const profil = profilSnap.data();

  if (profil.statut !== "actif") {
    // Compte désactivé
    await signOut(auth);
    window.location.href = "login.html?error=desactive";
    return;
  }

  // ── Tout est OK — exposer les données agent ──────────────────────────────
  window.AGENT_ID     = user.uid;
  window.AGENT_EMAIL  = user.email;
  window.AGENT_PROFIL = profil;
  window.AGENT_ZONES  = profil.zones || [];
  window.AGENT_ROLE   = profil.role || "agent";

  // Mettre à jour l'UI
  document.getElementById("ta-av").textContent = profil.prenom?.[0]?.toUpperCase() || "?";
  document.getElementById("ta-nm").textContent = `${profil.prenom || ""} ${profil.nom || ""}`.trim();

  // ── Restituer le vrai HTML de l'app ──────────────────────────────────────
  // (voir index.html — le body est initialement vide puis rempli ici)
  document.body.innerHTML = APP_HTML; // APP_HTML défini plus bas

  // ── Charger les données Firebase ─────────────────────────────────────────
  // Annonces filtrées sur les zones de l'agent
  if (window.AGENT_ZONES.length > 0) {
    // Firestore limite les "in" à 30 éléments — on prend les 10 premiers codes postaux
    const zones10 = window.AGENT_ZONES.slice(0, 10);
    const qPige = query(
      collection(db, "annonces"),
      where("statut", "==", "active"),
      where("codePostal", "in", zones10),
      orderBy("score", "desc")
    );
    onSnapshot(qPige, snap => {
      window.DATA_PIGE = snap.docs.map(d => ({ id: d.id, _type: "pige", ...d.data() }));
      fusionnerEtAfficher();
    });
  }

  // Contacts de l'agent
  const qCont = query(
    collection(db, "contacts"),
    where("agentId", "==", window.AGENT_ID),
    where("statut", "==", "actif"),
    orderBy("score", "desc")
  );
  onSnapshot(qCont, snap => {
    window.DATA_CONTACTS = snap.docs.map(d => ({ id: d.id, _type: "contact", ...d.data() }));
    fusionnerEtAfficher();
  });

  // Exposer signOut
  window.deconnexion = async () => {
    await signOut(auth);
    window.location.href = "login.html";
  };

  // Exposer updateDoc pour les statuts
  window._fs = { db, collection, query, where, orderBy, onSnapshot, doc, updateDoc };
  window.FIREBASE_OK = true;
});
*/

// ── GUIDE D'INTÉGRATION ───────────────────────────────────────────────────────
//
// 1. Dans index.html, remplacer le bloc <script type="module"> par le code ci-dessus
//
// 2. Ajouter un bouton déconnexion dans la topbar :
//    <button onclick="deconnexion()" style="...">Déconnexion</button>
//
// 3. Dans la query annonces, le filtre "codePostal in AGENT_ZONES" garantit
//    que chaque agent ne voit que les biens de ses zones
//
// 4. Les règles Firestore (firestore.rules) sont la 2ème ligne de défense
//    au cas où un agent essaierait de manipuler les requêtes
//
// ── STRUCTURE FIRESTORE ATTENDUE ─────────────────────────────────────────────
//
// agents/{uid}
//   prenom: "Thomas"
//   nom: "Dupont"
//   email: "thomas@lafede.immo"
//   reseau: "lf_immo"
//   role: "agent" | "admin"
//   zones: ["67500", "67240", "67000"]
//   statut: "actif" | "inactif"
//
// annonces/{id}
//   codePostal: "67500"   ← filtré par zone agent
//   agentId: null         ← rempli quand agent marque "contacté"
//   agentStatut: null     ← "contacte" | "rdv" | "mandat"
//   ...autres champs pige
//
// contacts/{id}
//   agentId: "uid_agent"  ← TOUJOURS l'UID de l'agent propriétaire
//   ...autres champs SIANA
