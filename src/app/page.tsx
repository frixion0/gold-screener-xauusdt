'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, BarChart3, Clock, Zap } from 'lucide-react';

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

export default function Home() {
  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchKlines = async () => {
      try {
        const res = await fetch('/api/klines?symbol=XAUUSDT&interval=3m&limit=200');
        if (!res.ok) throw new Error('Failed to fetch data');
        const data = await res.json();
        setKlineData(data);
        setError(null);
      } catch (err) {
        setError('Failed to load market data. Retrying...');
        // Retry after 5 seconds
        setTimeout(fetchKlines, 5000);
      } finally {
        setLoading(false);
      }
    };

    fetchKlines();
  }, []);

  // Auto-refresh historical data every 3 minutes
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/klines?symbol=XAUUSDT&interval=3m&limit=200');
        if (res.ok) {
          const data = await res.json();
          setKlineData(data);
          setError(null);
        }
      } catch {
        // silently fail, WebSocket keeps real-time updates
      }
    }, 180000);

    return () => clearInterval(interval);
  }, []);

  const latestCandle = klineData.length > 0 ? klineData[klineData.length - 1] : null;
  const prevCandle = klineData.length > 1 ? klineData[klineData.length - 2] : null;
  const isUp = prevCandle ? latestCandle!.close >= prevCandle.close : true;

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

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500">
              <Clock className="w-3 h-3" />
              <span>Binance Feed</span>
            </div>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">
              XAUUSDT
            </Badge>
          </div>
        </div>
      </header>

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
                <GoldChart data={klineData} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Info */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 px-1">
          <span>Data sourced from Binance via WebSocket (wss://stream.binance.com)</span>
          <span>3-minute interval | Auto-updating in real-time</span>
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
