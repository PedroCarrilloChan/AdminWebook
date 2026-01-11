
interface Env {
  WEBHOOKS_KV: KVNamespace;
}

interface Webhook {
  id: string;
  businessName: string;
  secretKey: string;
  apiToken: string;
  customFieldId: string;
  flowId: string;
  isActive: boolean;
}

// Generar ID único para webhooks
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// GET: Obtener todas las configuraciones de webhooks
export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    const { WEBHOOKS_KV } = context.env;

    // Obtener la lista de IDs de webhooks
    const indexKey = 'webhooks:index';
    const indexData = await WEBHOOKS_KV.get(indexKey);
    const webhookIds: string[] = indexData ? JSON.parse(indexData) : [];

    // Obtener todos los webhooks
    const webhooks = await Promise.all(
      webhookIds.map(async (id) => {
        const webhookData = await WEBHOOKS_KV.get(`webhook:${id}`);
        if (!webhookData) return null;
        const webhook: Webhook = JSON.parse(webhookData);

        // No enviar las claves secretas al frontend por seguridad
        return {
          id: webhook.id,
          businessName: webhook.businessName,
          customFieldId: webhook.customFieldId,
          flowId: webhook.flowId,
          isActive: webhook.isActive
        };
      })
    );

    // Filtrar nulls (webhooks que fueron eliminados)
    const validWebhooks = webhooks.filter(w => w !== null);

    return new Response(JSON.stringify(validWebhooks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("Error al obtener webhooks:", error);
    return new Response("Error al obtener las configuraciones.", { status: 500 });
  }
}

// POST: Crear una nueva configuración de webhook
export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const { WEBHOOKS_KV } = context.env;
    const newWebhook = await context.request.json() as Omit<Webhook, 'id'>;

    // Validación simple
    if (!newWebhook.businessName || !newWebhook.secretKey || !newWebhook.apiToken) {
      return new Response("Faltan campos requeridos.", { status: 400 });
    }

    // Generar ID único
    const id = generateId();
    const webhook: Webhook = { id, ...newWebhook };

    // Guardar el webhook
    await WEBHOOKS_KV.put(`webhook:${id}`, JSON.stringify(webhook));

    // Actualizar el índice
    const indexKey = 'webhooks:index';
    const indexData = await WEBHOOKS_KV.get(indexKey);
    const webhookIds: string[] = indexData ? JSON.parse(indexData) : [];
    webhookIds.push(id);
    await WEBHOOKS_KV.put(indexKey, JSON.stringify(webhookIds));

    return new Response(JSON.stringify({ id, ...newWebhook }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("Error al crear webhook:", error);
    return new Response("Error al crear la configuración.", { status: 500 });
  }
}

// PUT: Actualizar una configuración de webhook existente
export async function onRequestPut(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const { WEBHOOKS_KV } = context.env;
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const updatedData = await context.request.json() as Omit<Webhook, 'id'>;

    // Validación simple
    if (!updatedData.businessName || !updatedData.secretKey || !updatedData.apiToken) {
      return new Response("Faltan campos requeridos.", { status: 400 });
    }

    // Verificar si el webhook existe
    const existingData = await WEBHOOKS_KV.get(`webhook:${id}`);
    if (!existingData) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    // Actualizar el webhook manteniendo el ID
    const webhook: Webhook = { id, ...updatedData };
    await WEBHOOKS_KV.put(`webhook:${id}`, JSON.stringify(webhook));

    return new Response(JSON.stringify(webhook), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("Error al actualizar webhook:", error);
    return new Response("Error al actualizar la configuración.", { status: 500 });
  }
}

// DELETE: Eliminar una configuración de webhook por su ID
export async function onRequestDelete(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const { WEBHOOKS_KV } = context.env;
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];

    // Verificar si el webhook existe
    const existingData = await WEBHOOKS_KV.get(`webhook:${id}`);
    if (!existingData) {
      return new Response("Webhook no encontrado.", { status: 404 });
    }

    // Eliminar el webhook
    await WEBHOOKS_KV.delete(`webhook:${id}`);

    // Actualizar el índice
    const indexKey = 'webhooks:index';
    const indexData = await WEBHOOKS_KV.get(indexKey);
    if (indexData) {
      const webhookIds: string[] = JSON.parse(indexData);
      const updatedIds = webhookIds.filter(wid => wid !== id);
      await WEBHOOKS_KV.put(indexKey, JSON.stringify(updatedIds));
    }

    return new Response(`Webhook ${id} eliminado correctamente.`, { status: 200 });
  } catch (error) {
    console.error("Error al eliminar webhook:", error);
    return new Response("Error al eliminar la configuración.", { status: 500 });
  }
}
