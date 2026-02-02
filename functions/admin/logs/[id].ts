interface Env {
  WEBHOOKS_KV: KVNamespace;
}

// GET /admin/logs/:id — devuelve los últimos 10 eventos de un webhook
export async function onRequestGet(context: { params: { id: string }; env: Env }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const webhookId = context.params.id;

    const raw = await kv.get(`logs:${webhookId}`);
    const logs = raw ? JSON.parse(raw) : [];

    return new Response(JSON.stringify(logs), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response('Error al obtener logs.', { status: 500 });
  }
}
