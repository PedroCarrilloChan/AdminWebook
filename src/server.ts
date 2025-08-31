// La primera línea, como indicamos, для cargar las variables de entorno.
import 'dotenv/config'; 

import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import admin from 'firebase-admin';

// --- VALIDACIÓN DE VARIABLES DE ENTORNO ---
// Es una buena práctica asegurarse de que todas las variables necesarias están presentes al inicio.
const requiredEnvVars = ['FIREBASE_SERVICE_ACCOUNT_BASE64'];
for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
        // En un entorno de producción, esto detendrá la aplicación si falta una clave,
        // lo cual es bueno para evitar errores inesperados.
        throw new Error(`Error: La variable de entorno ${varName} no está definida.`);
    }
}

// --- CONFIGURACIÓN DE FIREBASE (DESDE .env) ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64!;
// Decodificamos la clave desde Base64
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(serviceAccountJson);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const webhooksCollection = db.collection('webhooks');
// ---------------------------------------------

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Middleware para parsear el cuerpo crudo de la petición con verificación de firma
app.use('/api/v1/webhook/:webhookId', express.raw({ 
  type: 'application/json',
  verify: async (req: any, res: any, buf: Buffer) => {
    try {
      // Obtener el webhookId de los parámetros
      const webhookId = req.params.webhookId;
      
      // Obtener la configuración del webhook desde Firestore
      const webhookDoc = await webhooksCollection.doc(webhookId).get();
      if (!webhookDoc.exists) {
        console.error(`Configuración no encontrada para el webhookId: ${webhookId}`);
        return res.status(404).send('Configuración de Webhook no encontrada.');
      }
      
      const config = webhookDoc.data()!;
      
      // Verificar la firma
      const signature = req.headers['x-passslot-signature'] as string;
      if (!signature) {
        console.error('No signature provided');
        return res.status(401).send('No signature provided');
      }

      const hmac = crypto.createHmac('sha1', config.secretKey);
      hmac.update(buf);
      const digest = `sha1=${hmac.digest('hex')}`;

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
        console.error('Invalid signature for webhookId:', webhookId);
        return res.status(403).send('Invalid signature');
      }
      
      // Guardar la configuración en el request para usarla después
      req.webhookConfig = config;
    } catch (error) {
      console.error('Error en verificación de firma:', error);
      return res.status(500).send('Error en verificación');
    }
  }
}));

// Middleware para parsear JSON, se usará para las rutas de administración.
app.use(express.json());

// Servir el archivo estático del frontend (nuestro panel de control)
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '.' });
});


// EL ENDPOINT GENÉRICO PARA RECIBIR TODOS LOS WEBHOOKS
app.post('/api/v1/webhook/:webhookId', async (req: any, res) => {
  const { webhookId } = req.params;
  const config = req.webhookConfig; // Ya verificada en el middleware

  try {
    // 1. Verificar si el webhook está activo
    if (!config.isActive) {
        console.log(`Intento de uso de webhook inactivo: ${webhookId}`);
        return res.status(403).send('Este webhook está inactivo.');
    }

    // 2. Procesar el evento
    const eventData = JSON.parse(req.body.toString());
    const { type, data } = eventData;
    console.log(`Evento recibido para ${config.businessName}:`, JSON.stringify(eventData, null, 2));

    // Manejo de la verificación inicial del webhook
    if (type === 'webhook.verify') {
      console.log('Manejando verificación del webhook con token:', data.token);
      return res.status(200).json({ token: data.token });
    }

    const passSerialNumber = data?.passSerialNumber;
    if (!passSerialNumber) {
      return res.status(400).send('passSerialNumber no encontrado');
    }

    // 3. Lógica de negocio: interactuar con la API externa
    const userResponse = await axios.get(`https://app.chatgptbuilder.io/api/users/find_by_custom_field?field_id=${config.customFieldId}&value=${passSerialNumber}`, {
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });

    if (!userResponse.data.data || userResponse.data.data.length === 0) {
      console.log(`Usuario no encontrado para ${config.businessName} con CUF ${passSerialNumber}`);
      return res.status(404).send('Usuario no encontrado');
    }
    const userId = userResponse.data.data[0].id;

    await axios.post(`https://app.chatgptbuilder.io/api/users/${userId}/send/${config.flowId}`, {}, {
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });

    res.status(200).send('Evento procesado con éxito.');

  } catch (error: any) {
    console.error(`Error procesando webhook ${webhookId}:`, error.response?.data || error.message);
    res.status(500).send('Error interno del servidor.');
  }
});

// =======================================================
// ===     API DE ADMINISTRACIÓN (CRUD) PARA EL FRONTEND ===
// =======================================================

// GET: Obtener todas las configuraciones de webhooks
app.get('/admin/webhooks', async (req, res) => {
    try {
        const snapshot = await webhooksCollection.get();
        const webhooks = snapshot.docs.map(doc => {
            const data = doc.data();
            // No enviar las claves secretas al frontend por seguridad
            return {
                id: doc.id,
                businessName: data.businessName,
                customFieldId: data.customFieldId,
                flowId: data.flowId,
                isActive: data.isActive
            };
        });
        res.status(200).json(webhooks);
    } catch (error) {
        console.error("Error al obtener webhooks:", error);
        res.status(500).send("Error al obtener las configuraciones.");
    }
});

// POST: Crear una nueva configuración de webhook
app.post('/admin/webhooks', async (req, res) => {
    try {
        const newWebhook = req.body;
        // Validación simple
        if (!newWebhook.businessName || !newWebhook.secretKey || !newWebhook.apiToken) {
            return res.status(400).send("Faltan campos requeridos.");
        }

        const docRef = await webhooksCollection.add(newWebhook);
        res.status(201).json({ id: docRef.id, ...newWebhook });

    } catch (error) {
        console.error("Error al crear webhook:", error);
        res.status(500).send("Error al crear la configuración.");
    }
});

// DELETE: Eliminar una configuración de webhook por su ID
app.delete('/admin/webhooks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const webhookDoc = webhooksCollection.doc(id);

        const doc = await webhookDoc.get();
        if (!doc.exists) {
            return res.status(404).send("Webhook no encontrado.");
        }

        await webhookDoc.delete();
        res.status(200).send(`Webhook ${id} eliminado correctamente.`);

    } catch (error) {
        console.error("Error al eliminar webhook:", error);
        res.status(500).send("Error al eliminar la configuración.");
    }
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en el puerto ${PORT} en modo ${process.env.NODE_ENV || 'development'}`);
});

