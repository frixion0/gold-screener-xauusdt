import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'XAUUSDT';
  const interval = searchParams.get('interval') || '3m';
  const limit = parseInt(searchParams.get('limit') || '200', 10);

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const response = await fetch(url, {
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();

    const klines = data.map((k: (string | number)[]) => ({
      time: Math.floor(Number(k[0]) / 1000) as number,
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
      closeTime: Number(k[6]),
      quoteVolume: parseFloat(String(k[7])),
      trades: Number(k[8]),
      takerBuyBase: parseFloat(String(k[9])),
      takerBuyQuote: parseFloat(String(k[10])),
    }));

    return NextResponse.json(klines);
  } catch (error) {
    console.error('Klines API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch kline data' },
      { status: 500 }
    );
  }
}
