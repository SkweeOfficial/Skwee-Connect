import { NextResponse } from 'next/server';

/**
 * Public health check for uptime monitors (UptimeRobot, Docker
 * healthcheck, load balancers). See docs/uptime-monitoring.md.
 *
 *   GET /api/health          → liveness: 200 whenever the Node process
 *                              can serve a request. No I/O.
 *   GET /api/health?deep=1   → readiness: also pings Supabase Auth's
 *                              `/auth/v1/health`, returning 503 when
 *                              the backend is unreachable or unhealthy.
 *
 * Unauthenticated by design — it exposes nothing beyond "up/down" and
 * the upstream latency. HEAD is supported so monitors that default to
 * HEAD requests work without extra config.
 */

const SUPABASE_TIMEOUT_MS = 5_000;

type CheckResult = {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
};

async function checkSupabase(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { status: 'error', latencyMs: 0, error: 'supabase not configured' };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    return res.ok
      ? { status: 'ok', latencyMs }
      : { status: 'error', latencyMs, error: `upstream ${res.status}` };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return {
      status: 'error',
      latencyMs: Date.now() - started,
      error: timedOut ? 'timeout' : 'unreachable',
    };
  }
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.has('deep');
  const headers = { 'Cache-Control': 'no-store' };

  if (!deep) {
    return NextResponse.json(
      { status: 'ok', time: new Date().toISOString() },
      { headers }
    );
  }

  const supabase = await checkSupabase();
  const healthy = supabase.status === 'ok';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      checks: { supabase },
    },
    { status: healthy ? 200 : 503, headers }
  );
}

export async function HEAD(request: Request) {
  const res = await GET(request);
  return new Response(null, { status: res.status, headers: res.headers });
}
