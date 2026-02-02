import { getProvidersList } from '../providers/index';

// GET: Listar todos los providers disponibles con sus schemas
export async function onRequestGet(): Promise<Response> {
  return new Response(JSON.stringify(getProvidersList()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
