# Bot WhatsApp a menu (gratuit)

Bot simple qui repond automatiquement a des questions predefinies sur WhatsApp,
avec un menu 1/2/3, un lien de catalogue, et une gestion des heures d'ouverture.

## Bibliotheque utilisee

**Baileys** (`@whiskeysockets/baileys`) : bibliotheque Node.js gratuite et open-source
qui se connecte a WhatsApp de la meme maniere que "WhatsApp Web" (scan d'un QR code).
Elle ne necessite **aucune validation Meta Business**, contrairement a l'API officielle
WhatsApp Cloud API - ce qui la rend adaptee a un delai d'1 semaine.

⚠️ Points a connaitre avant de deployer en production :
- Ce n'est **pas l'API officielle Meta** : WhatsApp peut en theorie bannir un numero
  qui envoie trop de messages ou qui a un comportement "robotique" suspect. Pour un
  bot de service client basique avec des reponses simples, le risque est faible mais
  pas nul. Utilisez idealement un numero dedie (pas votre numero personnel).
- Un WhatsApp **ne peut pas techniquement declencher un appel automatiquement** :
  ni Baileys ni l'API officielle Meta ne permettent de lancer un appel vocal WhatsApp
  depuis un bot. La solution implementee ici : le bot previent un agent humain par
  message interne + envoie au client un lien `wa.me` pour appeler directement.
- Le processus doit **rester actif en permanence** (ce n'est pas une fonction
  serverless classique) car il maintient une connexion WebSocket ouverte. Un simple
  hebergement "au clic" ne suffit pas.

## Installation

```bash
cd whatsapp-bot
npm install
cp .env.example .env
```

Puis remplissez le fichier `.env` avec vos vraies informations (nom de l'entreprise,
texte de presentation, lien du catalogue, numero de l'agent, horaires).

## Lancement (en local, pour tester)

```bash
npm start
```

Un QR code s'affiche dans le terminal : scannez-le depuis votre telephone
(WhatsApp > Parametres > Appareils lies > Lier un appareil).

Une fois connecte, envoyez un message a ce numero WhatsApp depuis un autre telephone
pour tester le menu.

La session est sauvegardee dans le dossier `auth_info/` : vous n'aurez pas besoin
de re-scanner le QR code a chaque redemarrage, sauf si vous vous deconnectez
manuellement depuis le telephone.

## Hebergement gratuit / pas cher (24h/24)

Comme le bot doit rester connecte en permanence, evitez les plateformes 100%
serverless (Vercel, Netlify). Options adaptees :

- **Railway** ou **Render** (plan gratuit/"hobby") : deploiement simple d'une app
  Node.js "toujours active".
- Un **VPS gratuit/pas cher** (Oracle Cloud Free Tier, ou un petit VPS a quelques
  euros/mois) avec `pm2` pour garder le processus actif et le relancer en cas de crash :
  ```bash
  npm install -g pm2
  pm2 start index.js --name whatsapp-bot
  pm2 save
  ```

Dans tous les cas, pensez a sauvegarder/persister le dossier `auth_info/` sur
l'hebergement choisi, sinon vous devrez re-scanner le QR code a chaque redeploiement.

## Evolution possible

- Remplacer la Map en memoire (`sessions`) par une base de donnees (SQLite,
  MongoDB...) si vous voulez garder l'historique ou passer sur plusieurs instances.
- Migrer vers l'**API officielle WhatsApp Cloud API** de Meta une fois l'entreprise
  verifiee : plus robuste, pas de risque de ban, mais demande un compte Meta Business
  verifie (delai variable, parfois plus d'une semaine).
