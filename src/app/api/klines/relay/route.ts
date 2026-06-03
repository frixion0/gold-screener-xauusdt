import { NextRequest, NextResponse } from 'next/server';
import { storeRelayKlines } from '@/lib/bot-engine';

/**
 * POST /api/klines/relay
 * Client-side kline relay: browser fetches Binance directly (no IP blocking)
 * and sends data to server for the bot engine to consume.
 * This is the most reliable data source on Render (cloud IPs are blocked by Binance).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { candles } = body;

    if (!Array.isArray(candles) || candles.length < 20) {
      return NextResponse.json(
        { error: 'Invalid candles data: need array of 20+ candles' },
        { status: 400 }
      );
    }

    // Validate candle format
    const valid = candles.every(
      (k: any) =>
        typeof k.time === 'number' &&
        typeof k.open === 'number' &&
        typeof k.close === 'number'
    );

    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid candle format: need time, open, close fields' },
        { status: 400 }
      );
    }

    // Store in relay cache for bot engine
    storeRelayKlines(candles);

    return NextResponse.json({
      success: true,
      count: candles.length,
      latestTime: candles[candles.length - 1].time,
    });
  } catch (error) {
    console.error('Klines relay error:', error);
    return NextResponse.json(
      { error: 'Failed to process relay data' },
      { status: 500 }
    );
  }
}
