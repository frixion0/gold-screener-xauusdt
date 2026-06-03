// Next.js Server Instrumentation
// Auto-starts the bot engine when the Next.js server boots
// This runs once on server startup (not on every request)
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run on server-side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import to avoid circular dependency and ensure all modules are loaded
    const { startBotEngine } = await import('@/lib/bot-engine');
    startBotEngine();
    console.log('[Instrumentation] Bot engine registered and starting...');
  }
}
