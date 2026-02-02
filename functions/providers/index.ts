// Registry central de providers
// Cada provider define: nombre, label, schema del formulario, y función execute

export interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'textarea' | 'select';
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface EventMetadata {
  webhookId: string;
  businessName: string;
  receivedAt: string;
}

export interface ProviderDefinition {
  name: string;
  label: string;
  icon: string;
  description: string;
  configSchema: FieldDefinition[];
  execute(eventData: any, providerConfig: any, metadata?: EventMetadata): Promise<{ success: boolean; message: string; data?: any }>;
}

// --- CHATBOTBUILDER ---
const chatbotbuilder: ProviderDefinition = {
  name: 'chatbotbuilder',
  label: 'ChatbotBuilder',
  icon: '🤖',
  description: 'Envía eventos a ChatbotBuilder (ChatGPTBuilder). Busca usuario por campo personalizado y dispara un flujo.',
  configSchema: [
    { key: 'apiToken', label: 'API Token', type: 'password', required: true, placeholder: 'Token de acceso de ChatbotBuilder' },
    { key: 'customFieldId', label: 'ID Campo Personalizado (CUF)', type: 'number', required: true, placeholder: 'Ej: 12345' },
    { key: 'flowId', label: 'ID del Flujo', type: 'number', required: true, placeholder: 'Ej: 67890' },
  ],
  async execute(eventData, config) {
    const passSerialNumber = eventData.data?.passSerialNumber;
    if (!passSerialNumber) {
      return { success: false, message: 'passSerialNumber no encontrado en el evento' };
    }

    const userResponse = await fetch(
      `https://app.chatgptbuilder.io/api/users/find_by_custom_field?field_id=${config.customFieldId}&value=${passSerialNumber}`,
      { headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken } }
    );
    const userData = await userResponse.json() as any;

    if (!userData.data || userData.data.length === 0) {
      return { success: false, message: `Usuario no encontrado con CUF ${passSerialNumber}` };
    }

    const userId = userData.data[0].id;
    await fetch(`https://app.chatgptbuilder.io/api/users/${userId}/send/${config.flowId}`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'X-ACCESS-TOKEN': config.apiToken }
    });

    return { success: true, message: `Flujo ${config.flowId} enviado al usuario ${userId}` };
  }
};

// --- CUSTOM HTTP (Reenvío completo) ---
const customHttp: ProviderDefinition = {
  name: 'custom_http',
  label: 'Custom HTTP',
  icon: '🌐',
  description: 'Reenvía toda la información del evento a tu webhook. Recibirás un JSON estructurado con: evento, tipo, datos de la persona, negocio, timestamps y toda la data original de SmartPasses.',
  configSchema: [
    { key: 'url', label: 'URL de tu Webhook receptor', type: 'text', required: true, placeholder: 'https://tu-servidor.com/webhook' },
    { key: 'authHeader', label: 'Header de autenticación (opcional)', type: 'password', required: false, placeholder: 'Bearer tu-token-secreto' },
  ],
  async execute(eventData, config, metadata) {
    // Construir payload enriquecido con toda la información
    const enrichedPayload = {
      // Identificación del evento
      event: {
        type: eventData.type || 'unknown',
        description: getEventDescription(eventData.type),
        receivedAt: metadata?.receivedAt || new Date().toISOString(),
      },

      // Información del negocio/cliente en SmartWebhooks
      source: {
        webhookId: metadata?.webhookId || 'unknown',
        businessName: metadata?.businessName || 'unknown',
        platform: 'SmartWebhooks',
      },

      // Datos de la persona/pase (extraídos del evento PassSlot)
      person: {
        passSerialNumber: eventData.data?.passSerialNumber || null,
        passTypeIdentifier: eventData.data?.passTypeIdentifier || null,
        pushToken: eventData.data?.pushToken || null,
      },

      // Datos completos del pase si vienen incluidos
      pass: eventData.data?.pass || null,

      // Payload original completo (para quien necesite acceder a todo)
      raw: eventData,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.authHeader) {
      headers['Authorization'] = config.authHeader;
    }

    const resp = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(enrichedPayload),
    });

    if (!resp.ok) {
      return { success: false, message: `Tu webhook respondió HTTP ${resp.status}: ${await resp.text()}` };
    }
    return { success: true, message: `Evento reenviado a ${config.url}` };
  }
};

// Traduce el tipo de evento PassSlot a una descripción legible
function getEventDescription(type: string): string {
  const descriptions: Record<string, string> = {
    'pass.created': 'Se creó un nuevo pase',
    'pass.updated': 'El pase fue actualizado',
    'pass.downloaded': 'El pase fue descargado al dispositivo del usuario',
    'registration.created': 'El dispositivo se registró para recibir push notifications del pase',
    'registration.deleted': 'El dispositivo se desregistró del pase',
    'scan.performed': 'El pase fue escaneado (QR/barcode)',
  };
  return descriptions[type] || `Evento: ${type}`;
}

// Helper: construye el payload enriquecido que todos los providers de reenvío usan
function buildEnrichedPayload(eventData: any, metadata?: EventMetadata) {
  return {
    event: {
      type: eventData.type || 'unknown',
      description: getEventDescription(eventData.type),
      receivedAt: metadata?.receivedAt || new Date().toISOString(),
    },
    source: {
      webhookId: metadata?.webhookId || 'unknown',
      businessName: metadata?.businessName || 'unknown',
      platform: 'SmartWebhooks',
    },
    person: {
      passSerialNumber: eventData.data?.passSerialNumber || null,
      passTypeIdentifier: eventData.data?.passTypeIdentifier || null,
      pushToken: eventData.data?.pushToken || null,
    },
    pass: eventData.data?.pass || null,
    raw: eventData,
  };
}

