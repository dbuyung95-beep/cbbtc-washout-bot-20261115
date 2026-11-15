// cbBTC deep-washout bot for the make.fun bars-replay/v1 harness,
// competition btc-race-24h-20261115-0828.
//
// Strategy (long only, one symbol: CBBTC against USDC, 1-minute bars):
// sit in cash and buy only a capitulation-style washout, then ride the
// recovery instead of scalping every small bounce:
//   - Main entry: flat, and the latest close is at least DROP_BPS below
//     the highest close of the last LOOKBACK bars (a sharp 60-minute
//     washout). Buy with all available cash in one order (filled at the
//     next bar's open).
//   - Main exit, the whole position, decided on a close and filled at the
//     next open: take profit at +TAKE_PROFIT_BPS over cost; a disaster
//     stop at -DISASTER_STOP_BPS under cost (tail protection only — it
//     never fired on the dev window); time stop after MAX_HOLD batches.
//   - Fallback entry (the race bar asks for at least one trade): if no
//     buy has ever filled after FALLBACK_AFTER batches, the dip
//     threshold halves to FALLBACK_DROP_BPS, with its own tighter exits
//     (take profit +FALLBACK_TP_BPS, stop -FALLBACK_SL_BPS, time stop
//     FALLBACK_HOLD). One quiet window still takes a trade; the main
//     trigger stays live afterwards.
//   - After an exit, wait COOLDOWN batches before buying again.
//   - Every order caps slippage at MAX_SLIPPAGE_BPS past the close it was
//     decided on. A rejected order never deadlocks the bot: a buy rejected
//     at the next open (e.g. the price gapped past the slippage cap) clears
//     the pending flag, so the entry is retried on a later bar while the
//     trigger still holds; a rejected sell likewise leaves the exit state
//     untouched, so the exit is retried while its condition holds.
//
// Why this shape: on this competition's dev window (BTC -4.0% end to
// end, Nov 14-15) the old drop-rebound scalper (12-bar lookback,
// +0.60%/-0.40% exits) graded -87.64 USDC with 32 trades — the window's
// small bounces almost never paid the ~26 bps round-trip cost. The
// diagnostics showed the only durable edge was deep 60-bar washouts
// (drop >= 2% from the 60-bar peak: forward +2.36% at 60 min,
// +3.15% at 240 min). This bot buys exactly those, once, and holds
// through the recovery. Neighbouring parameter sets grade within the
// same band (DROP 225-275 bps, TP 200-400 bps all positive on dev),
// but the whole dev profit comes from ONE washout episode (bars
// 994-1112), so the dev number is a concentrated bet, not a diversified
// edge — reported honestly in the README.
//
// All decisions read only the bars and the account the harness sends
// (hello, batch, fills, orders are the whole world): no clock, no
// randomness, no network, so two runs on the same bars match exactly.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Bars of history behind the rolling peak the drop is measured from. */
const LOOKBACK = 60;
/** Main entry drop: close at most (1 - DROP_BPS / 10_000) of the rolling peak. */
const DROP_BPS = 250;
/** Main take profit over the position's cost, in bps. */
const TAKE_PROFIT_BPS = 300;
/** Disaster stop under the position's cost, in bps (tail protection only). */
const DISASTER_STOP_BPS = 500;
/** Main time stop: never hold longer than this many batches. */
const MAX_HOLD = 600;
/** Fallback entry: if no buy has ever filled after this many batches. */
const FALLBACK_AFTER = 1100;
/** Fallback entry drop (bps below the rolling 60-bar peak). */
const FALLBACK_DROP_BPS = 125;
/** Fallback exits, in bps. */
const FALLBACK_TP_BPS = 100;
const FALLBACK_SL_BPS = 100;
/** Fallback time stop, in batches. */
const FALLBACK_HOLD = 240;
/** Batches to sit out after an exit before the next entry. */
const COOLDOWN = 15;
const MAX_SLIPPAGE_BPS = 100;

/** Every close seen so far, oldest first, capped at LOOKBACK entries. */
const closes: number[] = [];
/** Batches answered so far (the batch being answered is batches - 1). */
let batches = 0;
/** The batch count at which the current position's buy was decided. */
let enteredAt = -1;
/** The batch count at which the last sell was decided. */
let exitedAt = -1000000;
/** Whether a buy has ever filled in this run (drives the fallback). */
let anyFill = false;
/** Whether a buy order is still waiting for its fill at the next open. */
let buyPending = false;
/** Whether a sell order is still waiting for its fill at the next open. */
let sellPending = false;
/** Exit parameters of the current position (main vs fallback entry). */
let exitTP = TAKE_PROFIT_BPS;
let exitSL = DISASTER_STOP_BPS;
let exitHold = MAX_HOLD;

await runBars({
  onBatch(state, batch) {
    for (const fill of batch.fills) {
      if (fill.side === 'buy' && fill.status === 'filled') anyFill = true;
      // A rejected order is finished, not pending: clear its flag so the
      // bot can retry on a later bar instead of waiting forever.
      if (fill.side === 'buy' && fill.status === 'rejected') buyPending = false;
      if (fill.side === 'sell' && fill.status === 'filled') {
        buyPending = false;
        sellPending = false;
        exitedAt = batches + 1;
        enteredAt = -1;
      }
      if (fill.side === 'sell' && fill.status === 'rejected') sellPending = false;
    }
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      closes.push(Number(bar.c));
      if (closes.length > LOOKBACK) closes.shift();
    }
    batches++;
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      buyPending = false;
      if (sellPending) return [];
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      const takeProfit = value * 10000n >= cost * BigInt(10000 + exitTP);
      const stopLoss = value * 10000n <= cost * BigInt(10000 - exitSL);
      const timeStop = enteredAt >= 0 && batches - enteredAt >= exitHold;
      if (takeProfit || stopLoss || timeStop) {
        // Only the decision is made here; exitedAt/enteredAt move when the
        // sell actually fills (see the fills loop), so a rejected sell is
        // retried while its condition still holds.
        sellPending = true;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    if (buyPending) return [];
    if (batches - exitedAt < COOLDOWN) return [];
    if (closes.length < LOOKBACK) return [];
    const close = closes[closes.length - 1]!;
    let peak = 0;
    for (const c of closes) if (c > peak) peak = c;
    if (peak <= 0) return [];
    const fallback = !anyFill && batches > FALLBACK_AFTER;
    const dropBps = fallback ? FALLBACK_DROP_BPS : DROP_BPS;
    // close <= peak * (1 - dropBps / 10_000), compared in float64 like the
    // baselines' indicators: exact IEEE arithmetic, run after run.
    if (close * 10000 > peak * (10000 - dropBps)) return [];
    const notional = state.cash;
    if (notional === 0n || notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    buyPending = true;
    enteredAt = batches;
    exitTP = fallback ? FALLBACK_TP_BPS : TAKE_PROFIT_BPS;
    exitSL = fallback ? FALLBACK_SL_BPS : DISASTER_STOP_BPS;
    exitHold = fallback ? FALLBACK_HOLD : MAX_HOLD;
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
