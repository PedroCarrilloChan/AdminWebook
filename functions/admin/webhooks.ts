import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, addDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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

// GET: Obtener todas las configuraciones de webhooks
export async function onRequestGet(context: any): Promise<Response> {
  try {
    const db = getDb(context.env);
    const webhooksCollection = collection(db, 'webhooks');
    const snapshot = await getDocs(webhooksCollection);
    const webhooks = snapshot.docs.map(docSnapshot => {
      const data = docSnapshot.data();
      return {
        id: docSnapshot.id,
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
    const db = getDb(context.env);
    const webhooksCollection = collection(db, 'webhooks');
    const newWebhook = await context.request.json();

    if (!newWebhook.businessName || !newWebhook.secretKey || !newWebhook.apiToken) {
      return new Response("Faltan campos requeridos.", { status: 400 });
    }

    const docRef = await addDoc(webhooksCollection, newWebhook);

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
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const updatedData = await context.request.json();

    if (!updatedData.businessName || !updatedData.secretKey || !updatedData.apiToken) {
      return new Response("Faltan campos requeridos.", { status: 400 });
    }

    const webhookDocRef = doc(db, 'webhooks', id);
    const docSnap = await getDoc(webhookDocRef);

    if (!docSnap.exists()) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    await updateDoc(webhookDocRef, updatedData);

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
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const webhookDocRef = doc(db, 'webhooks', id);

    const docSnap = await getDoc(webhookDocRef);
    if (!docSnap.exists()) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    await deleteDoc(webhookDocRef);

    return new Response(`Webhook ${id} eliminado correctamente.`, { status: 200 });
  } catch (error) {
    console.error("Error al eliminar webhook:", error);
    return new Response("Error al eliminar la configuración.", { status: 500 });
  }
}
