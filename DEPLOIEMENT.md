# 🔐 MandatScrap — Guide de déploiement complet

Tout ce qu'il faut faire pour passer du code local à la prod avec de vrais agents.

---

## Étape 1 — Créer le projet Firebase (20 min)

1. Aller sur https://console.firebase.google.com
2. **Créer un projet** → Nom : `mandatscrap`
3. Activer **Authentication** → Sign-in method :
   - Email/Password : **Activer**
   - Google : **Activer** (mettre le domaine lafede.immo en domaine autorisé)
4. Activer **Firestore Database** → Mode Production → Région : `europe-west3` (Frankfurt)
5. **Paramètres du projet** → Vos applications → Ajouter une app Web
   → Copier le `firebaseConfig` (les 6 valeurs)

---

## Étape 2 — Remplir les clés Firebase (5 min)

Dans ces 3 fichiers, remplacer `"VOTRE_API_KEY"` etc. par vos vraies valeurs :

```
lf-auth/login.html       → firebaseConfig (lignes ~60-68)
lf-auth/register.html    → firebaseConfig (lignes ~60-68)
lf-command/index.html    → firebaseConfig (lignes ~80-88)
siana-lf/dashboard/index.html → firebaseConfig
```

Les 6 valeurs à remplir :
```js
apiKey:            "AIzaSy..."
authDomain:        "mandatscrap.firebaseapp.com"
projectId:         "mandatscrap"
storageBucket:     "mandatscrap.appspot.com"
messagingSenderId: "123456789"
appId:             "1:123456789:web:abc123"
```

---

## Étape 3 — Déployer les règles Firestore (5 min)

**Option A — Via la console Firebase (plus simple) :**
1. Firestore → Règles
2. Copier-coller le contenu de `firestore.rules`
3. Publier

**Option B — Via Firebase CLI :**
```bash
npm install -g firebase-tools
firebase login
firebase init firestore
firebase deploy --only firestore:rules
```

---

## Étape 4 — Créer le compte admin (5 min)

1. Déployer d'abord sur Netlify (étape 5)
2. Aller sur votre URL Netlify → `register.html`
3. S'inscrire avec le code `ADMIN26`
4. Dans Firebase Console → Firestore → `agents` → votre document
   → Vérifier que `role: "admin"` est bien présent

> **Important** : Changer les codes d'accès dans `register.html` (ligne ~115)
> avant d'inviter d'autres agents :
> ```js
> const CODES_VALIDES = {
>   "VOTRECODE2026": { reseau: "lf_immo", role: "agent" },
>   "LMDCODE2026":   { reseau: "lmd",     role: "agent" },
>   "ADMINCODE":     { reseau: "all",     role: "admin" },
> };
> ```

---

## Étape 5 — Déployer sur Netlify (10 min)

**Structure des fichiers à pousser sur GitHub :**
```
/
├── index.html          ← MandatScrap (app principale)
├── login.html          ← Page de connexion
├── register.html       ← Page d'inscription
├── _redirects          ← Fichier Netlify (voir ci-dessous)
```

**Fichier `_redirects` à créer :**
```
/login    /login.html    200
/register /register.html 200
/*        /index.html    200
```

**Déploiement Netlify :**
1. Aller sur https://app.netlify.com
2. **Add new site** → Import from Git
3. Choisir votre repo GitHub
4. Build command : (vide)
5. Publish directory : `/` (racine)
6. **Deploy site**

**Domaine personnalisé (optionnel) :**
- Netlify → Domain settings → Add domain → `command.lafede.immo`
- Puis dans Firebase Console → Authentication → Settings → Authorized domains
  → Ajouter `command.lafede.immo`

---

## Étape 6 — Configurer GitHub Secrets pour le scraper (10 min)

Dans votre repo GitHub → Settings → Secrets and variables → Actions :

| Secret | Valeur |
|--------|--------|
| `FIREBASE_PROJECT_ID` | `mandatscrap` |
| `FIREBASE_PRIVATE_KEY` | Clé privée du compte de service (voir ci-dessous) |
| `FIREBASE_CLIENT_EMAIL` | Email du compte de service |
| `BREVO_API_KEY` | Votre clé API Brevo |
| `BREVO_SENDER_EMAIL` | `pige@lafede.immo` |
| `ADMIN_EMAIL` | `quentin@lafede.immo` |
| `DASHBOARD_URL` | `https://command.lafede.immo` |

**Comment obtenir la clé de service Firebase :**
1. Firebase Console → Paramètres → Comptes de service
2. **Générer une nouvelle clé privée** → Télécharger le JSON
3. Copier chaque valeur dans les secrets GitHub correspondants

---

## Étape 7 — Premier test scraper (30 min)

```bash
# Cloner le repo
git clone votre-repo
cd votre-repo

# Installer les dépendances
npm install
npx puppeteer browsers install chrome

# Créer le .env (copier .env.example)
cp .env.example .env
# Remplir avec vos vraies valeurs

# Lancer un test sur 2 pages seulement
# (modifier config.js → maxPages: 2 pour le test)
npm start
```

Vérifier dans Firebase Console → Firestore → Collection `annonces`
que des documents apparaissent avec les bonnes données.

---

## Étape 8 — Inviter les premiers agents bêta (5 min par agent)

1. Envoyer le lien `https://command.lafede.immo/register.html`
2. Donner le code d'accès (ex: `LF2026`) par email ou SMS
3. L'agent choisit ses zones à l'inscription
4. Vous pouvez vérifier son compte dans Firebase → Firestore → `agents`

---

## Checklist finale avant ouverture

- [ ] Clés Firebase remplies dans tous les fichiers HTML
- [ ] Règles Firestore déployées
- [ ] Compte admin créé
- [ ] Codes d'accès changés (pas les exemples par défaut !)
- [ ] Déployé sur Netlify
- [ ] Domaine configuré dans Firebase Auth
- [ ] GitHub Secrets configurés
- [ ] Test scraper local : annonces apparaissent dans Firestore
- [ ] Premier agent bêta invité et connecté

---

## Coûts mensuels estimés

| Service | Plan | Coût |
|---------|------|------|
| Firebase Spark | Gratuit jusqu'à 1GB Firestore | 0€ |
| Netlify | Starter | 0€ |
| GitHub Actions | 2000 min/mois gratuit | 0€ |
| Brevo | 300 emails/jour gratuit | 0€ |
| Anthropic API | ~500 pitchs/mois | ~2€ |
| **Total** | | **~2€/mois** |

> Au-delà de 50 agents actifs : Firebase Blaze (~5€/mois) + Brevo Starter (~10€/mois)
