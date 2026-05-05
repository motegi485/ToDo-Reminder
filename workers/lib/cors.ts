export interface Env {
  DB: D1Database;
  VAPID_PRIVATE_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  ALLOWED_ORIGIN: string;
}

function getAllowOrigin(env: Env, origin: string | null): string {
  if (env.ALLOWED_ORIGIN === '*') return '*';
  return origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN;
}

export function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowOrigin(env, origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleOptions(env: Env, request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env, request.headers.get('Origin')),
  });
}

export function jsonResponse(
  body: unknown,
  env: Env,
  request: Request,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env, request.headers.get('Origin')),
    },
  });
}