// --- ZAPIER ---
const zapier: ProviderDefinition = {
  name: 'zapier',
  label: 'Zapier',
  icon: '⚡',
  description: 'Envía el evento enriquecido a un Zap de Zapier. Recibirás evento, persona, negocio y timestamps.',
  configSchema: [
    { key: 'zapUrl', label: 'Zapier Webhook URL', type: 'text', required: true, placeholder: 'https://hooks.zapier.com/hooks/catch/...' },
  ],
  async execute(eventData, config, metadata) {
    const resp = await fetch(config.zapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEnrichedPayload(eventData, metadata)),
    });
    if (!resp.ok) {
      return { success: false, message: `Zapier respondió HTTP ${resp.status}` };
    }
    return { success: true, message: 'Evento enviado a Zapier' };
  }
};

// --- MAKE (Integromat) ---
const make: ProviderDefinition = {
  name: 'make',
  label: 'Make (Integromat)',
  icon: '🔄',
  description: 'Envía el evento enriquecido a un escenario de Make. Recibirás evento, persona, negocio y timestamps.',
  configSchema: [
    { key: 'webhookUrl', label: 'Make Webhook URL', type: 'text', required: true, placeholder: 'https://hook.make.com/...' },
  ],
  async execute(eventData, config, metadata) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEnrichedPayload(eventData, metadata)),
    });
    if (!resp.ok) {
      return { success: false, message: `Make respondió HTTP ${resp.status}` };
    }
    return { success: true, message: 'Evento enviado a Make' };
  }
};

// --- SLACK ---
const slack: ProviderDefinition = {
  name: 'slack',
  label: 'Slack',
  icon: '💬',
  description: 'Envía una notificación legible a un canal de Slack con los datos del evento.',
  configSchema: [
    { key: 'webhookUrl', label: 'Slack Webhook URL', type: 'text', required: true, placeholder: 'https://hooks.slack.com/services/...' },
  ],
  async execute(eventData, config, metadata) {
    const evtType = eventData.type || 'unknown';
    const serial = eventData.data?.passSerialNumber || 'N/A';
    const biz = metadata?.businessName || 'N/A';
    const time = metadata?.receivedAt || new Date().toISOString();

    const text = [
      `*${getEventDescription(evtType)}*`,
      `Negocio: *${biz}*`,
      `Tipo de evento: \`${evtType}\``,
      `Serial del pase: \`${serial}\``,
      `Hora: ${time}`,
      `\`\`\`${JSON.stringify(eventData.data || {}, null, 2)}\`\`\``,
    ].join('\n');

    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      return { success: false, message: `Slack respondió HTTP ${resp.status}` };
    }
    return { success: true, message: 'Notificación enviada a Slack' };
  }
};

// --- N8N ---
const n8n: ProviderDefinition = {
  name: 'n8n',
  label: 'n8n',
  icon: '🔗',
  description: 'Envía el evento enriquecido a un workflow de n8n. Recibirás evento, persona, negocio y timestamps.',
  configSchema: [
    { key: 'webhookUrl', label: 'n8n Webhook URL', type: 'text', required: true, placeholder: 'https://tu-n8n.com/webhook/...' },
  ],
  async execute(eventData, config, metadata) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEnrichedPayload(eventData, metadata)),
    });
    if (!resp.ok) {
      return { success: false, message: `n8n respondió HTTP ${resp.status}` };
    }
    return { success: true, message: 'Evento enviado a n8n' };
  }
};

// --- WHATSAPP BUSINESS API ---
const whatsapp: ProviderDefinition = {
  name: 'whatsapp',
  label: 'WhatsApp Business',
  icon: '📱',
  description: 'Envía un mensaje de plantilla via WhatsApp Business API (Meta Cloud API).',
  configSchema: [
    { key: 'accessToken', label: 'Access Token (Meta)', type: 'password', required: true, placeholder: 'Token de acceso permanente' },
    { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true, placeholder: 'ID del número de WhatsApp Business' },
    { key: 'recipientPhone', label: 'Teléfono destino (o {{event}} para dinámico)', type: 'text', required: true, placeholder: '+521234567890' },
    { key: 'templateName', label: 'Nombre de plantilla', type: 'text', required: true, placeholder: 'hello_world' },
    { key: 'languageCode', label: 'Código de idioma', type: 'text', required: false, placeholder: 'es_MX' },
  ],
  async execute(eventData, config) {
    const phone = config.recipientPhone.includes('{{event}}')
      ? config.recipientPhone.replace(/\{\{event\}\}/g, JSON.stringify(eventData))
      : config.recipientPhone;

    const resp = await fetch(`https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: config.templateName,
          language: { code: config.languageCode || 'es_MX' },
        },
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, message: `WhatsApp API error: ${err}` };
    }
    return { success: true, message: `Mensaje enviado a ${phone}` };
  }
};

// --- REGISTRY ---
const providers: Record<string, ProviderDefinition> = {
  chatbotbuilder,
  custom_http: customHttp,
  zapier,
  make,
  slack,
  n8n,
  whatsapp,
};

export function getProvider(name: string): ProviderDefinition | undefined {
  return providers[name];
}

export function getAllProviders(): ProviderDefinition[] {
  return Object.values(providers);
}

export function getProvidersList() {
  return getAllProviders().map(p => ({
    name: p.name,
    label: p.label,
    icon: p.icon,
    description: p.description,
    configSchema: p.configSchema,
  }));
}
