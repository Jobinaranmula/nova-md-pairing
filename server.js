const express = require("express");
const cors = require("cors");
const P = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 8080;
const SESSION_DIR = "./session";

let sock = null;
let authState = null;
let saveCreds = null;

let connectionStatus = "starting";
let pairingInProgress = false;
let reconnectTimer = null;
let starting = false;


// ========================================
// START WHATSAPP
// ========================================

async function startWhatsApp() {

  if (starting) return;

  starting = true;

  try {

    console.log("🚀 Starting NOVA MD WhatsApp...");

    const auth = await useMultiFileAuthState(SESSION_DIR);

    authState = auth.state;
    saveCreds = auth.saveCreds;

    sock = makeWASocket({

      auth: authState,

      logger: P({
        level: "silent"
      }),

      browser: Browsers.ubuntu("NOVA MD"),

      printQRInTerminal: false,

      markOnlineOnConnect: false,

      syncFullHistory: false,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 25000

    });


    // SAVE AUTH
    sock.ev.on("creds.update", saveCreds);


    // ====================================
    // CONNECTION UPDATE
    // ====================================

    sock.ev.on("connection.update", async (update) => {

      const {
        connection,
        lastDisconnect
      } = update;


      if (connection) {
        console.log("📡 WhatsApp connection:", connection);
      }


      // CONNECTING
      if (connection === "connecting") {

        connectionStatus = "connecting";

        console.log("🔄 Connecting to WhatsApp...");

      }


      // CONNECTED
      if (connection === "open") {

        connectionStatus = "connected";

        console.log("================================");
        console.log("✅ NOVA MD CONNECTED");
        console.log("================================");

      }


      // CLOSED
      if (connection === "close") {

        connectionStatus = "disconnected";

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        console.log(
          "❌ WhatsApp disconnected:",
          statusCode
        );


        sock = null;


        // LOGGED OUT
        if (
          statusCode === DisconnectReason.loggedOut
        ) {

          console.log(
            "❌ WhatsApp logged out."
          );

          connectionStatus = "logged_out";

          return;
        }


        // RECONNECT
        console.log(
          "🔄 Reconnecting in 5 seconds..."
        );


        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }


        reconnectTimer = setTimeout(() => {

          reconnectTimer = null;

          startWhatsApp();

        }, 5000);

      }

    });


  } catch (error) {

    console.error(
      "❌ WhatsApp startup error:",
      error
    );

    connectionStatus = "error";

    sock = null;


    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }


    reconnectTimer = setTimeout(() => {

      reconnectTimer = null;

      startWhatsApp();

    }, 5000);

  } finally {

    starting = false;

  }

}


// ========================================
// WAIT FOR SOCKET
// ========================================

async function waitForSocket(timeout = 15000) {

  const start = Date.now();

  while (Date.now() - start < timeout) {

    if (sock && authState) {
      return true;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 500)
    );

  }

  return false;
}


// ========================================
// PAIRING CODE
// ========================================

app.post("/pair", async (req, res) => {

  try {

    let number = String(
      req.body.number || ""
    ).replace(/\D/g, "");


    console.log(
      "📱 Pair request:",
      number
    );


    // CHECK NUMBER
    if (!number) {

      return res.status(400).json({

        success: false,

        error:
          "Enter WhatsApp number with country code"

      });

    }


    // WAIT FOR SERVER
    const ready = await waitForSocket();


    if (!ready) {

      return res.status(503).json({

        success: false,

        error:
          "WhatsApp server is starting. Try again in a few seconds."

      });

    }


    // ALREADY CONNECTED
    if (
      authState?.creds?.registered
    ) {

      return res.status(400).json({

        success: false,

        error:
          "WhatsApp is already paired."

      });

    }


    // ALREADY REQUESTING
    if (pairingInProgress) {

      return res.status(429).json({

        success: false,

        error:
          "Pairing request already in progress. Please wait."

      });

    }


    pairingInProgress = true;


    console.log(
      "⏳ Preparing pairing connection..."
    );


    /*
     * Give the WhatsApp socket a moment
     * to establish its WebSocket connection.
     */

    await new Promise(resolve =>
      setTimeout(resolve, 1500)
    );


    if (!sock) {

      pairingInProgress = false;

      return res.status(503).json({

        success: false,

        error:
          "WhatsApp connection was lost. Try again."

      });

    }


    console.log(
      "🔑 Requesting pairing code..."
    );


    const code =
      await sock.requestPairingCode(number);


    pairingInProgress = false;


    console.log(
      "================================"
    );

    console.log(
      "🔐 PAIRING CODE:",
      code
    );

    console.log(
      "================================"
    );


    return res.json({

      success: true,

      code: code

    });


  } catch (error) {

    pairingInProgress = false;


    console.error(
      "❌ Pairing error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Failed to generate pairing code"

    });

  }

});


// ========================================
// STATUS
// ========================================

app.get("/status", (req, res) => {

  res.json({

    online:
      connectionStatus === "connected",

    connected:
      connectionStatus === "connected",

    paired:
      !!authState?.creds?.registered,

    status:
      connectionStatus

  });

});


// ========================================
// HOME
// ========================================

app.get("/", (req, res) => {

  res.sendFile(
    __dirname + "/index.html"
  );

});


// ========================================
// HEALTH
// ========================================

app.get("/health", (req, res) => {

  res.json({

    ok: true,

    service: "NOVA MD",

    whatsapp:
      connectionStatus

  });

});


// ========================================
// SERVER
// ========================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `🌐 NOVA MD server running on port ${PORT}`
    );

    startWhatsApp();

  }
);
