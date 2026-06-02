'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, BarChart3, Clock, Zap, RefreshCw, Bot, ArrowUpCircle, ArrowDownCircle, Radio, Wifi, WifiOff } from 'lucide-react';

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

interface BotStatus {
  active: boolean;
  position: string;
  currentRSI: number | null;
  currentSMA: number | null;
  lastPing: string | null;
  lastPingAgoMs: number;
  totalSignals: number;
}

interface SignalRecord {
  id: number;
  type: string;
  price: number;
  rsi: number;
  rsiSma: number;
  candleTime: number;
  createdAt: string;
}

interface BotStats {
  totalSignals: number;
  totalBuys: number;
  totalSells: number;
  totalPnL: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

function useSecondsAgo(since: Date | null): number {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const tick = () => setSeconds(since ? Math.floor((Date.now() - since.getTime()) / 1000) : 0);
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
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

  // Bot state
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [botStats, setBotStats] = useState<BotStats | null>(null);

  const fetchKlines = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setIsRefreshing(true);
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
      if (!isBackground) setError('Failed to load market data. Retrying...');
    } finally {
      setIsRefreshing(false);
      if (!isBackground) setLoading(false);
    }
  }, []);

  const fetchBotStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) setBotStatus(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/signals?limit=30');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals);
        setBotStats(data.stats);
      }
    } catch { /* silent */ }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchKlines();
    fetchBotStatus();
    fetchSignals();
  }, [fetchKlines, fetchBotStatus, fetchSignals]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => { fetchKlines(true); fetchBotStatus(); fetchSignals(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchKlines, fetchBotStatus, fetchSignals]);

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
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-[10px] uppercase tracking-wider">
              <Bot className="w-3 h-3 mr-1" />
              RSI Bot
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            {lastFetch && (
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${secondsAgo < 3 ? 'bg-emerald-400' : secondsAgo < 8 ? 'bg-yellow-400' : 'bg-orange-400'} ${secondsAgo < 3 ? 'animate-pulse' : ''}`} />
                <span className={`text-xs font-mono tabular-nums ${secondsAgo < 3 ? 'text-emerald-400' : secondsAgo < 8 ? 'text-yellow-400' : 'text-orange-400'}`}>
                  {secondsAgo < 2 ? 'Just now' : `${secondsAgo}s ago`}
                </span>
                <span className="text-zinc-600 text-xs font-mono tabular-nums">next in {nextRefreshIn}s</span>
              </div>
            )}
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">XAUUSDT</Badge>
          </div>
        </div>
      </header>

      {/* Last Updated Banner */}
      {lastFetch && (
        <div className="bg-[#0b1019] border-b border-zinc-800/40">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Clock className="w-3 h-3" />
              <span>Last updated: <span className="text-zinc-300 font-mono tabular-nums">{lastFetch.toLocaleTimeString()}</span></span>
              <span className="text-zinc-600">|</span>
              <span>Interval: <span className="text-yellow-400">10s</span></span>
              <span className="text-zinc-600">|</span>
              <span>Strategy: <span className="text-purple-400">RSI(1) + SMA(14)</span></span>
            </div>
            <button onClick={() => { fetchKlines(); fetchBotStatus(); fetchSignals(); }} disabled={isRefreshing}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-yellow-400 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto p-3 sm:p-4">
        {/* Stats Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
          <StatCard icon={<TrendingUp className={`w-4 h-4 ${isUp ? 'text-emerald-400' : 'text-red-400'}`} />}
            label="Current Price" value={latestCandle ? `$${latestCandle.close.toFixed(2)}` : '---'}
            subtext={latestCandle ? (isUp ? 'Bullish' : 'Bearish') : ''} subtextClass={isUp ? 'text-emerald-400' : 'text-red-400'} />
          <StatCard icon={<BarChart3 className="w-4 h-4 text-zinc-400" />}
            label="Session High" value={latestCandle ? `$${Math.max(...klineData.map(k => k.high)).toFixed(2)}` : '---'} subtext="Max peak" />
          <StatCard icon={<Activity className="w-4 h-4 text-zinc-400" />}
            label="Session Low" value={latestCandle ? `$${Math.min(...klineData.map(k => k.low)).toFixed(2)}` : '---'} subtext="Min trough" />
          <StatCard icon={<BarChart3 className="w-4 h-4 text-zinc-400" />}
            label="Volume" value={latestCandle ? `${(klineData.reduce((s, k) => s + k.volume, 0) / 1000).toFixed(1)}K` : '---'} subtext="3m candles" />
          {/* Bot Status Cards */}
          <BotCard icon={botStatus?.active ? <Radio className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-red-400" />}
            label="Bot Status" value={botStatus?.active ? 'ACTIVE' : botStatus ? 'OFFLINE' : '---'}
            subtext={botStatus?.lastPing ? `Ping: ${Math.round(botStatus.lastPingAgoMs / 1000)}s ago` : 'Not started'}
            subtextClass={botStatus?.active ? 'text-emerald-400' : 'text-red-400'} />
          <BotCard icon={<Bot className={`w-4 h-4 ${botStatus?.position === 'LONG' ? 'text-emerald-400' : botStatus?.position === 'SHORT' ? 'text-red-400' : 'text-zinc-400'}`} />}
            label="Position" value={botStatus?.position || 'NEUTRAL'}
            subtext={`RSI: ${botStatus?.currentRSI?.toFixed(1) ?? '---'} | SMA: ${botStatus?.currentSMA?.toFixed(1) ?? '---'}`}
            subtextClass={botStatus?.position === 'LONG' ? 'text-emerald-400' : 'text-zinc-500'} />
        </div>

        {/* Main Chart */}
        <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden shadow-2xl shadow-black/40 mb-4">
          <CardContent className="p-0">
            <div className="h-[380px] sm:h-[480px] lg:h-[560px]">
              {loading ? (
                <div className="flex items-center justify-center h-full bg-[#0a0e17]">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
                    <span className="text-zinc-400 text-sm">Fetching XAU/USDT market data...</span>
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

        {/* Bot Dashboard: Signals + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Signal Log */}
          <Card className="lg:col-span-2 border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-semibold">Signal Log</span>
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {botStats ? `${botStats.totalSignals} signals` : '...'}
                  </Badge>
                </div>
                {botStats && botStats.totalSignals > 0 && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-zinc-500">
                      Win Rate: <span className={botStats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{botStats.winRate}%</span>
                    </span>
                    <span className="text-zinc-500">
                      P&L: <span className={botStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>${botStats.totalPnL.toFixed(2)}</span>
                    </span>
                  </div>
                )}
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {signals.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-zinc-600 text-sm">
                    <Bot className="w-4 h-4 mr-2" /> Waiting for signals... (need UptimeRobot pinging /api/bot/check)
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#0d1117] z-10">
                      <tr className="text-left text-[11px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/40">
                        <th className="px-4 py-2">Type</th>
                        <th className="px-4 py-2">Price</th>
                        <th className="px-4 py-2">RSI</th>
                        <th className="px-4 py-2">SMA</th>
                        <th className="px-4 py-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signals.map((sig) => (
                        <tr key={sig.id} className="border-b border-zinc-800/20 hover:bg-zinc-800/20 transition-colors">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              {sig.type === 'BUY'
                                ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400" />
                                : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400" />}
                              <span className={`font-mono font-bold text-xs ${sig.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                                {sig.type}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-zinc-300">${sig.price.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-zinc-400">{sig.rsi.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-yellow-400">{sig.rsiSma.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-zinc-500">
                            {new Date(sig.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bot Setup Guide */}
          <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">24/7 Bot Setup</span>
              </div>

              <div className="space-y-3 text-xs">
                <SetupStep number={1} title="Deploy on Render" done description="Already deployed at your Render URL" />
                <SetupStep number={2} title="Set UptimeRobot" done={false} description={
                  <>
                    Go to <span className="text-yellow-400">uptimerobot.com</span> and create a new monitor:
                    <div className="mt-2 p-2 rounded bg-zinc-900/60 border border-zinc-800/60 font-mono text-[10px] text-zinc-400 break-all">
                      https://your-app.onrender.com/api/bot/check
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Monitor Type:</span>
                        <span className="text-zinc-300">HTTP(s)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Interval:</span>
                        <span className="text-yellow-400">1 minute</span>
                      </div>
                    </div>
                  </>
                } />
                <SetupStep number={3} title="Bot Runs 24/7" done={false} description={
                  <>
                    UptimeRobot pings <span className="text-yellow-400">/api/bot/check</span> every minute.
                    Each ping fetches data, calculates RSI strategy, and logs buy/sell signals.
                    Render stays awake thanks to the constant pings.
                  </>
                } />
              </div>

              {/* Strategy Info */}
              <div className="mt-4 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <div className="text-[10px] text-purple-400 uppercase tracking-wider font-semibold mb-2">Strategy Details</div>
                <div className="space-y-1.5 text-xs text-zinc-400">
                  <div className="flex justify-between">
                    <span>RSI Length</span><span className="font-mono text-zinc-300">1</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SMA Length</span><span className="font-mono text-zinc-300">14</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Buy Signal</span><span className="font-mono text-emerald-400">SMA cross above 30</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sell Signal</span><span className="font-mono text-red-400">SMA cross below 70</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Timeframe</span><span className="font-mono text-zinc-300">3 Minutes</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Info */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 px-1">
          <span>RSI(1) + SMA(14) Strategy | Binance Futures | 3-minute candles</span>
          <span>Bot endpoint: /api/bot/check (ping with UptimeRobot every 1min)</span>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, subtext, subtextClass = 'text-zinc-500' }: {
  icon: React.ReactNode; label: string; value: string; subtext?: string; subtextClass?: string;
}) {
  return (
    <Card className="border-zinc-800/60 bg-[#0d1117] hover:border-zinc-700/60 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-lg sm:text-xl font-mono font-bold text-white tabular-nums">{value}</div>
        {subtext && <span className={`text-[11px] ${subtextClass}`}>{subtext}</span>}
      </CardContent>
    </Card>
  );
}

function BotCard({ icon, label, value, subtext, subtextClass = 'text-zinc-500' }: {
  icon: React.ReactNode; label: string; value: string; subtext?: string; subtextClass?: string;
}) {
  return (
    <Card className="border-zinc-800/60 bg-[#0d1117] hover:border-zinc-700/60 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-lg sm:text-xl font-mono font-bold text-white tabular-nums">{value}</div>
        {subtext && <span className={`text-[11px] ${subtextClass}`}>{subtext}</span>}
      </CardContent>
    </Card>
  );
}

function SetupStep({ number, title, description, done }: {
  number: number; title: string; description: React.ReactNode; done: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5 ${
        done ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
      }`}>
        {done ? '✓' : number}
      </div>
      <div>
        <div className="font-semibold text-zinc-300">{title}</div>
        <div className="text-zinc-500 mt-0.5">{description}</div>
      </div>
    </div>
  );
}
