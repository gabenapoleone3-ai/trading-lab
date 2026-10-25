export const PAPER_ORIGIN = 'https://paper-api.alpaca.markets';
export const DATA_ORIGIN = 'https://data.alpaca.markets';
export const SYMBOLS = ['SPY', 'AGG', 'AAPL'] as const;
export const RULES = Object.freeze({ capital: 10_000, positionFraction: .1, grossFraction: .3, cashReserve: .05, feeBps: 10, slippageBps: 10, spreadBps: 50, quoteAgeMs: 120_000, dailyLoss: .03, maxDrawdown: .1, stopLoss: .08, orderTtlMs: 300_000 });
export interface Config { key: string; secret: string; kill: boolean; statePath: string; port: number; intervalMs: number }
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  for (const name of ['APCA_API_BASE_URL','ALPACA_BASE_URL']) if(env[name] && env[name] !== PAPER_ORIGIN) throw new Error('Only the fixed Alpaca paper endpoint is allowed.');
  if(env.APCA_API_KEY_ID?.startsWith('AK')) throw new Error('Live API keys are not allowed. Use paper credentials.');
  if(env.PAPER_KILL_SWITCH && !['true','false'].includes(env.PAPER_KILL_SWITCH)) throw new Error('PAPER_KILL_SWITCH must be true or false.');
  const port=Number(env.PORT??8080);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid server port.');
  return {key:env.APCA_API_KEY_ID??'',secret:env.APCA_API_SECRET_KEY??'',kill:env.PAPER_KILL_SWITCH==='true',statePath:env.PAPER_STATE_PATH??'runtime/state.json',port,intervalMs:60_000};
}
