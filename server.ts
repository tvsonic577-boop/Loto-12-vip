import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Payment } from 'mercadopago';
import admin from 'firebase-admin';
import fs from 'fs';

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar config do Firebase
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));

// Inicializar Firebase Admin
let db: Firestore;

function initializeFirebase() {
  try {
    console.log("[FIREBASE] Iniciando roteamento de conexão...");
    
    // Obter ou inicializar o App principal
    let app;
    if (admin.apps.length === 0) {
      app = admin.initializeApp({
        projectId: firebaseConfig.projectId
      });
      console.log(`[FIREBASE] App inicializado. Projeto: ${firebaseConfig.projectId}`);
    } else {
      app = admin.app();
    }

    const databaseId = firebaseConfig.firestoreDatabaseId;
    const dbId = (databaseId && databaseId !== "(default)") ? databaseId : undefined;
    
    console.log(`[FIREBASE] Conectando ao Firestore (DB: ${dbId || "(default)"})...`);
    
    // Usar getFirestore do subpacote firebase-admin/firestore
    db = getFirestore(app, dbId);
    
    if (!db) {
      console.error("[FIREBASE] ERRO: getFirestore retornou uma instância nula.");
      return;
    }

    console.log("[FIREBASE] Instância do Firestore configurada.");

    // Testar conexão de forma não bloqueante
    db.listCollections()
      .then(() => console.log("[FIREBASE] Conexão administrativa testada com sucesso."))
      .catch((err) => {
        console.warn("[FIREBASE] Aviso de permissão/conexão:", err.message);
        if (err.message.includes("PERMISSION_DENIED")) {
          console.error("[FIREBASE] ERRO DE PERMISSÃO: Verifique se o Database ID está correto e se o Service Account tem permissão 'Cloud Datastore User'.");
        }
      });

  } catch (e: any) {
    console.error("[FIREBASE] ERRO FATAL NA INICIALIZAÇÃO:", e.message);
    if (e.stack) console.error(e.stack);
  }
}

initializeFirebase();

