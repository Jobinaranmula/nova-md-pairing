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

const PORT = process.env.PORT || 3000;

let sock = null;
let connecting = false;

async function startWhatsApp() {
  if (connecting) return;
  connecting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState("./session");

    sock = makeWASocket({
      auth: state,
      logger: P({ level: "silent" }),
      printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        console.log("✅ NOVA MD connected to WhatsApp");
        connecting = false;
      }

      if (connection === "close") {
        connecting = false;

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        if (statusCode !== DisconnectReason.loggedOut) {
          console.log("🔄 Reconnecting...");
          setTimeout(startWhatsApp, 3000);
        } else {
          console.log("❌ WhatsApp logged out");
          sock = null;
        }
      }
    });

  } catch (err) {
    console.error("WhatsApp error:", err.message);
    connecting = false;
    setTimeout(startWhatsApp, 5000);
  }
}

// Pairing code request
app.post("/pair", async (req, res) => {
  try {
    let number = String(req.body.number || "")
      .replace(/\D/g, "");

    if (!number) {
      return res.status(400).json({
        success: false,
        error: "Enter WhatsApp number"
      });
    }

    if (!sock) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp connection is starting. Try again in a few seconds."
      });
    }

    if (sock.authState?.creds?.registered) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp is already paired."
      });
    }

    const code = await sock.requestPairingCode(number);

    res.json({
      success: true,
      code: code
    });

  } catch (err) {
    console.error("Pairing error:", err.message);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Status
app.get("/status", (req, res) => {
  res.json({
    online: !!sock,
    paired: !!sock?.authState?.creds?.registered
  });
});

// Start
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 NOVA MD server running on port ${PORT}`);
  startWhatsApp();
});
