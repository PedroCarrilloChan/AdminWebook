import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

function getDb(env: any) {
  if (getApps().length === 0) {
    initializeApp({
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID
    });
  }
  return getFirestore();
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const webhookId = pathParts[pathParts.length - 1];

  try {
    const db = getDb(env);

    // Obtener la configuración del webhook desde Firestore
    const webhookDocRef = doc(db, 'webhooks', webhookId);
    const webhookDocSnap = await getDoc(webhookDocRef);

    if (!webhookDocSnap.exists()) {
      console.error(`Configuración no encontrada para el webhookId: ${webhookId}`);
      return new Response('Configuración de Webhook no encontrada.', { status: 404 });
    }

    const config = webhookDocSnap.data();

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

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(config.secretKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
    const digest = `sha1=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    if (signature !== digest) {
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
    const userResponse = await fetch(`https://app.chatgptbuilder.io/api/users/find_by_custom_field?field_id=${config.customFieldId}&value=${passSerialNumber}`, {
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });
    const userData = await userResponse.json() as any;

    if (!userData.data || userData.data.length === 0) {
      console.log(`Usuario no encontrado para ${config.businessName} con CUF ${passSerialNumber}`);
      return new Response('Usuario no encontrado', { status: 404 });
    }

    const userId = userData.data[0].id;

    await fetch(`https://app.chatgptbuilder.io/api/users/${userId}/send/${config.flowId}`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });

    return new Response('Evento procesado con éxito.', { status: 200 });

  } catch (error: any) {
    console.error(`Error procesando webhook ${webhookId}:`, error.message);
    return new Response('Error interno del servidor.', { status: 500 });
  }
}
