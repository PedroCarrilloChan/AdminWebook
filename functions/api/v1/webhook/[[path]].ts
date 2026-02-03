import { getProvider } from '../../../providers/index';

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

// Guarda un log de evento en KV (máximo 10 por webhook)
async function logEvent(kv: KVNamespace, webhookId: string, entry: any): Promise<void> {
  const logKey = `logs:${webhookId}`;
  const raw = await kv.get(logKey);
  const logs: any[] = raw ? JSON.parse(raw) : [];
  logs.unshift(entry);
  if (logs.length > 10) logs.length = 10;
  await kv.put(logKey, JSON.stringify(logs));
}

export async function onRequestPost(context: { request: Request; env: Env; waitUntil: (promise: Promise<any>) => void }): Promise<Response> {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname.replace(/\/+$/, '').split('/');
  const webhookId = pathParts[pathParts.length - 1];
  const now = new Date().toISOString();

  try {
    const kv = env.WEBHOOKS_KV;

    const raw = await kv.get(`webhook:${webhookId}`);
    if (!raw) {
      return new Response('Configuración de Webhook no encontrada.', { status: 404 });
    }

    const config = JSON.parse(raw);
    const bodyText = await request.text();
    const eventData = JSON.parse(bodyText);
    const { type, data } = eventData;

    // Verificación de webhook (no requiere firma) - respuesta inmediata
    const isVerify = type === 'webhook.verify' || (!type && data?.token);
    if (isVerify) {
      // Log en background
      waitUntil(logEvent(kv, webhookId, {
        time: now,
        type: 'webhook.verify',
        status: 'ok',
        message: 'Verificación de webhook exitosa',
      }));
      return new Response(data.token, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Verificar firma HMAC
    const signature = request.headers.get('x-passslot-signature');

    if (!signature) {
      waitUntil(logEvent(kv, webhookId, {
        time: now,
        type: type || 'unknown',
        status: 'error',
        message: 'Sin firma HMAC',
      }));
      return new Response('No signature provided', { status: 401 });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(config.secretKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
    const digest = `sha1=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    if (signature !== digest) {
      waitUntil(logEvent(kv, webhookId, {
        time: now,
        type: type || 'unknown',
        status: 'error',
        message: 'Firma HMAC inválida',
      }));
      return new Response('Invalid signature', { status: 403 });
    }

    if (!config.isActive) {
      waitUntil(logEvent(kv, webhookId, {
        time: now,
        type,
        status: 'blocked',
        message: 'Webhook inactivo',
      }));
      return new Response('Este webhook está inactivo.', { status: 403 });
    }

    const providerName = config.provider || 'chatbotbuilder';
    const providerConfig = config.providerConfig || {
      apiToken: config.apiToken,
      customFieldId: config.customFieldId,
      flowId: config.flowId,
    };

    const provider = getProvider(providerName);
    if (!provider) {
      waitUntil(logEvent(kv, webhookId, {
        time: now,
        type,
        status: 'error',
        message: `Provider "${providerName}" no encontrado`,
      }));
      return new Response(`Provider "${providerName}" no soportado.`, { status: 400 });
    }

    const metadata = {
      webhookId,
      businessName: config.businessName,
      receivedAt: now,
    };

    // OPTIMIZACIÓN: Ejecutar forwarding y logging en background
    // Respondemos inmediatamente a SmartPasses (200 OK)
    waitUntil((async () => {
      try {
        const result = await provider.execute(eventData, providerConfig, metadata);

        // Log y actualización en paralelo
        await Promise.all([
          logEvent(kv, webhookId, {
            time: now,
            type,
            status: result.success ? 'ok' : 'error',
            message: result.message,
            provider: providerName,
            passSerial: data?.passSerialNumber || data?.serialNumber || null,
          }),
          kv.put(`webhook:${webhookId}`, JSON.stringify({
            ...config,
            lastEventAt: now,
            lastEventType: type,
            lastEventStatus: result.success ? 'ok' : 'error',
          }))
        ]);
      } catch (err: any) {
        await logEvent(kv, webhookId, {
          time: now,
          type,
          status: 'error',
          message: `Error en provider: ${err.message}`,
          provider: providerName,
        });
      }
    })());

    // Respuesta inmediata - no esperamos al provider
    return new Response(JSON.stringify({ success: true, message: 'Evento recibido, procesando...' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(`Error procesando webhook ${webhookId}:`, error.message);
    return new Response('Error interno del servidor.', { status: 500 });
  }
}

// GET: Endpoint de diagnóstico
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url);
  const pathParts = url.pathname.replace(/\/+$/, '').split('/');
  const webhookId = pathParts[pathParts.length - 1];

  const raw = await context.env.WEBHOOKS_KV.get(`webhook:${webhookId}`);
  if (!raw) {
    return new Response(JSON.stringify({ status: 'error', message: 'Webhook no encontrado', webhookId }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = JSON.parse(raw);
  return new Response(JSON.stringify({
    status: 'ok',
    webhookId,
    businessName: config.businessName,
    provider: config.provider,
    isActive: config.isActive,
    lastEventAt: config.lastEventAt || null,
    lastEventType: config.lastEventType || null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
