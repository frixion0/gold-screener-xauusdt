import { NextResponse } from 'next/server';

const MUDREX_API = 'https://trade.mudrex.com/fapi/v1/futures/funds';
const SECRET_KEY = 'v33dnrb92FKBSMTVUxJ6ufeW7cBBEmmK';

export async function GET() {
  try {
    if (!SECRET_KEY) {
      return NextResponse.json({ error: 'Mudrex API key not configured' }, { status: 500 });
    }

    const res = await fetch(MUDREX_API, {
      method: 'GET',
      headers: {
        'X-Authentication': SECRET_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Mudrex API error: ${res.status}`, details: text }, { status: res.status });
    }

    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch funds', details: String(err) }, { status: 500 });
  }
}
