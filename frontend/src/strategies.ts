// src/strategies.ts
export type Field = { key:string; label:string; type:"number"|"text"|"select"; min?:number; max?:number; step?:number; options?:{label:string; value:string}[]; default?:any; required?:boolean; };
export type Strategy = { id:string; name:string; desc:string; fields:Field[]; endpoint:"/backtest"|"/peek" };

export const STRATEGIES: Strategy[] = [
  {
    id: "threshold_cross",
    name: "Price Crosses Threshold",
    desc: "Buy when close crosses above threshold; sell after N days.",
    endpoint: "/backtest",
    fields: [
      { key:"symbol", label:"Symbol", type:"text", default:"SPY", required:true },
      { key:"threshold", label:"Threshold (close ≥)", type:"number", step:0.01, required:true },
      { key:"hold_days", label:"Hold Days", type:"number", min:1, max:60, default:5, required:true },
      { key:"start", label:"Start (YYYY-MM-DD)", type:"text", required:true },
      { key:"end", label:"End (YYYY-MM-DD)", type:"text", required:true },
    ],
  },
  {
    id: "sma_crossover",
    name: "SMA Crossover",
    desc: "Buy when SMA_fast crosses above SMA_slow; exit on cross-down or after cap days.",
    endpoint: "/backtest",
    fields: [
      { key:"symbol", label:"Symbol", type:"text", default:"SPY", required:true },
      { key:"sma_fast", label:"SMA Fast", type:"number", min:2, max:100, default:10, required:true },
      { key:"sma_slow", label:"SMA Slow", type:"number", min:5, max:300, default:50, required:true },
      { key:"max_hold", label:"Max Hold Days", type:"number", min:1, max:120, default:30 },
      { key:"start", label:"Start", type:"text", required:true },
      { key:"end", label:"End", type:"text", required:true },
    ],
  },
  {
    id: "rsi_revert",
    name: "RSI Mean Reversion",
    desc: "Buy when RSI < L; sell when RSI > H or max days.",
    endpoint: "/backtest",
    fields: [
      { key:"symbol", label:"Symbol", type:"text", default:"SPY", required:true },
      { key:"rsi_len", label:"RSI Length", type:"number", min:2, max:50, default:14, required:true },
      { key:"rsi_low", label:"RSI Low", type:"number", min:1, max:50, default:30, required:true },
      { key:"rsi_high", label:"RSI High", type:"number", min:50, max:99, default:70, required:true },
      { key:"max_hold", label:"Max Hold Days", type:"number", min:1, max:60, default:10 },
      { key:"start", label:"Start", type:"text", required:true },
      { key:"end", label:"End", type:"text", required:true },
    ],
  },
];
