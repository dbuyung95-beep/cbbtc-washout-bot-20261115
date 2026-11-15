# cbBTC deep-washout bot — make.fun btc-race-24h-20261115-0828

Long-only bot trading Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute
on-chain bars, with $1,000 of paper money. It sits in cash and buys only a
capitulation-style washout, then rides the recovery.

## Strategy

- **Main entry:** flat, and the latest close is at least **2.50%** below the
  highest close of the last **60 bars**. Buy with all available cash in one
  order (filled at the next bar's open).
- **Main exit:** take profit at **+3.00%** over cost; a disaster stop at
  **-5.00%** (tail protection only — never fired on the dev window); time
  stop after **600 batches**. Whole position, decided on a close, filled at
  the next open.
- **Fallback entry:** if no buy has ever filled after **1,100 batches**, the
  dip threshold halves to **1.25%**, with tighter exits (+1.00% / -1.00% /
  240 batches), so a quiet window still takes at least one trade (the race
  bar asks for at least one trade). The main trigger stays live afterwards.
- After an exit, wait **15 batches** before buying again.
- Every order caps slippage at **100 bps** past the deciding close.

## Why this shape

On this competition's dev window (Nov 14-15, BTC -4.0% end to end) the
previous race's drop-rebound scalper (12-bar lookback, +0.60%/-0.40% exits)
graded **-87.64 USDC** with 32 trades: the window's small bounces almost
never paid the ~26 bps round-trip cost. Diagnostics showed the only durable
edge was deep 60-bar washouts (drop >= 2% from the 60-bar peak: forward
+2.36% at 60 min, +3.15% at 240 min). This bot buys exactly those, once,
and holds through the recovery.

## Local grades (kit `grade-local`, process driver)

| Window | Net PnL | Trades | Win rate | Max DD | Fees | PnL at 2x fees |
|---|---|---|---|---|---|---|
| **Dev (Nov 14-15, the gate)** | **+29.95 USDC** | 2 (1 round trip) | 1.00 | 1.56% | 0.81 | +29.13 |
| Walk-forward (Nov 11-12) | +1.20 USDC | 1 (fallback) | 1.00 | 0.31% | 0.80 | +0.40 |

Dev gate: **PASS** (net PnL above $0). It beats every kit baseline on the
dev window (buy-and-hold -44.01, momentum -40.92, RSI-Bollinger -57.37,
ADX-momentum -86.60, EMA-cross -134.95, hold-cash 0.00 with 0 trades).
The previous v2 bot scored +8.22 on the old window but -87.64 on this one.

## Honest caveat

The whole dev profit comes from **one washout episode** (bars 994-1112:
bought ~63,038, sold ~64,884). Neighbouring parameter sets grade in the
same band (DROP 225-275 bps, TP 200-400 bps: +18 to +38 USDC in the
offline simulator), so the choice is not a knife-edge spike — but it is a
concentrated bet, not a diversified edge. Dev-profitable did not carry
over to live last race (v2: +8.22 dev, -25.12 live), so nothing here
promises a race profit. If the race window has no 2.5% washout, the bot
takes at most the small fallback trade.

## Layout

- `main.ts` — the bot (Node 22, TypeScript erasable syntax only).
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, copied
  byte-for-byte.
- `LICENSE` — MIT.

## Run it

Through the competition kit's local grader:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

## How it was built

Built with an AI coding agent in a single session inside the competition
window; the session transcripts ship with the submission. The starting
point was the previous race's drop-rebound bot (v2, +8.22 dev / -25.12
live); it was re-graded on the new kit's dev window, failed the gate at
-87.64, and was rebuilt around the deep-washout entry after an offline
sweep and diagnostics over both published dev windows, then re-verified
with grade-local at +29.95 USDC before submission.

## Referral

Building on make.fun too? [Sign up with my referral link](https://make.fun/r/s9nxc87a) — code `s9nxc87a`.

## License

MIT — see `LICENSE`.
