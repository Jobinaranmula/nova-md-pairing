const express = require("express");
const cors = require("cors");
const P = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 8080;

let sock = null;
let authState = null;
let saveCreds = null;
let connectionStatus = "starting";
let pairingInProgress = false;

async function startWhatsApp() {
  try {
    console.log("🚀 Starting NOVA MD WhatsApp...");

    const auth = await useMultiFileAuthState("./session");

    authState = auth.state;
    saveCreds = auth.saveCreds;

    sock = makeWASocket({
      auth: authState,
      logger: P({ level: "silent" }),
      printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      console.log("WhatsApp connection:", connection);

      if (connection === "open") {
        connectionStatus = "connected";
        console.log("✅ NOVA MD connected to WhatsApp");
      }

      if (connection === "close") {
        connectionStatus = "disconnected";

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        console.log("❌ WhatsApp disconnected:", statusCode);

        if (statusCode !== DisconnectReason.loggedOut) {
          console.log("🔄 Reconnecting in 5 seconds...");

          setTimeout(() => {
            startWhatsApp();
          }, 5000);
        } else {
          console.log("❌ WhatsApp logged out");
          sock = null;
        }
      }
    });

  } catch (error) {
    console.error("❌ WhatsApp startup error:", error);

    connectionStatus = "error";

    setTimeout(() => {
      startWhatsApp();
    }, 5000);
  }
}


// ================================
// PAIRING CODE
// ================================

app.post("/pair", async (req, res) => {
  try {
    let number = String(req.body.number || "")
      .replace(/\D/g, "");

    console.log("📱 Pair request:", number);

    if (!number) {
      return res.status(400).json({
        success: false,
        error: "Enter WhatsApp number with country code"
      });
    }

    if (!sock || !authState) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp is still starting. Wait a few seconds and try again."
      });
    }

    if (authState.creds.registered) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp is already paired."
      });
    }

    if (pairingInProgress) {
      return res.status(429).json({
        success: false,
        error: "Pairing request already in progress. Please wait."
      });
    }

    pairingInProgress = true;

    console.log("🔑 Requesting pairing code...");

    const code = await sock.requestPairingCode(number);

    pairingInProgress = false;

    console.log("✅ Pairing code generated:", code);

    return res.json({
      success: true,
      code: code
    });

  } catch (error) {

    pairingInProgress = false;

    console.error("❌ Pairing error:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to generate pairing code"
    });
  }
});


// ================================
// STATUS
// ================================

app.get("/status", (req, res) => {
  res.json({
    online: connectionStatus === "connected",
    connected: connectionStatus === "connected",
    paired: !!authState?.creds?.registered,
    status: connectionStatus
  });
});


// ================================
// HOME
// ================================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});


// ================================
// START SERVER
// ================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 NOVA MD server running on port ${PORT}`);
  startWhatsApp();
});
