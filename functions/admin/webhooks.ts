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
        provider: data.provider || 'chatbotbuilder',
        providerConfig: data.providerConfig || {
          customFieldId: data.customFieldId,
          flowId: data.flowId,
        },
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
    const body = await context.request.json();

    if (!body.businessName || !body.secretKey || !body.provider) {
      return new Response("Faltan campos requeridos (businessName, secretKey, provider).", { status: 400 });
    }

    const webhookData = {
      businessName: body.businessName,
      secretKey: body.secretKey,
      provider: body.provider,
      providerConfig: body.providerConfig || {},
      isActive: body.isActive !== undefined ? body.isActive : true,
      createdAt: new Date().toISOString(),
    };

    const docRef = await addDoc(webhooksCollection, webhookData);

    return new Response(JSON.stringify({ id: docRef.id, ...webhookData, secretKey: undefined }), {
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
    const body = await context.request.json();

    if (!body.businessName || !body.provider) {
      return new Response("Faltan campos requeridos (businessName, provider).", { status: 400 });
    }

    const webhookDocRef = doc(db, 'webhooks', id);
    const docSnap = await getDoc(webhookDocRef);

    if (!docSnap.exists()) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    const updateData: any = {
      businessName: body.businessName,
      provider: body.provider,
      providerConfig: body.providerConfig || {},
      isActive: body.isActive !== undefined ? body.isActive : true,
    };

    // Solo actualizar secretKey si se envía (permite no cambiarla)
    if (body.secretKey) {
      updateData.secretKey = body.secretKey;
    }

    await updateDoc(webhookDocRef, updateData);

    return new Response(JSON.stringify({ id, ...updateData, secretKey: undefined }), {
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
