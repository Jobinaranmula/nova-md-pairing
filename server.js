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
let connecting = false;

async function startWhatsApp() {
  if (connecting) return;

  connecting = true;

  try {
    const auth = await useMultiFileAuthState("./session");

    authState = auth.state;
    saveCreds = auth.saveCreds;

    sock = makeWASocket({
      auth: authState,
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["NOVA MD", "Chrome", "1.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      console.log("WhatsApp connection:", connection);

      if (connection === "connecting") {
        connectionStatus = "connecting";
      }

      if (connection === "open") {
        connectionStatus = "open";
        connecting = false;
        console.log("✅ NOVA MD connected to WhatsApp");
      }

      if (connection === "close") {
        connectionStatus = "closed";
        connecting = false;

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        if (statusCode !== DisconnectReason.loggedOut) {
          console.log("🔄 Reconnecting...");
          sock = null;

          setTimeout(() => {
            startWhatsApp();
          }, 3000);
        } else {
          console.log("❌ WhatsApp logged out");
          sock = null;
        }
      }
    });

    connecting = false;

  } catch (err) {
    console.error("❌ WhatsApp startup error:", err);

    sock = null;
    connecting = false;
    connectionStatus = "error";

    setTimeout(startWhatsApp, 5000);
  }
}


// ===============================
// PAIRING CODE
// ===============================

app.post("/pair", async (req, res) => {
  try {
    let number = String(req.body.number || "")
      .replace(/\D/g, "");

    console.log("📱 Pairing request:", number);

    if (!number) {
      return res.status(400).json({
        success: false,
        error: "Enter WhatsApp number with country code."
      });
    }

    if (!sock) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp socket is not ready yet. Try again in a few seconds."
      });
    }

    if (!authState) {
      return res.status(503).json({
        success: false,
        error: "Authentication state is not ready."
      });
    }

    if (authState.creds.registered) {
      return res.status(400).json({
        success: false,
        error: "This WhatsApp session is already paired."
      });
    }

    console.log("🔑 Requesting WhatsApp pairing code...");

    const code = await sock.requestPairingCode(number);

    console.log("✅ Pairing code generated:", code);

    return res.json({
      success: true,
      code: code
    });

  } catch (err) {

    console.error(
      "❌ Pairing error:",
      err?.message || err
    );

    return res.status(500).json({
      success: false,
      error: err?.message || "Pairing code generation failed."
    });
  }
});


// ===============================
// STATUS
// ===============================

app.get("/status", (req, res) => {
  res.json({
    online: !!sock,
    connection: connectionStatus,
    paired: !!authState?.creds?.registered
  });
});


// ===============================
// HOME
// ===============================

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "NOVA MD Pairing",
    whatsapp: connectionStatus
  });
});


// ===============================
// START SERVER
// ===============================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 NOVA MD server running on port ${PORT}`);
  console.log(`🌐 Port: ${PORT}`);

  startWhatsApp();
});
