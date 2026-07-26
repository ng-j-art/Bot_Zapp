/**
 * Bot WhatsApp a menu - repond automatiquement a des questions predefinies.
 * Bibliotheque utilisee : @whiskeysockets/baileys (gratuite, open-source,
 * pas besoin de validation Meta Business, connexion par QR code comme WhatsApp Web).
 *
 * Flux implemente :
 *  - Message de bienvenue + menu (1/2/3)
 *  - 1 -> presentation de l'entreprise
 *  - 2 -> lien du catalogue
 *  - 3 -> si on est dans les heures d'ouverture -> on previent un agent humain
 *         (le bot ne peut pas techniquement "lancer un appel" tout seul, voir README)
 *         sinon -> message "nous sommes fermes" + horaires
 *  - toute autre reponse -> on rappelle le menu
 */

require("dotenv").config();
const path = require("path");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Boom } = require("@hapi/boom");
const http = require("http");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

// ---------- Configuration (voir .env) ----------
const COMPANY_NAME = process.env.COMPANY_NAME || "notre entreprise";
const COMPANY_DESCRIPTION =
  process.env.COMPANY_DESCRIPTION ||
  "Nous n'avons pas encore configure la description de l'entreprise.";
const CATALOG_URL = process.env.CATALOG_URL || "https://exemple.com/catalogue";
const RAW_AGENT_PHONE = process.env.AGENT_PHONE || "237600000000";
const AGENT_PHONE = RAW_AGENT_PHONE.replace(/\D/g, "");
const OPEN_HOUR = parseInt(process.env.OPEN_HOUR || "9", 10);
const CLOSE_HOUR = parseInt(process.env.CLOSE_HOUR || "13", 10);
const TIMEZONE = process.env.TIMEZONE || "Africa/Douala";
const PORT = process.env.PORT || 3000;

// ---------- Etat de conversation par utilisateur (en memoire) ----------
// cle: jid de l'utilisateur, valeur: { state, lastActivity }
const sessions = new Map();

// Dernier QR code recu, affiche sur une page web (plus fiable que l'ASCII dans les logs Railway)
let latestQR = null;
let isConnected = false;

function getSession(jid) {
  if (!sessions.has(jid)) {
    sessions.set(jid, { state: "NEW", lastActivity: Date.now() });
  }
  return sessions.get(jid);
}

// ---------- Utilitaires ----------
function isOpenNow() {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      hour: "numeric",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return false;
    const hour = parseInt(hourPart.value, 10);
    return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
  } catch (err) {
    console.error("Erreur lors de la verification des heures d'ouverture :", err);
    const hour = new Date().getHours();
    return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
  }
}

function menuText() {
  if(session.state === "NEW"){
    return (
      `Bienvenue chez *${COMPANY_NAME}* 👋\n\n` +
      `Que souhaitez-vous faire ?\n` +
      `1️⃣ - En savoir plus sur nous\n` +
      `2️⃣ - Consulter notre catalogue\n` +
      `3️⃣ - Discuter avec un agent\n\n` +
      `_Repondez simplement par 1, 2 ou 3._`
    );
  }else {
    return (
      `*${COMPANY_NAME}* \n\n` +
      `Que souhaitez-vous faire ?\n` +
      `1️⃣ - En savoir plus sur nous\n` +
      `2️⃣ - Consulter notre catalogue\n` +
      `3️⃣ - Discuter avec un agent\n\n` +
      `_Repondez simplement par 1, 2 ou 3._`
    );
  }
}

function hoursText() {
  return `${String(OPEN_HOUR).padStart(2, "0")}h - ${String(CLOSE_HOUR).padStart(2, "0")}h`;
}

// ---------- Demarrage du bot ----------
async function start() {
  const authFolder = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "auth_info")
    : path.join(__dirname, "auth_info");
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  let version = [2, 3000, 1015901307]; // Version de secours si fetchLatestBaileysVersion echoue
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
  } catch (err) {
    console.error("Impossible de recuperer la derniere version de Baileys, utilisation de la version par defaut :", err);
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Desktop"),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

   if (qr) {
      latestQR = qr;
      isConnected = false;
      console.log("\nNouveau QR code recu. Ouvrez l'URL publique du service + /qr pour le scanner facilement.\n");
      qrcode.generate(qr, { small: true }); // garde aussi l'affichage terminal, utile en local
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connexion fermee.", statusCode, "-> reconnexion dans 5s :", shouldReconnect);
      isConnected = false;
      if (shouldReconnect) {
        setTimeout(() => start(), 5000);
      } else {
        console.log("Deconnecte (loggedOut). Supprimez le dossier auth_info pour re-scanner un QR code.");
      }
    } else if (connection === "open") {
      console.log("✅ Bot WhatsApp connecte et pret !");
      latestQR = null;
      isConnected = true;
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error("Erreur en traitant un message:", err);
      }
    }
  });
}

