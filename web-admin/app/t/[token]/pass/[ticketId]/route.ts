import { NextResponse } from 'next/server';
import { bffHeaders, clientOf } from '@/lib/bff';
import { apiUrl } from '@/lib/env';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/**
 * "Add to Apple Wallet": asks the API for a fresh short-lived pass URL at the moment of the tap
 * and sends the browser there. No pass URL is ever written into the page, so a cached, shared or
 * long-open page cannot hold a stale or leaked one.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; ticketId: string }> },
) {
  const { token, ticketId } = await params;
  const back = (state: string) =>
    NextResponse.redirect(new URL(`/t/${encodeURIComponent(token)}?wallet=${state}`, req.url), {
      status: 303,
      headers: NO_STORE,
    });
  try {
    const res = await fetch(
      `${apiUrl()}/v1/t/${encodeURIComponent(token)}/pass/${encodeURIComponent(ticketId)}`,
      {
        cache: 'no-store',
        headers: bffHeaders(clientOf(req.headers)),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return back(res.status === 503 ? 'off' : 'error');
    const { url } = (await res.json()) as { url?: unknown };
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return back('error');
    return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
  } catch {
    return back('error');
  }
}
