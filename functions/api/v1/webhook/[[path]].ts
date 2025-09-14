
import crypto from 'crypto';
import axios from 'axios';
import admin from 'firebase-admin';

// Inicializar Firebase Admin
if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64!;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const webhooksCollection = db.collection('webhooks');

export async function onRequestPost(context: any): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const webhookId = pathParts[pathParts.length - 1];

  try {
    // Obtener la configuración del webhook desde Firestore
    const webhookDoc = await webhooksCollection.doc(webhookId).get();
    if (!webhookDoc.exists) {
      console.error(`Configuración no encontrada para el webhookId: ${webhookId}`);
      return new Response('Configuración de Webhook no encontrada.', { status: 404 });
    }
    
    const config = webhookDoc.data()!;
    
    // Leer el body como texto
    const bodyText = await request.text();
    const eventData = JSON.parse(bodyText);
    const { type, data } = eventData;
    
    // Para verificación de webhook, no se requiere firma
    if (type === 'webhook.verify') {
      console.log('Manejando verificación del webhook con token:', data.token);
      return new Response(JSON.stringify({ token: data.token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Para otros eventos, verificar la firma
    const signature = request.headers.get('x-passslot-signature');
    if (!signature) {
      console.error('No signature provided for event type:', type);
      return new Response('No signature provided', { status: 401 });
    }

    const hmac = crypto.createHmac('sha1', config.secretKey);
    hmac.update(bodyText);
    const digest = `sha1=${hmac.digest('hex')}`;

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      console.error('Invalid signature for webhookId:', webhookId);
      return new Response('Invalid signature', { status: 403 });
    }

    // Verificar si el webhook está activo
    if (!config.isActive) {
      console.log(`Intento de uso de webhook inactivo: ${webhookId}`);
      return new Response('Este webhook está inactivo.', { status: 403 });
    }

    // Procesar el evento
    console.log(`Evento recibido para ${config.businessName}:`, JSON.stringify(eventData, null, 2));

    const passSerialNumber = data?.passSerialNumber;
    if (!passSerialNumber) {
      return new Response('passSerialNumber no encontrado', { status: 400 });
    }

    // Lógica de negocio: interactuar con la API externa
    const userResponse = await axios.get(`https://app.chatgptbuilder.io/api/users/find_by_custom_field?field_id=${config.customFieldId}&value=${passSerialNumber}`, {
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });

    if (!userResponse.data.data || userResponse.data.data.length === 0) {
      console.log(`Usuario no encontrado para ${config.businessName} con CUF ${passSerialNumber}`);
      return new Response('Usuario no encontrado', { status: 404 });
    }
    
    const userId = userResponse.data.data[0].id;

    await axios.post(`https://app.chatgptbuilder.io/api/users/${userId}/send/${config.flowId}`, {}, {
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });

    return new Response('Evento procesado con éxito.', { status: 200 });

  } catch (error: any) {
    console.error(`Error procesando webhook ${webhookId}:`, error.response?.data || error.message);
    return new Response('Error interno del servidor.', { status: 500 });
  }
}
