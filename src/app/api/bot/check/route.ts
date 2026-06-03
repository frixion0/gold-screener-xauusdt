import { NextResponse } from 'next/server';
import { getEngineState, forceCheck, startBotEngine } from '@/lib/bot-engine';

// Query param ?force=1 to trigger a manual strategy check
// Without ?force, this just returns engine health (UptimeRobot uses this as keep-alive)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1';

  try {
    const engine = getEngineState();

    // Fallback: if engine hasn't started, start it now
    // This ensures the bot runs even if instrumentation.ts failed
    if (!engine.startedAt) {
      startBotEngine();
      console.log('[Bot Check] Engine was not running — auto-started via /api/bot/check');
    }

    if (force) {
      const result = await forceCheck();
      return NextResponse.json({
        ok: true,
        type: 'manual_check',
        engine,
        ...result,
      });
    }

    // Normal ping — just return engine status (keeps Render awake)
    return NextResponse.json({
      ok: true,
      type: 'keep_alive',
      engine,
      message: 'Bot engine is running autonomously — this ping just keeps the server awake',
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
