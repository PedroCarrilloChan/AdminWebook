interface Env {
  WEBHOOKS_KV: KVNamespace;
}

// GET /admin/webhooks/:id — Obtener un webhook específico
export async function onRequestGet(context: { params: { id: string }; env: Env }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const id = context.params.id;
    const raw = await kv.get(`webhook:${id}`);

    if (!raw) {
      return new Response('Webhook no encontrado.', { status: 404 });
    }

    const data = JSON.parse(raw);
    return new Response(JSON.stringify({
      id,
      businessName: data.businessName,
      provider: data.provider || 'chatbotbuilder',
      providerConfig: data.providerConfig || {},
      isActive: data.isActive,
      lastEventAt: data.lastEventAt || null,
      lastEventType: data.lastEventType || null,
      lastEventStatus: data.lastEventStatus || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response('Error al obtener webhook.', { status: 500 });
  }
}

// PUT /admin/webhooks/:id — Actualizar webhook
export async function onRequestPut(context: { params: { id: string }; env: Env; request: Request }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const id = context.params.id;
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

    if (body.secretKey) {
      updateData.secretKey = body.secretKey;
    }

    await kv.put(`webhook:${id}`, JSON.stringify(updateData));

    return new Response(JSON.stringify({ id, ...updateData, secretKey: undefined }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response('Error al actualizar webhook.', { status: 500 });
  }
}

// DELETE /admin/webhooks/:id — Eliminar webhook
export async function onRequestDelete(context: { params: { id: string }; env: Env }): Promise<Response> {
  try {
    const kv = context.env.WEBHOOKS_KV;
    const id = context.params.id;

    const existing = await kv.get(`webhook:${id}`);
    if (!existing) {
      return new Response('Webhook no encontrado.', { status: 404 });
    }

    await kv.delete(`webhook:${id}`);

    // Update index
    const indexRaw = await kv.get('webhooks:index');
    const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
    const newIndex = index.filter(i => i !== id);
    await kv.put('webhooks:index', JSON.stringify(newIndex));

    // Limpiar logs
    await kv.delete(`logs:${id}`);

    return new Response(JSON.stringify({ deleted: true, id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response('Error al eliminar webhook.', { status: 500 });
  }
}
