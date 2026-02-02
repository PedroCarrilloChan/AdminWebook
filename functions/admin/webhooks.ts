// CRUD de webhooks usando Cloudflare KV
// KV structure: key = "webhook:{id}", value = JSON string of webhook data
// Index key: "webhooks:index" = JSON array of webhook IDs

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

async function getIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get('webhooks:index');
  return raw ? JSON.parse(raw) : [];
}

async function saveIndex(kv: KVNamespace, index: string[]): Promise<void> {
  await kv.put('webhooks:index', JSON.stringify(index));
}

// GET: Obtener todas las configuraciones de webhooks
export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const index = await getIndex(kv);

    const webhooks = [];
    for (const id of index) {
      const raw = await kv.get(`webhook:${id}`);
      if (raw) {
        const data = JSON.parse(raw);
        webhooks.push({
          id,
          businessName: data.businessName,
          provider: data.provider || 'chatbotbuilder',
          providerConfig: data.providerConfig || {},
          isActive: data.isActive,
          lastEventAt: data.lastEventAt || null,
          lastEventType: data.lastEventType || null,
          lastEventStatus: data.lastEventStatus || null,
        });
      }
    }

    return new Response(JSON.stringify(webhooks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error al obtener webhooks:', error.message);
    return new Response('Error al obtener las configuraciones.', { status: 500 });
  }
}

// POST: Crear una nueva configuración de webhook
export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const body = await context.request.json() as any;

    if (!body.businessName || !body.secretKey || !body.provider) {
      return new Response('Faltan campos requeridos (businessName, secretKey, provider).', { status: 400 });
    }

    const id = generateId();
    const webhookData = {
      businessName: body.businessName,
      secretKey: body.secretKey,
      provider: body.provider,
      providerConfig: body.providerConfig || {},
      isActive: body.isActive !== undefined ? body.isActive : true,
      createdAt: new Date().toISOString(),
    };

    await kv.put(`webhook:${id}`, JSON.stringify(webhookData));

    // Update index
    const index = await getIndex(kv);
    index.push(id);
    await saveIndex(kv, index);

    return new Response(JSON.stringify({ id, ...webhookData, secretKey: undefined }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error al crear webhook:', error.message);
    return new Response('Error al crear la configuración.', { status: 500 });
  }
}

// PUT: Actualizar una configuración de webhook existente
export async function onRequestPut(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const body = await context.request.json() as any;

    if (!body.businessName || !body.provider) {
      return new Response('Faltan campos requeridos (businessName, provider).', { status: 400 });
    }

    const existing = await kv.get(`webhook:${id}`);
    if (!existing) {
      return new Response('Webhook no encontrado.', { status: 404 });
    }

    const current = JSON.parse(existing);
    const updateData = {
      ...current,
      businessName: body.businessName,
      provider: body.provider,
      providerConfig: body.providerConfig || {},
      isActive: body.isActive !== undefined ? body.isActive : true,
    };

    // Solo actualizar secretKey si se envía
    if (body.secretKey) {
      updateData.secretKey = body.secretKey;
    }

    await kv.put(`webhook:${id}`, JSON.stringify(updateData));

    return new Response(JSON.stringify({ id, ...updateData, secretKey: undefined }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error al actualizar webhook:', error.message);
    return new Response('Error al actualizar la configuración.', { status: 500 });
  }
}

// DELETE: Eliminar una configuración de webhook por su ID
export async function onRequestDelete(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];

    const existing = await kv.get(`webhook:${id}`);
    if (!existing) {
      return new Response('Webhook no encontrado.', { status: 404 });
    }

    await kv.delete(`webhook:${id}`);

    // Update index
    const index = await getIndex(kv);
    const newIndex = index.filter(i => i !== id);
    await saveIndex(kv, newIndex);

    return new Response(`Webhook ${id} eliminado correctamente.`, { status: 200 });
  } catch (error: any) {
    console.error('Error al eliminar webhook:', error.message);
    return new Response('Error al eliminar la configuración.', { status: 500 });
  }
}
