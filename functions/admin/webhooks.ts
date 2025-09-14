
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

// GET: Obtener todas las configuraciones de webhooks
export async function onRequestGet(context: any): Promise<Response> {
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
    
    return new Response(JSON.stringify(webhooks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("Error al obtener webhooks:", error);
    return new Response("Error al obtener las configuraciones.", { status: 500 });
  }
}

// POST: Crear una nueva configuración de webhook
export async function onRequestPost(context: any): Promise<Response> {
  try {
    const newWebhook = await context.request.json();
    
    // Validación simple
    if (!newWebhook.businessName || !newWebhook.secretKey || !newWebhook.apiToken) {
      return new Response("Faltan campos requeridos.", { status: 400 });
    }

    const docRef = await webhooksCollection.add(newWebhook);
    
    return new Response(JSON.stringify({ id: docRef.id, ...newWebhook }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("Error al crear webhook:", error);
    return new Response("Error al crear la configuración.", { status: 500 });
  }
}

// PUT: Actualizar una configuración de webhook existente
export async function onRequestPut(context: any): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const updatedData = await context.request.json();
    
    // Validación simple
    if (!updatedData.businessName || !updatedData.secretKey || !updatedData.apiToken) {
      return new Response("Faltan campos requeridos.", { status: 400 });
    }

    const webhookDoc = webhooksCollection.doc(id);
    const doc = await webhookDoc.get();
    
    if (!doc.exists) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    await webhookDoc.update(updatedData);
    
    return new Response(JSON.stringify({ id, ...updatedData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("Error al actualizar webhook:", error);
    return new Response("Error al actualizar la configuración.", { status: 500 });
  }
}

// DELETE: Eliminar una configuración de webhook por su ID
export async function onRequestDelete(context: any): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const webhookDoc = webhooksCollection.doc(id);

    const doc = await webhookDoc.get();
    if (!doc.exists) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    await webhookDoc.delete();
    
    return new Response(`Webhook ${id} eliminado correctamente.`, { status: 200 });
  } catch (error) {
    console.error("Error al eliminar webhook:", error);
    return new Response("Error al eliminar la configuración.", { status: 500 });
  }
}