// ---------- Traitement d'un message entrant ----------
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;

  // On ignore : messages envoyes par le bot lui-meme, messages de groupe, messages sans contenu
  if (!jid || msg.key.fromMe) return;
  if (jid.endsWith("@g.us")) return; // ignore les groupes, on ne gere que les conversations privees
  if (jid === "status@broadcast") return;

  const text = extractText(msg).trim();
  if (!text) return; // ignore images/audios/etc. sans legende, pour rester simple

  const session = getSession(jid);
  session.lastActivity = Date.now();

  const lower = text.toLowerCase();

  // Commande universelle pour revenir au menu a tout moment
  if (lower === "menu" || lower === "0" || session.state === "NEW") {
    session.state = "MENU";
    await sock.sendMessage(jid, { text: menuText() });
    return;
  }

  if (session.state === "MENU") {
    switch (text) {
      case "1":
        await sock.sendMessage(jid, { text: COMPANY_DESCRIPTION });
        await sock.sendMessage(jid, { text: menuText() });
        break;

      case "2":
        await sock.sendMessage(jid, {
          text: `Voici notre catalogue 📄 :\n${CATALOG_URL}`,
        });
        await sock.sendMessage(jid, { text: menuText() });
        break;

      case "3":
        if (isOpenNow()) {
          // Le bot ne peut pas techniquement declencher un appel WhatsApp automatiquement
          // (aucune API publique ne le permet). On previent donc un agent humain en interne
          // et on donne au client un lien pour appeler directement si besoin.
          await sock.sendMessage(jid, {
            text:
              `Un instant, un de nos agents va vous contacter tres bientot ⏳\n\n` +
              `Vous pouvez aussi nous appeler directement ici :\nhttps://wa.me/${AGENT_PHONE}`,
          });
          // Notification interne a l'agent
          const clientJid = msg.key.senderPn || jid;
          const clientNumber = clientJid.split("@")[0].split(":")[0];
          await sock.sendMessage(`${AGENT_PHONE}@s.whatsapp.net`, {
            text: `📞 Nouvelle demande de contact du client +${clientNumber}. Merci de le rappeler.`,
          });
        } else {
          await sock.sendMessage(jid, {
            text:
              `Nous sommes actuellement fermes 🙏\n` +
              `Nos horaires d'ouverture : ${hoursText()}`,
          });
        }
        await sock.sendMessage(jid, { text: menuText() });
        break;

      default:
        await sock.sendMessage(jid, {
          text: `Je n'ai pas compris votre reponse.\n\n${menuText()}`,
        });
    }
    return;
  }

  // Cas par defaut : on renvoie le menu
  session.state = "MENU";
  await sock.sendMessage(jid, { text: menuText() });
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ""
  );
}

start();

// ---------- Serveur HTTP pour Render/Railway (Port Binding + page /qr) ----------
const server = http.createServer(async (req, res) => {
  if (req.url === "/qr") {
    if (isConnected) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>✅ Le bot est deja connecte. Aucun QR a scanner.</h2>");
      return;
    }
    if (!latestQR) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>⏳ En attente de generation du QR code, rechargez dans quelques secondes...</h2>");
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(latestQR, { width: 400 });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;margin-top:40px;">
            <h2>Scannez avec WhatsApp (Parametres > Appareils lies)</h2>
            <img src="${dataUrl}" alt="QR code" />
            <p>Cette page se recharge automatiquement toutes les 20 secondes.</p>
            <script>setTimeout(() => location.reload(), 20000);</script>
          </body>
        </html>
      `);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Erreur de generation du QR code.");
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot WhatsApp actif. Ouvrez /qr pour scanner le QR code si besoin.\n");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serveur HTTP d'écoute démarré sur le port ${PORT}`);
});
