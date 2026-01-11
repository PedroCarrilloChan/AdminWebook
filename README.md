# AdminWebook - SmartWebhooks

Plataforma de gestión dinámica de webhooks para integrar PassSlot (Apple/Google Wallet) con ChatGPT Builder.

## 🚀 Migrado a Cloudflare

Este proyecto ahora usa **Cloudflare KV** para almacenamiento de datos, eliminando la dependencia de Firebase.

## 📦 Configuración en Cloudflare

### 1. Crear el KV Namespace

```bash
# Crear namespace para producción
wrangler kv:namespace create "WEBHOOKS_KV"

# Crear namespace para preview/desarrollo
wrangler kv:namespace create "WEBHOOKS_KV" --preview
```

### 2. Actualizar wrangler.toml

Reemplaza los IDs placeholder en `wrangler.toml` con los IDs que te dio el comando anterior:

```toml
[[kv_namespaces]]
binding = "WEBHOOKS_KV"
id = "tu-production-id-aqui"
preview_id = "tu-preview-id-aqui"
```

### 3. Desplegar a Cloudflare Pages

```bash
# Desplegar el proyecto
npm run deploy
```

## 🔧 Desarrollo Local

```bash
# Instalar dependencias
npm install

# Desarrollo solo frontend
npm run dev

# Desarrollo con Cloudflare Workers (recomendado)
npm run dev:functions
```

## 📝 Estructura de Datos en KV

Los webhooks se almacenan con la siguiente estructura:

- **Clave**: `webhook:{id}` - Configuración individual de cada webhook
- **Clave**: `webhooks:index` - Array de IDs de todos los webhooks

### Ejemplo de Webhook:

```json
{
  "id": "1736726400000-abc123def",
  "businessName": "Mi Negocio",
  "secretKey": "tu-secret-key",
  "apiToken": "tu-api-token",
  "customFieldId": "123",
  "flowId": "456",
  "isActive": true
}
```

## 🔐 API Endpoints

- `GET /admin/webhooks` - Listar todos los webhooks
- `POST /admin/webhooks` - Crear nuevo webhook
- `PUT /admin/webhooks/:id` - Actualizar webhook
- `DELETE /admin/webhooks/:id` - Eliminar webhook
- `POST /api/v1/webhook/:id` - Recibir webhook de PassSlot

## 🌐 Configurar el Proyecto en Cloudflare Pages

1. Ve a [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Pages → Create a project → Connect to Git
3. Selecciona tu repositorio
4. Configura:
   - **Build command**: `npm run build`
   - **Build output directory**: `public`
5. En Settings → Functions, configura el KV binding:
   - Variable name: `WEBHOOKS_KV`
   - KV namespace: Selecciona el namespace que creaste

## ✅ Beneficios de la Migración

- ✅ Sin credenciales externas necesarias
- ✅ Todo el stack en Cloudflare
- ✅ Latencia ultra-baja en edge
- ✅ Gratis hasta 100,000 lecturas/día
- ✅ Más simple de mantener

## 🛠️ Stack Tecnológico

- **Frontend**: HTML5, Tailwind CSS, JavaScript
- **Backend**: Cloudflare Pages Functions (TypeScript)
- **Storage**: Cloudflare KV
- **Edge Runtime**: Cloudflare Workers