async function startServer() {
  console.log("[SERVER] Iniciando servidor Express...");
  try {
    const app = express();
    const PORT = 3000;

    app.use(express.json());

    // Configurar Mercado Pago
    const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
    if (!mpAccessToken) {
      console.warn("[SERVER] AVISO: MERCADO_PAGO_ACCESS_TOKEN não definido!");
    }

    const mpClient = new MercadoPagoConfig({ 
      accessToken: mpAccessToken,
      options: { timeout: 10000 }
    });
    const paymentClient = new Payment(mpClient);

    // API de Health Check aprimorada para diagnóstico
    app.get("/api/health", async (req, res) => {
      let firestoreStatus = "unknown";
      try {
        if (typeof db !== "undefined" && db !== null) {
          const testColl = db.collection('_health_check');
          await testColl.limit(1).get();
          firestoreStatus = "connected";
        } else {
          firestoreStatus = "not_initialized";
        }
      } catch (e: any) {
        console.error("[HEALTH] Erro ao testar Firestore:", e.message);
        firestoreStatus = `error: ${e.message}`;
      }

      res.json({ 
        status: "ok", 
        firestore: firestoreStatus,
        project: firebaseConfig.projectId,
        database: firebaseConfig.firestoreDatabaseId || "(default)"
      });
    });

    // API: Criar Pagamento PIX
    app.post("/api/create-pix", async (req, res) => {
      try {
        const { betId, amount, userEmail, userName, cpf } = req.body;

      if (!betId || !amount || !userEmail) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validar CPF básico para o Mercado Pago (deve ter exatamente 11 dígitos)
      let cleanCpf = cpf ? cpf.replace(/\D/g, '') : '';
      if (cleanCpf.length > 11) cleanCpf = cleanCpf.substring(0, 11);
      while (cleanCpf.length < 11) cleanCpf += '0';

      const firstName = userName.split(' ')[0] || 'Cliente';
      const lastName = userName.split(' ').slice(1).join(' ') || 'VIP';

      const paymentData: any = {
        body: {
          transaction_amount: Number(amount),
          description: `Aposta Loteria VIP - ${betId}`,
          payment_method_id: 'pix',
          payer: {
            email: userEmail,
            first_name: firstName,
            last_name: lastName,
            identification: {
              type: 'CPF',
              number: cleanCpf
            }
          },
          external_reference: betId
        }
      };

      // Só adicionar a URL de notificação se o APP_URL estiver configurado e for uma URL válida
      if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
        let baseUrl = process.env.APP_URL.replace(/\/$/, '');
        // Se o usuário colocou o caminho completo, removemos para não duplicar
        baseUrl = baseUrl.replace(/\/api\/webhook\/mercadopago$/, '');
        
        const notifyUrl = `${baseUrl}/api/webhook/mercadopago`;
        paymentData.body.notification_url = notifyUrl;
        console.log("URL DE NOTIFICAÇÃO ENVIADA:", notifyUrl);
      } else {
        console.warn("AVISO: APP_URL não configurada ou inválida. O Webhook NÃO funcionará.");
      }

      console.log("Enviando solicitação ao Mercado Pago...");
      const result = await paymentClient.create(paymentData);
      console.log("Pagamento criado com sucesso ID:", result.id);
      
      res.json({
        id: result.id,
        status: result.status,
        qr_code: result.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: result.point_of_interaction?.transaction_data?.qr_code_base64,
        ticket_url: result.point_of_interaction?.transaction_data?.ticket_url,
      });

    } catch (error: any) {
      console.error("ERRO MERCADO PAGO DETALHADO:", {
        message: error.message,
        status: error.status,
        cause: error.cause,
        api_response: error.api_response
      });
      res.status(500).json({ 
        error: error.message || "Internal Server Error",
        details: error.cause || error.message
      });
    }
  });

  // API: Webhook do Mercado Pago (POST para notificações reais)
  app.post("/api/webhook/mercadopago", async (req, res) => {
    console.log("WEBHOOK RECEBIDO (POST):", JSON.stringify(req.body));
    const { action, data, type } = req.body;
    const paymentId = data?.id || req.query.id || req.body.id;

    // Responder 200 imediatamente
    res.sendStatus(200);

    try {
      if (type === 'payment' || action?.includes('payment')) {
        if (!paymentId) return;
        await processPaymentUpdate(paymentId);
      }
    } catch (error) {
      console.error("ERRO PROCESSANDO WEBHOOK:", error);
    }
  });

  // API: Verificar pagamento manualmente
  app.get("/api/check-payment/:id", async (req, res) => {
    try {
      const paymentId = req.params.id;
      if (!paymentId) return res.status(400).json({ error: "Missing payment ID" });

      const status = await processPaymentUpdate(paymentId);
      res.json({ status });
    } catch (error: any) {
      console.error("ERRO CHECK PAYMENT:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Função auxiliar para processar atualização de pagamento
  async function processPaymentUpdate(paymentId: string | number) {
    console.log(`[PAYMENT] Verificando status do pagamento ${paymentId}...`);
    const paymentInfo = await paymentClient.get({ id: String(paymentId) });
    console.log(`[PAYMENT] Status do pagamento ${paymentId}: ${paymentInfo.status}`);

    if (paymentInfo.status === 'approved') {
      const betId = paymentInfo.external_reference;
      console.log(`[PAYMENT] Referência externa (betId): ${betId}`);
      
      if (betId) {
        if (!db) {
          console.warn("[PAYMENT] db não estava pronto. Tentando reinicializar...");
          initializeFirebase();
          if (!db) {
            console.error("[PAYMENT] CRÍTICO: db continua nulo após tentativa de reinicialização.");
            throw new Error("Sistema de banco de dados indisponível no momento.");
          }
        }
        
        console.log(`[PAYMENT] Tentando acessar Firestore: Projeto=${firebaseConfig.projectId}, Database=${firebaseConfig.firestoreDatabaseId || '(default)'}, Coleção=bets, Doc=${betId}`);
        const betRef = db.collection('bets').doc(betId);
        const betDoc = await betRef.get();
        
        if (!betDoc.exists) {
          console.error(`[PAYMENT] ERRO: Aposta ${betId} não encontrada no Firestore!`);
          return paymentInfo.status;
        }

        if (betDoc.data()?.status === 'pending') {
          console.log(`[PAYMENT] Confirmando aposta ${betId} no Firestore...`);
          await betRef.update({
            status: 'active',
            updatedAt: FieldValue.serverTimestamp()
          });
          console.log(`[PAYMENT] Aposta ${betId} ATIVADA com sucesso.`);
        } else {
          console.log(`[PAYMENT] Aposta ${betId} já está com status: ${betDoc.data()?.status}`);
        }
      }
    }
    return paymentInfo.status;
  }
  
  // ROTA DE TESTE: Para você verificar se o app está acessível
  app.get("/api/webhook/mercadopago", (req, res) => {
    res.json({ status: "ok", message: "Webhook endpoint está ativo! Use este link no APP_URL das configurações." });
  });

  app.get("/api/ping-firestore", async (req, res) => {
    try {
      console.log("[DIAG] Tentando ping no Firestore...");
      const snap = await db.collection('bets').limit(1).get();
      res.json({ ok: true, docs: snap.size, db: firebaseConfig.firestoreDatabaseId || '(default)' });
    } catch (e: any) {
      console.error("[DIAG] Falha no ping:", e);
      res.status(500).json({ 
        ok: false, 
        error: e.message, 
        code: e.code, 
        details: e.details,
        path: `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId || '(default)'}`
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
  });
  } catch (error) {
    console.error("[SERVER] FALHA AO INICIAR SERVIDOR:", error);
    process.exit(1);
  }
}

startServer();
