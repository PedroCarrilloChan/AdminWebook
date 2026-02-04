// Endpoint para recibir analytics de la App Android Wallet de SmartPasses
// POST /api/v1/appwallet/analytics

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

interface AnalyticsEvent {
  eventName: string;
  timestamp: string;
  deviceId: string;
  metadata?: Record<string, any>;
}

interface AnalyticsStats {
  totalEvents: number;
  uniqueDevices: string[];
  eventCounts: Record<string, number>;
  lastUpdated: string;
}

export async function onRequestPost(context: { request: Request; env: Env; waitUntil: (p: Promise<any>) => void }): Promise<Response> {
  const { request, env, waitUntil } = context;

  // Solo permitimos POST
  if (request.method !== 'POST') {
    return new Response('Expected POST', { status: 405 });
  }

  try {
    const data: AnalyticsEvent = await request.json();

    // Validar campos requeridos
    if (!data.eventName || !data.deviceId) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Se requiere eventName y deviceId'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    const kv = env.WEBHOOKS_KV;

    // Procesar en background para respuesta rápida
    waitUntil((async () => {
      // 1. Guardar evento en historial del dispositivo (últimos 50)
      const deviceKey = `appwallet:device:${data.deviceId}`;
      const deviceRaw = await kv.get(deviceKey);
      const deviceEvents: any[] = deviceRaw ? JSON.parse(deviceRaw) : [];

      deviceEvents.unshift({
        eventName: data.eventName,
        timestamp: data.timestamp || now,
        metadata: data.metadata || {},
        receivedAt: now,
      });

      if (deviceEvents.length > 50) deviceEvents.length = 50;
      await kv.put(deviceKey, JSON.stringify(deviceEvents));

      // 2. Actualizar estadísticas globales
      const statsKey = 'appwallet:stats';
      const statsRaw = await kv.get(statsKey);
      const stats: AnalyticsStats = statsRaw ? JSON.parse(statsRaw) : {
        totalEvents: 0,
        uniqueDevices: [],
        eventCounts: {},
        lastUpdated: now,
      };

      stats.totalEvents++;
      stats.eventCounts[data.eventName] = (stats.eventCounts[data.eventName] || 0) + 1;

      if (!stats.uniqueDevices.includes(data.deviceId)) {
        stats.uniqueDevices.push(data.deviceId);
        // Limitar a últimos 1000 dispositivos únicos
        if (stats.uniqueDevices.length > 1000) {
          stats.uniqueDevices = stats.uniqueDevices.slice(-1000);
        }
      }

      stats.lastUpdated = now;
      await kv.put(statsKey, JSON.stringify(stats));

      // 3. Guardar en lista global de eventos recientes (últimos 100)
      const recentKey = 'appwallet:recent';
      const recentRaw = await kv.get(recentKey);
      const recentEvents: any[] = recentRaw ? JSON.parse(recentRaw) : [];

      recentEvents.unshift({
        eventName: data.eventName,
        deviceId: data.deviceId.substring(0, 8) + '...', // Anonimizar parcialmente
        timestamp: data.timestamp || now,
        receivedAt: now,
      });

      if (recentEvents.length > 100) recentEvents.length = 100;
      await kv.put(recentKey, JSON.stringify(recentEvents));

    })());

    // Respuesta inmediata
    return new Response(JSON.stringify({
      status: 'success',
      received: data.eventName,
      deviceId: data.deviceId.substring(0, 8) + '...',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Invalid JSON'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// GET: Ver estadísticas (para debug/admin)
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const kv = context.env.WEBHOOKS_KV;

  const [statsRaw, recentRaw] = await Promise.all([
    kv.get('appwallet:stats'),
    kv.get('appwallet:recent'),
  ]);

  const stats = statsRaw ? JSON.parse(statsRaw) : { totalEvents: 0, uniqueDevices: [], eventCounts: {} };
  const recentEvents = recentRaw ? JSON.parse(recentRaw) : [];

  return new Response(JSON.stringify({
    stats: {
      totalEvents: stats.totalEvents,
      uniqueDevicesCount: stats.uniqueDevices?.length || 0,
      eventCounts: stats.eventCounts,
      lastUpdated: stats.lastUpdated,
    },
    recentEvents: recentEvents.slice(0, 20), // Solo últimos 20 para el resumen
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

// OPTIONS: CORS preflight
export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
