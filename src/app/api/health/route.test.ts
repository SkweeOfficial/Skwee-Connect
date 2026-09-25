import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from './route';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co/');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const req = (path: string) => new Request(`http://localhost${path}`);

describe('GET /api/health', () => {
  it('returns 200 without touching Supabase', async () => {
    const res = await GET(req('/api/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).status).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deep check returns 200 when Supabase is healthy', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await GET(req('/api/health?deep=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks.supabase.status).toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.supabase.co/auth/v1/health'
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ apikey: 'anon-key' });
  });

  it('deep check returns 503 when Supabase responds with an error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    const res = await GET(req('/api/health?deep=1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.supabase.error).toBe('upstream 502');
  });

  it('deep check returns 503 when Supabase is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await GET(req('/api/health?deep'));
    expect(res.status).toBe(503);
    expect((await res.json()).checks.supabase.error).toBe('unreachable');
  });

  it('deep check returns 503 when Supabase env is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const res = await GET(req('/api/health?deep=1'));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HEAD /api/health', () => {
  it('mirrors the GET status with an empty body', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const res = await HEAD(req('/api/health?deep=1'));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });
});
