// Endpoint para recibir analytics de la App Android Wallet de SmartPasses
// POST /api/v1/appwallet/analytics
// Reenvía a providers configurados (Make, Zapier, etc.)

import { getProvider } from '../../../providers/index';

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

interface AnalyticsEvent {
  eventName: string;
  timestamp: string;
  deviceId: string;
  metadata?: Record<string, any>;
}

interface AppWalletConfig {
  isActive: boolean;
  provider: string;
  providerConfig: Record<string, any>;
  businessName?: string;
}

export async function onRequestPost(context: { request: Request; env: Env; waitUntil: (p: Promise<any>) => void }): Promise<Response> {
  const { request, env, waitUntil } = context;

  if (request.method !== 'POST') {
    return new Response('Expected POST', { status: 405 });
  }

  try {
    const data: AnalyticsEvent = await request.json();

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

    // Respuesta inmediata, procesamiento en background
    waitUntil((async () => {
      try {
        // 1. Guardar en estadísticas locales
        await saveAnalytics(kv, data, now);

        // 2. Reenviar a provider configurado
        const configRaw = await kv.get('appwallet:config');
        if (configRaw) {
          const config: AppWalletConfig = JSON.parse(configRaw);

          if (config.isActive && config.provider) {
            const provider = getProvider(config.provider);

            if (provider) {
              // Crear payload enriquecido para el provider
              const eventData = {
                type: `appwallet.${data.eventName}`,
                data: {
                  eventName: data.eventName,
                  deviceId: data.deviceId,
                  timestamp: data.timestamp || now,
                  metadata: data.metadata || {},
                }
              };

              const metadata = {
                webhookId: 'appwallet',
                businessName: config.businessName || 'AppWallet Analytics',
                receivedAt: now,
              };

              const result = await provider.execute(eventData, config.providerConfig, metadata);

              // Log del resultado
              await logForwardResult(kv, data.eventName, result, config.provider, now);
            }
          }
        }
      } catch (err: any) {
        console.error('Error procesando analytics:', err.message);
      }
    })());

    return new Response(JSON.stringify({
      status: 'success',
      received: data.eventName,
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

// Guardar analytics en KV
async function saveAnalytics(kv: KVNamespace, data: AnalyticsEvent, now: string): Promise<void> {
  // Eventos por dispositivo (últimos 50)
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

  // Estadísticas globales
  const statsKey = 'appwallet:stats';
  const statsRaw = await kv.get(statsKey);
  const stats = statsRaw ? JSON.parse(statsRaw) : {
    totalEvents: 0,
    uniqueDevices: [],
    eventCounts: {},
    lastUpdated: now,
  };

  stats.totalEvents++;
  stats.eventCounts[data.eventName] = (stats.eventCounts[data.eventName] || 0) + 1;

  if (!stats.uniqueDevices.includes(data.deviceId)) {
    stats.uniqueDevices.push(data.deviceId);
    if (stats.uniqueDevices.length > 1000) {
      stats.uniqueDevices = stats.uniqueDevices.slice(-1000);
    }
  }

  stats.lastUpdated = now;
  await kv.put(statsKey, JSON.stringify(stats));

  // Eventos recientes (últimos 100)
  const recentKey = 'appwallet:recent';
  const recentRaw = await kv.get(recentKey);
  const recentEvents: any[] = recentRaw ? JSON.parse(recentRaw) : [];

  recentEvents.unshift({
    eventName: data.eventName,
    deviceId: data.deviceId.substring(0, 8) + '...',
    timestamp: data.timestamp || now,
    receivedAt: now,
  });

  if (recentEvents.length > 100) recentEvents.length = 100;
  await kv.put(recentKey, JSON.stringify(recentEvents));
}

// Log de resultado del forward
async function logForwardResult(kv: KVNamespace, eventName: string, result: any, provider: string, now: string): Promise<void> {
  const logKey = 'appwallet:logs';
  const logRaw = await kv.get(logKey);
  const logs: any[] = logRaw ? JSON.parse(logRaw) : [];

  logs.unshift({
    time: now,
    event: eventName,
    provider,
    status: result.success ? 'ok' : 'error',
    message: result.message,
  });

  if (logs.length > 50) logs.length = 50;
  await kv.put(logKey, JSON.stringify(logs));
}

// GET: Ver estadísticas
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const kv = context.env.WEBHOOKS_KV;

  const [statsRaw, recentRaw, configRaw] = await Promise.all([
    kv.get('appwallet:stats'),
    kv.get('appwallet:recent'),
    kv.get('appwallet:config'),
  ]);

  const stats = statsRaw ? JSON.parse(statsRaw) : { totalEvents: 0, uniqueDevices: [], eventCounts: {} };
  const recentEvents = recentRaw ? JSON.parse(recentRaw) : [];
  const config = configRaw ? JSON.parse(configRaw) : null;

  return new Response(JSON.stringify({
    config: config ? {
      isActive: config.isActive,
      provider: config.provider,
      businessName: config.businessName,
    } : null,
    stats: {
      totalEvents: stats.totalEvents,
      uniqueDevicesCount: stats.uniqueDevices?.length || 0,
      eventCounts: stats.eventCounts,
      lastUpdated: stats.lastUpdated,
    },
    recentEvents: recentEvents.slice(0, 20),
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
