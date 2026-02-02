// CRUD de webhooks usando Cloudflare KV
// GET /admin/webhooks — listar todos
// POST /admin/webhooks — crear nuevo
// PUT/DELETE van en webhooks/[id].ts

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

// GET: Obtener todas las configuraciones de webhooks
export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const indexRaw = await kv.get('webhooks:index');
    const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];

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

    const indexRaw = await kv.get('webhooks:index');
    const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
    index.push(id);
    await kv.put('webhooks:index', JSON.stringify(index));

    return new Response(JSON.stringify({ id, ...webhookData, secretKey: undefined }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response('Error al crear la configuración.', { status: 500 });
  }
}
