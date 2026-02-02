import { getProvider } from '../../../providers/index';

interface Env {
  WEBHOOKS_KV: KVNamespace;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const webhookId = pathParts[pathParts.length - 1];

  try {
    const kv = env.WEBHOOKS_KV;

    // Obtener configuración del webhook desde KV
    const raw = await kv.get(`webhook:${webhookId}`);
    if (!raw) {
      console.error(`Configuración no encontrada para el webhookId: ${webhookId}`);
      return new Response('Configuración de Webhook no encontrada.', { status: 404 });
    }

    const config = JSON.parse(raw);

    const bodyText = await request.text();
    const eventData = JSON.parse(bodyText);
    const { type, data } = eventData;

    // Verificación de webhook (no requiere firma)
    if (type === 'webhook.verify') {
      return new Response(JSON.stringify({ token: data.token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verificar firma HMAC
    const signature = request.headers.get('x-passslot-signature');
    if (!signature) {
      return new Response('No signature provided', { status: 401 });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(config.secretKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
    const digest = `sha1=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    if (signature !== digest) {
      return new Response('Invalid signature', { status: 403 });
    }

    if (!config.isActive) {
      return new Response('Este webhook está inactivo.', { status: 403 });
    }

    // Retrocompatibilidad: webhooks sin campo provider se tratan como chatbotbuilder
    const providerName = config.provider || 'chatbotbuilder';
    const providerConfig = config.providerConfig || {
      apiToken: config.apiToken,
      customFieldId: config.customFieldId,
      flowId: config.flowId,
    };

    const provider = getProvider(providerName);
    if (!provider) {
      console.error(`Provider no encontrado: ${providerName}`);
      return new Response(`Provider "${providerName}" no soportado.`, { status: 400 });
    }

    console.log(`[${config.businessName}] Evento "${type}" → provider "${providerName}"`);

    const metadata = {
      webhookId,
      businessName: config.businessName,
      receivedAt: new Date().toISOString(),
    };

    const result = await provider.execute(eventData, providerConfig, metadata);

    if (!result.success) {
      console.error(`[${config.businessName}] Provider error: ${result.message}`);
      return new Response(result.message, { status: 422 });
    }

    console.log(`[${config.businessName}] OK: ${result.message}`);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(`Error procesando webhook ${webhookId}:`, error.message);
    return new Response('Error interno del servidor.', { status: 500 });
  }
}
