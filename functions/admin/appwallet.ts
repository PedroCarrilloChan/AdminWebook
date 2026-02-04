// Admin: Configurar y ver analytics de AppWallet
// GET /admin/appwallet — ver config y estadísticas
// POST /admin/appwallet — configurar provider de reenvío
// PUT /admin/appwallet — actualizar configuración
// DELETE /admin/appwallet — resetear analytics

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

interface AppWalletConfig {
  isActive: boolean;
  provider: string;
  providerConfig: Record<string, any>;
  businessName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// GET: Ver configuración y estadísticas
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url);
  const deviceId = url.searchParams.get('device');
  const kv = context.env.WEBHOOKS_KV;

  // Si piden un dispositivo específico
  if (deviceId) {
    const deviceKey = `appwallet:device:${deviceId}`;
    const deviceRaw = await kv.get(deviceKey);

    if (!deviceRaw) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Dispositivo no encontrado'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const events = JSON.parse(deviceRaw);
    return new Response(JSON.stringify({
      deviceId,
      totalEvents: events.length,
      events,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Dashboard completo
  const [configRaw, statsRaw, recentRaw, logsRaw] = await Promise.all([
    kv.get('appwallet:config'),
    kv.get('appwallet:stats'),
    kv.get('appwallet:recent'),
    kv.get('appwallet:logs'),
  ]);

  const config = configRaw ? JSON.parse(configRaw) : null;
  const stats = statsRaw ? JSON.parse(statsRaw) : {
    totalEvents: 0,
    uniqueDevices: [],
    eventCounts: {},
    lastUpdated: null,
  };
  const recentEvents = recentRaw ? JSON.parse(recentRaw) : [];
  const forwardLogs = logsRaw ? JSON.parse(logsRaw) : [];

  return new Response(JSON.stringify({
    config: config ? {
      isActive: config.isActive,
      provider: config.provider,
      providerConfig: config.providerConfig,
      businessName: config.businessName,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    } : null,
    webhookUrl: 'https://webhookadmin.pages.dev/api/v1/appwallet/analytics',
    summary: {
      totalEvents: stats.totalEvents,
      uniqueDevicesCount: stats.uniqueDevices?.length || 0,
      lastUpdated: stats.lastUpdated,
    },
    eventBreakdown: stats.eventCounts,
    recentEvents: recentEvents.slice(0, 50),
    forwardLogs: forwardLogs.slice(0, 20),
    devices: stats.uniqueDevices?.slice(-50) || [],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// POST: Crear configuración de reenvío
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const kv = context.env.WEBHOOKS_KV;

  try {
    const body = await context.request.json() as any;

    if (!body.provider) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Se requiere provider (make, zapier, custom_http, slack, n8n, whatsapp, chatbotbuilder)'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    const config: AppWalletConfig = {
      isActive: body.isActive !== undefined ? body.isActive : true,
      provider: body.provider,
      providerConfig: body.providerConfig || {},
      businessName: body.businessName || 'AppWallet Analytics',
      createdAt: now,
      updatedAt: now,
    };

    await kv.put('appwallet:config', JSON.stringify(config));

    return new Response(JSON.stringify({
      status: 'ok',
      message: 'Configuración creada',
      config: {
        ...config,
        providerConfig: '***', // No exponer config sensible
      },
      webhookUrl: 'https://webhookadmin.pages.dev/api/v1/appwallet/analytics',
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'JSON inválido'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// PUT: Actualizar configuración
export async function onRequestPut(context: { request: Request; env: Env }): Promise<Response> {
  const kv = context.env.WEBHOOKS_KV;

  try {
    const body = await context.request.json() as any;
    const existingRaw = await kv.get('appwallet:config');

    if (!existingRaw) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'No hay configuración existente. Usa POST para crear una.'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const existing: AppWalletConfig = JSON.parse(existingRaw);
    const now = new Date().toISOString();

    const updated: AppWalletConfig = {
      ...existing,
      isActive: body.isActive !== undefined ? body.isActive : existing.isActive,
      provider: body.provider || existing.provider,
      providerConfig: body.providerConfig || existing.providerConfig,
      businessName: body.businessName || existing.businessName,
      updatedAt: now,
    };

    await kv.put('appwallet:config', JSON.stringify(updated));

    return new Response(JSON.stringify({
      status: 'ok',
      message: 'Configuración actualizada',
      config: {
        isActive: updated.isActive,
        provider: updated.provider,
        businessName: updated.businessName,
        updatedAt: updated.updatedAt,
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'JSON inválido'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// DELETE: Resetear analytics (mantiene config)
export async function onRequestDelete(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url);
  const resetConfig = url.searchParams.get('config') === 'true';
  const kv = context.env.WEBHOOKS_KV;

  const toDelete = [
    'appwallet:stats',
    'appwallet:recent',
    'appwallet:logs',
  ];

  if (resetConfig) {
    toDelete.push('appwallet:config');
  }

  await Promise.all(toDelete.map(key => kv.delete(key)));

  return new Response(JSON.stringify({
    status: 'ok',
    message: resetConfig ? 'Analytics y configuración reseteados' : 'Analytics reseteados (config mantenida)',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
