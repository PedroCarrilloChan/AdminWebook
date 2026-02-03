import { getProvider } from '../../../providers/index';

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

// Guarda un log de evento en KV (máximo 10 por webhook)
async function logEvent(kv: KVNamespace, webhookId: string, entry: any): Promise<void> {
  const logKey = `logs:${webhookId}`;
  const raw = await kv.get(logKey);
  const logs: any[] = raw ? JSON.parse(raw) : [];
  logs.unshift(entry); // Más reciente primero
  if (logs.length > 10) logs.length = 10;
  await kv.put(logKey, JSON.stringify(logs));
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
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

    // Verificación de webhook (no requiere firma)
    // PassSlot puede enviar webhook.verify con o sin campo "type"
    const isVerify = type === 'webhook.verify' || (!type && data?.token);
    if (isVerify) {
      await logEvent(kv, webhookId, {
        time: now,
        type: 'webhook.verify',
        status: 'ok',
        message: 'Verificación de webhook exitosa',
      });
      // PassSlot espera el token de vuelta como texto plano
      return new Response(data.token, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Verificar firma HMAC
    // PassSlot envía: X-Passslot-Signature (puede variar capitalización)
    const signature = request.headers.get('x-passslot-signature');

    // Log de diagnóstico: registrar headers relevantes para debug
    const allHeaders: Record<string, string> = {};
    request.headers.forEach((v, k) => { allHeaders[k] = v; });

    if (!signature) {
      await logEvent(kv, webhookId, {
        time: now,
        type: type || 'unknown',
        status: 'error',
        message: `Sin firma HMAC. Headers recibidos: ${Object.keys(allHeaders).join(', ')}`,
      });
      return new Response('No signature provided', { status: 401 });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(config.secretKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
    const digest = `sha1=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    if (signature !== digest) {
      await logEvent(kv, webhookId, {
        time: now,
        type: type || 'unknown',
        status: 'error',
        message: `Firma HMAC inválida. Recibido: ${signature.substring(0, 20)}... Esperado: ${digest.substring(0, 20)}...`,
      });
      return new Response('Invalid signature', { status: 403 });
    }

    if (!config.isActive) {
      await logEvent(kv, webhookId, {
        time: now,
        type,
        status: 'blocked',
        message: 'Webhook inactivo',
      });
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
      await logEvent(kv, webhookId, {
        time: now,
        type,
        status: 'error',
        message: `Provider "${providerName}" no encontrado`,
      });
      return new Response(`Provider "${providerName}" no soportado.`, { status: 400 });
    }

    const metadata = {
      webhookId,
      businessName: config.businessName,
      receivedAt: now,
    };

    const result = await provider.execute(eventData, providerConfig, metadata);

    // Log del resultado (éxito o fallo del provider)
    await logEvent(kv, webhookId, {
      time: now,
      type,
      status: result.success ? 'ok' : 'error',
      message: result.message,
      provider: providerName,
      passSerial: data?.passSerialNumber || null,
    });

    // Actualizar último evento en el webhook config
    const updated = { ...config, lastEventAt: now, lastEventType: type, lastEventStatus: result.success ? 'ok' : 'error' };
    await kv.put(`webhook:${webhookId}`, JSON.stringify(updated));

    if (!result.success) {
      return new Response(result.message, { status: 422 });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(`Error procesando webhook ${webhookId}:`, error.message);
    // Intentar loguear el error
    try {
      await env.WEBHOOKS_KV.put(`logs:${webhookId}`, JSON.stringify([{
        time: now,
        type: 'system',
        status: 'error',
        message: `Error interno: ${error.message}`,
      }]));
    } catch (_) {}
    return new Response('Error interno del servidor.', { status: 500 });
  }
}

// GET: Endpoint de diagnóstico para verificar que la ruta funciona
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
