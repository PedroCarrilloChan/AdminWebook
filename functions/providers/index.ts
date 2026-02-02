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

export interface ProviderDefinition {
  name: string;
  label: string;
  icon: string;
  description: string;
  configSchema: FieldDefinition[];
  execute(eventData: any, providerConfig: any): Promise<{ success: boolean; message: string; data?: any }>;
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

// --- CUSTOM HTTP (Genérico) ---
const customHttp: ProviderDefinition = {
  name: 'custom_http',
  label: 'Custom HTTP',
  icon: '🌐',
  description: 'Envía el payload del webhook a cualquier URL HTTP. Ideal para conectar con cualquier servicio que acepte webhooks.',
  configSchema: [
    { key: 'url', label: 'URL Destino', type: 'text', required: true, placeholder: 'https://tu-servicio.com/webhook' },
    { key: 'method', label: 'Método HTTP', type: 'select', required: true, options: [
      { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' },
      { value: 'PATCH', label: 'PATCH' },
    ]},
    { key: 'headers', label: 'Headers adicionales (JSON)', type: 'textarea', required: false, placeholder: '{"Authorization": "Bearer xxx"}' },
    { key: 'bodyTemplate', label: 'Body Template (JSON, usa {{event}} para datos)', type: 'textarea', required: false, placeholder: 'Vacío = enviar evento completo' },
  ],
  async execute(eventData, config) {
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.headers) {
      try {
        const extra = JSON.parse(config.headers);
        headers = { ...headers, ...extra };
      } catch (e) {
        return { success: false, message: 'Headers JSON inválido' };
      }
    }

    let body: string;
    if (config.bodyTemplate) {
      try {
        body = config.bodyTemplate.replace(/\{\{event\}\}/g, JSON.stringify(eventData));
      } catch (e) {
        body = JSON.stringify(eventData);
      }
    } else {
      body = JSON.stringify(eventData);
    }

    const resp = await fetch(config.url, {
      method: config.method || 'POST',
      headers,
      body,
    });

    if (!resp.ok) {
      return { success: false, message: `HTTP ${resp.status}: ${await resp.text()}` };
    }
    return { success: true, message: `Enviado a ${config.url} — HTTP ${resp.status}` };
  }
};

// --- ZAPIER ---
const zapier: ProviderDefinition = {
  name: 'zapier',
  label: 'Zapier',
  icon: '⚡',
  description: 'Envía el evento a un Zap de Zapier mediante Webhook trigger.',
  configSchema: [
    { key: 'zapUrl', label: 'Zapier Webhook URL', type: 'text', required: true, placeholder: 'https://hooks.zapier.com/hooks/catch/...' },
  ],
  async execute(eventData, config) {
    const resp = await fetch(config.zapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
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
  description: 'Envía el evento a un escenario de Make mediante Custom Webhook.',
  configSchema: [
    { key: 'webhookUrl', label: 'Make Webhook URL', type: 'text', required: true, placeholder: 'https://hook.make.com/...' },
  ],
  async execute(eventData, config) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
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
  description: 'Envía una notificación a un canal de Slack mediante Incoming Webhook.',
  configSchema: [
    { key: 'webhookUrl', label: 'Slack Webhook URL', type: 'text', required: true, placeholder: 'https://hooks.slack.com/services/...' },
    { key: 'messageTemplate', label: 'Plantilla de mensaje', type: 'textarea', required: false, placeholder: 'Vacío = mensaje por defecto con datos del evento' },
  ],
  async execute(eventData, config) {
    const defaultMsg = `📨 *Webhook recibido*\nTipo: \`${eventData.type || 'unknown'}\`\nDatos: \`\`\`${JSON.stringify(eventData.data || eventData, null, 2)}\`\`\``;
    const text = config.messageTemplate
      ? config.messageTemplate.replace(/\{\{event\}\}/g, JSON.stringify(eventData))
      : defaultMsg;

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
  description: 'Envía el evento a un workflow de n8n mediante Webhook trigger.',
  configSchema: [
    { key: 'webhookUrl', label: 'n8n Webhook URL', type: 'text', required: true, placeholder: 'https://tu-n8n.com/webhook/...' },
  ],
  async execute(eventData, config) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
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
