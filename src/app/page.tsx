'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, BarChart3, Clock, Zap, RefreshCw, Bot, ArrowUpCircle, ArrowDownCircle, Radio, Wifi, WifiOff } from 'lucide-react';
import { runStrategy } from '@/lib/rsi';

const GoldChart = dynamic(() => import('@/components/GoldChart'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-[#0a0e17]" style={{ height: 'clamp(280px, 45vh, 560px)' }}>
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
  engine?: {
    startedAt: string | null;
    lastCheckAt: string | null;
    nextCheckAt: string | null;
    lastResult: string | null;
    checkCount: number;
    errorCount: number;
    isRunning: boolean;
  };
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

  useEffect(() => {
    fetchKlines();
    fetchBotStatus();
    fetchSignals();
  }, [fetchKlines, fetchBotStatus, fetchSignals]);

  useEffect(() => {
    const interval = setInterval(() => { fetchKlines(true); fetchBotStatus(); fetchSignals(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchKlines, fetchBotStatus, fetchSignals]);

  const secondsAgo = useSecondsAgo(lastFetch);
  const latestCandle = klineData.length > 0 ? klineData[klineData.length - 1] : null;
  const prevCandle = klineData.length > 1 ? klineData[klineData.length - 2] : null;
  const isUp = prevCandle ? latestCandle!.close >= prevCandle.close : true;
  const nextRefreshIn = 10 - (secondsAgo % 10);

  // Client-side RSI
  const { rsiPoints, signals: clientSignals } = runStrategy(klineData, 1, 14);
  const latestRSI = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1] : null;
  const recentClientSignals = clientSignals.slice(-2).reverse();

  const priceColor = isUp ? 'text-emerald-400' : 'text-red-400';
  const changeValue = latestCandle && prevCandle ? latestCandle.close - prevCandle.close : 0;
  const changePercent = prevCandle ? ((changeValue / prevCandle.close) * 100) : 0;
  const changeColor = changeValue >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="min-h-screen bg-[#080b12] text-white">
      {/* === HEADER === */}
      <header className="border-b border-zinc-800/60 bg-[#0d1117]">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 py-2 sm:py-3">
          {/* Row 1: Logo + Price + Status */}
          <div className="flex items-center justify-between gap-2">
            {/* Left: Logo + Pair */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-lg shadow-yellow-500/20 shrink-0">
                <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-bold tracking-tight leading-tight">
                  <span className="text-yellow-400">Gold</span><span className="text-zinc-300">Screener</span>
                </h1>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 text-[10px] sm:text-xs font-medium">XAUUSDT</span>
                  <span className="text-zinc-700 text-[10px]">3m</span>
                  <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-[8px] sm:text-[10px] uppercase px-1.5 py-0">
                    RSI Bot
                  </Badge>
                </div>
              </div>
            </div>

            {/* Center: Price */}
            <div className="text-center shrink-0">
              <div className={`text-lg sm:text-2xl font-mono font-bold tabular-nums leading-tight ${priceColor} transition-colors duration-200`}>
                {latestCandle ? `$${latestCandle.close.toFixed(2)}` : '---'}
              </div>
              <div className="flex items-center gap-2 justify-center">
                <span className={`text-xs sm:text-sm font-mono font-semibold tabular-nums ${changeColor}`}>
                  {changeValue >= 0 ? '+' : ''}{changeValue.toFixed(2)}
                </span>
                <span className={`text-[10px] sm:text-xs font-mono tabular-nums ${changeColor}`}>
                  ({changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%)
                </span>
              </div>
            </div>

            {/* Right: Status indicators */}
            <div className="flex items-center gap-2 shrink-0">
              {lastFetch && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${secondsAgo < 3 ? 'bg-emerald-400' : secondsAgo < 8 ? 'bg-yellow-400' : 'bg-orange-400'} ${secondsAgo < 3 ? 'animate-pulse' : ''}`} />
                  <span className="text-[10px] sm:text-xs font-mono tabular-nums text-zinc-400">
                    {secondsAgo < 2 ? 'Now' : `${secondsAgo}s`}
                  </span>
                </div>
              )}
              <button onClick={() => { fetchKlines(); fetchBotStatus(); fetchSignals(); }} disabled={isRefreshing}
                className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50" title="Refresh">
                <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-2 sm:p-3 lg:p-4">

        {/* === STATS CARDS (compact scrollable on mobile) === */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-0 sm:overflow-visible sm:grid sm:grid-cols-4 lg:grid-cols-4">
          <MiniStat label="RSI(1)" value={latestRSI ? latestRSI.rsi.toFixed(1) : '---'}
            color={latestRSI ? (latestRSI.rsi >= 70 ? 'text-red-400' : latestRSI.rsi <= 30 ? 'text-emerald-400' : 'text-purple-400') : 'text-zinc-400'}
            hint={latestRSI ? (latestRSI.rsi >= 70 ? 'Overbought' : latestRSI.rsi <= 30 ? 'Oversold' : 'Neutral') : ''} />
          <MiniStat label="SMA(14)" value={latestRSI ? latestRSI.sma.toFixed(1) : '---'}
            color={latestRSI ? (latestRSI.sma >= 70 ? 'text-red-400' : latestRSI.sma <= 30 ? 'text-emerald-400' : 'text-yellow-400') : 'text-zinc-400'}
            hint={latestRSI ? (latestRSI.sma >= 70 ? 'Above 70' : latestRSI.sma <= 30 ? 'Below 30' : 'Neutral') : ''} />
          <MiniStat label="Position" value={botStatus?.position || '---'}
            color={botStatus?.position === 'LONG' ? 'text-emerald-400' : 'text-zinc-400'}
            hint={`Bot: ${botStatus?.active ? 'AUTO' : 'OFF'}`} />
          <MiniStat label="Signals" value={`${clientSignals.length}B/${clientSignals.filter(s => s.type === 'SELL').length}S`}
            color="text-zinc-300" hint={botStatus?.engine?.checkCount ? `${botStatus.engine.checkCount} checks` : ''} />
        </div>

        {/* === RECENT SIGNALS === */}
        {recentClientSignals.length > 0 && (
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-0">
            {recentClientSignals.map((sig, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border shrink-0 min-w-[200px] sm:min-w-0 ${
                sig.type === 'BUY' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'
              }`}>
                {sig.type === 'BUY'
                  ? <ArrowUpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <ArrowDownCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono font-bold text-xs ${sig.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sig.type}
                    </span>
                    <span className="font-mono font-bold text-xs text-white">${sig.price.toFixed(2)}</span>
                  </div>
                  <div className="text-[9px] text-zinc-500 font-mono">
                    RSI {sig.rsi.toFixed(1)} / SMA {sig.rsiSma.toFixed(1)}
                  </div>
                  <div className="text-[9px] text-zinc-600 font-mono">
                    {new Date(sig.candleTime * 1000).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === CHART === */}
        <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden shadow-2xl shadow-black/40 mb-3">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center bg-[#0a0e17]" style={{ height: '50vh' }}>
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
                  <span className="text-zinc-400 text-sm">Fetching XAU/USDT market data...</span>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center bg-[#0a0e17]" style={{ height: '50vh' }}>
                <div className="flex flex-col items-center gap-3 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-red-400" />
                  </div>
                  <span className="text-zinc-400 text-sm">{error}</span>
                </div>
              </div>
            ) : (
              <GoldChart data={klineData} lastFetchTime={lastFetch} />
            )}
          </CardContent>
        </Card>

        {/* === DASHBOARD: Signal Log + Setup === */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
          {/* Signal Log */}
          <Card className="lg:col-span-2 border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-0">
              <div className="px-3 sm:px-4 py-2.5 border-b border-zinc-800/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-sm font-semibold">Signal Log</span>
                  {botStats && (
                    <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                      {botStats.totalSignals}
                    </Badge>
                  )}
                </div>
                {botStats && botStats.totalSignals > 0 && (
                  <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs">
                    <span className="text-zinc-500">
                      WR: <span className={botStats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{botStats.winRate}%</span>
                    </span>
                    <span className="text-zinc-500">
                      P&amp;L: <span className={botStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>${botStats.totalPnL.toFixed(2)}</span>
                    </span>
                  </div>
                )}
              </div>
              <div className="max-h-[250px] sm:max-h-[300px] overflow-y-auto">
                {signals.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-zinc-600 text-sm px-4 text-center">
                    <Bot className="w-4 h-4 mr-2 shrink-0" /> No signals yet — bot checks every 3min
                  </div>
                ) : (
                  <>
                    {/* Table Header */}
                    <div className="flex items-center gap-3 px-3 sm:px-4 py-2 bg-zinc-900/40 border-b border-zinc-800/30 text-[9px] sm:text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">
                      <span className="w-4 shrink-0" />
                      <span className="w-8 shrink-0">Type</span>
                      <span className="shrink-0">Price</span>
                      <span className="shrink-0 hidden sm:inline">RSI</span>
                      <span className="shrink-0 hidden sm:inline">SMA</span>
                      <span className="ml-auto shrink-0">Time</span>
                    </div>
                    <div className="divide-y divide-zinc-800/20">
                      {signals.map((sig) => (
                        <div key={sig.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-zinc-800/20 transition-colors">
                          {sig.type === 'BUY'
                            ? <ArrowUpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                            : <ArrowDownCircle className="w-4 h-4 text-red-400 shrink-0" />}
                          <span className={`font-mono font-bold text-xs w-8 shrink-0 ${sig.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {sig.type}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-zinc-300 shrink-0">${sig.price.toFixed(2)}</span>
                          <span className="font-mono text-xs tabular-nums text-zinc-500 shrink-0 hidden sm:inline">{sig.rsi.toFixed(1)}</span>
                          <span className="font-mono text-xs tabular-nums text-yellow-400 shrink-0 hidden sm:inline">{sig.rsiSma.toFixed(1)}</span>
                          <span className="font-mono text-[10px] sm:text-xs tabular-nums text-zinc-400 ml-auto shrink-0 whitespace-nowrap">
                            {new Date(sig.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bot Setup Guide */}
          <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-sm font-semibold">24/7 Bot Setup</span>
              </div>

              <div className="space-y-3 text-xs">
                <SetupStep number={1} title="Deploy on Render" done description="Already deployed" />
                <SetupStep number={2} title="Set UptimeRobot" done={false} description={
                  <>
                    Go to <span className="text-yellow-400">uptimerobot.com</span> and create a monitor:
                    <div className="mt-1.5 p-2 rounded bg-zinc-900/60 border border-zinc-800/60 font-mono text-[10px] text-zinc-400 break-all">
                      https://your-app.onrender.com/api/bot/check
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Type:</span>
                        <span className="text-zinc-300">HTTP(s)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Interval:</span>
                        <span className="text-yellow-400">5 min</span>
                      </div>
                    </div>
                  </>
                } />
                <SetupStep number={3} title="Bot Runs Autonomously" done={false} description={
                  <>
                    Engine runs <span className="text-yellow-400">every 3min</span> on its own.
                    UptimeRobot just keeps Render awake.
                  </>
                } />
              </div>

              {/* Strategy Info */}
              <div className="mt-3 p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <div className="text-[9px] sm:text-[10px] text-purple-400 uppercase tracking-wider font-semibold mb-1.5">Strategy</div>
                <div className="space-y-1 text-[11px] text-zinc-400">
                  <div className="flex justify-between"><span>RSI / SMA</span><span className="font-mono text-zinc-300">1 / 14</span></div>
                  <div className="flex justify-between"><span>Buy</span><span className="font-mono text-emerald-400">SMA above 30</span></div>
                  <div className="flex justify-between"><span>Sell</span><span className="font-mono text-red-400">SMA below 70</span></div>
                  <div className="flex justify-between"><span>TF</span><span className="font-mono text-zinc-300">3m</span></div>
                </div>
              </div>

              {/* Engine Status */}
              {botStatus?.engine && (
                <div className="mt-3 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40">
                  <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Engine Status</div>
                  <div className="space-y-1 text-[11px] font-mono text-zinc-500">
                    <div>Checks: <span className="text-zinc-300">{botStatus.engine.checkCount}</span></div>
                    <div>Errors: <span className={botStatus.engine.errorCount > 0 ? 'text-red-400' : 'text-zinc-300'}>{botStatus.engine.errorCount}</span></div>
                    {botStatus.engine.lastCheckAt && (
                      <div>Last: <span className="text-zinc-300">{new Date(botStatus.engine.lastCheckAt).toLocaleTimeString()}</span></div>
                    )}
                    {botStatus.engine.lastResult && (
                      <div className="text-[10px] text-zinc-600 truncate" title={botStatus.engine.lastResult}>{botStatus.engine.lastResult}</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* === FOOTER === */}
        <div className="flex items-center justify-between text-[10px] text-zinc-600 px-1">
          <span>RSI(1) + SMA(14) | Binance Futures | 3m</span>
          <span className="hidden sm:inline">Bot: /api/bot/check (UptimeRobot 5min)</span>
        </div>
      </main>
    </div>
  );
}

/* === Compact horizontal stat pill (mobile scrollable) === */
function MiniStat({ label, value, color, hint }: {
  label: string; value: string; color: string; hint?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0d1117] border border-zinc-800/60 shrink-0 sm:shrink min-w-[110px] sm:min-w-0">
      <div className="min-w-0">
        <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
        <div className={`text-sm sm:text-base font-mono font-bold tabular-nums leading-tight ${color}`}>{value}</div>
        {hint && <div className="text-[9px] text-zinc-600 truncate">{hint}</div>}
      </div>
    </div>
  );
}

function SetupStep({ number, title, description, done }: {
  number: number; title: string; description: React.ReactNode; done: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5 ${
        done ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
      }`}>
        {done ? '\u2713' : number}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-zinc-300 text-xs">{title}</div>
        <div className="text-zinc-500 mt-0.5 text-[11px] leading-relaxed">{description}</div>
      </div>
    </div>
  );
}
