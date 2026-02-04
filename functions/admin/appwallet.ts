// Admin: Ver analytics de AppWallet
// GET /admin/appwallet — estadísticas completas
// GET /admin/appwallet?device=xxx — eventos de un dispositivo específico

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

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

  // Estadísticas generales
  const [statsRaw, recentRaw] = await Promise.all([
    kv.get('appwallet:stats'),
    kv.get('appwallet:recent'),
  ]);

  const stats = statsRaw ? JSON.parse(statsRaw) : {
    totalEvents: 0,
    uniqueDevices: [],
    eventCounts: {},
    lastUpdated: null,
  };

  const recentEvents = recentRaw ? JSON.parse(recentRaw) : [];

  return new Response(JSON.stringify({
    summary: {
      totalEvents: stats.totalEvents,
      uniqueDevicesCount: stats.uniqueDevices?.length || 0,
      lastUpdated: stats.lastUpdated,
    },
    eventBreakdown: stats.eventCounts,
    recentEvents: recentEvents,
    devices: stats.uniqueDevices?.slice(-50) || [], // Últimos 50 dispositivos
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// DELETE: Limpiar todos los analytics (reset)
export async function onRequestDelete(context: { env: Env }): Promise<Response> {
  const kv = context.env.WEBHOOKS_KV;

  await Promise.all([
    kv.delete('appwallet:stats'),
    kv.delete('appwallet:recent'),
  ]);

  return new Response(JSON.stringify({
    status: 'ok',
    message: 'Analytics reseteados'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
