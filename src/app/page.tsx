'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, BarChart3, Clock, Zap, RefreshCw } from 'lucide-react';

const GoldChart = dynamic(() => import('@/components/GoldChart'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[500px] bg-[#0a0e17]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
        <span className="text-zinc-400 text-sm">Loading chart engine...</span>
      </div>
    </div>
  ),
});

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyBase: number;
  takerBuyQuote: number;
}

function useSecondsAgo(since: Date | null): number {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => {
      setSeconds(since ? Math.floor((Date.now() - since.getTime()) / 1000) : 0);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [since]);

  return seconds;
}

export default function Home() {
  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fetchCountRef = useRef(0);

  const fetchKlines = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setIsRefreshing(true);
      // Fetch directly from Binance Futures (client-side) to bypass server IP blocks on cloud hosts
      const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval=3m&limit=200');
      if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
      const rawData: (string | number)[][] = await res.json();
      const data: KlineData[] = rawData.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
        quoteVolume: parseFloat(String(k[7])),
        trades: Number(k[8]),
        takerBuyBase: parseFloat(String(k[9])),
        takerBuyQuote: parseFloat(String(k[10])),
      }));
      setKlineData(data);
      setLastFetch(new Date());
      setError(null);
      fetchCountRef.current += 1;
    } catch (_err) {
      if (!isBackground) {
        setError('Failed to load market data. Retrying...');
      }
    } finally {
      setIsRefreshing(false);
      if (!isBackground) setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchKlines();
  }, [fetchKlines]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchKlines(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchKlines]);

  const secondsAgo = useSecondsAgo(lastFetch);

  const latestCandle = klineData.length > 0 ? klineData[klineData.length - 1] : null;
  const prevCandle = klineData.length > 1 ? klineData[klineData.length - 2] : null;
  const isUp = prevCandle ? latestCandle!.close >= prevCandle.close : true;

  const nextRefreshIn = 10 - (secondsAgo % 10);

  return (
    <div className="min-h-screen bg-[#080b12] text-white">
      {/* Top Navigation */}
      <header className="border-b border-zinc-800/60 bg-[#0d1117]">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-lg shadow-yellow-500/20">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-yellow-400">Gold</span>
                <span className="text-zinc-300">Screener</span>
              </h1>
            </div>
            <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 text-[10px] uppercase tracking-wider">
              <Activity className="w-3 h-3 mr-1" />
              Real-Time
            </Badge>
          </div>

          {/* Live Update Status */}
          <div className="flex items-center gap-3">
            {lastFetch && (
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${secondsAgo < 3 ? 'bg-emerald-400' : secondsAgo < 8 ? 'bg-yellow-400' : 'bg-orange-400'} ${secondsAgo < 3 ? 'animate-pulse' : ''}`} />
                <span className={`text-xs font-mono tabular-nums ${secondsAgo < 3 ? 'text-emerald-400' : secondsAgo < 8 ? 'text-yellow-400' : 'text-orange-400'}`}>
                  {secondsAgo < 2 ? 'Just now' : `${secondsAgo}s ago`}
                </span>
                <span className="text-zinc-600 text-xs font-mono tabular-nums">
                  next in {nextRefreshIn}s
                </span>
              </div>
            )}
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">
              XAUUSDT
            </Badge>
          </div>
        </div>
      </header>

      {/* Last Updated Banner */}
      {lastFetch && (
        <div className="bg-[#0b1019] border-b border-zinc-800/40">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Clock className="w-3 h-3" />
              <span>Last candle updated: <span className="text-zinc-300 font-mono tabular-nums">{lastFetch.toLocaleTimeString()}</span></span>
              <span className="text-zinc-600">|</span>
              <span>Interval: <span className="text-yellow-400">10s</span></span>
              <span className="text-zinc-600">|</span>
              <span>Source: <span className="text-zinc-300">Binance Futures</span></span>
            </div>
            <button
              onClick={() => fetchKlines()}
              disabled={isRefreshing}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-yellow-400 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto p-3 sm:p-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard
            icon={<TrendingUp className={`w-4 h-4 ${isUp ? 'text-emerald-400' : 'text-red-400'}`} />}
            label="Current Price"
            value={latestCandle ? `$${latestCandle.close.toFixed(2)}` : '---'}
            subtext={latestCandle ? (isUp ? 'Bullish' : 'Bearish') : ''}
            subtextClass={isUp ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatCard
            icon={<BarChart3 className="w-4 h-4 text-zinc-400" />}
            label="Session High"
            value={latestCandle ? `$${Math.max(...klineData.map(k => k.high)).toFixed(2)}` : '---'}
            subtext="Max peak"
          />
          <StatCard
            icon={<Activity className="w-4 h-4 text-zinc-400" />}
            label="Session Low"
            value={latestCandle ? `$${Math.min(...klineData.map(k => k.low)).toFixed(2)}` : '---'}
            subtext="Min trough"
          />
          <StatCard
            icon={<BarChart3 className="w-4 h-4 text-zinc-400" />}
            label="Total Volume"
            value={latestCandle
              ? `${(klineData.reduce((s, k) => s + k.volume, 0) / 1000).toFixed(1)}K`
              : '---'}
            subtext="3m candles"
          />
        </div>

        {/* Main Chart */}
        <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden shadow-2xl shadow-black/40">
          <CardContent className="p-0">
            <div className="h-[420px] sm:h-[520px] lg:h-[600px]">
              {loading ? (
                <div className="flex items-center justify-center h-full bg-[#0a0e17]">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
                    <span className="text-zinc-400 text-sm">
                      Fetching XAU/USDT market data...
                    </span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full bg-[#0a0e17]">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-red-400" />
                    </div>
                    <span className="text-zinc-400 text-sm">{error}</span>
                  </div>
                </div>
              ) : (
                <GoldChart data={klineData} lastFetchTime={lastFetch} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Info */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 px-1">
          <span>Data sourced from Binance Futures (fapi.binance.com)</span>
          <span>3-minute interval | Auto-refreshing every 10s</span>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
  subtextClass = 'text-zinc-500',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  subtextClass?: string;
}) {
  return (
    <Card className="border-zinc-800/60 bg-[#0d1117] hover:border-zinc-700/60 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-lg sm:text-xl font-mono font-bold text-white tabular-nums">
          {value}
        </div>
        {subtext && (
          <span className={`text-[11px] ${subtextClass}`}>{subtext}</span>
        )}
      </CardContent>
    </Card>
  );
}
