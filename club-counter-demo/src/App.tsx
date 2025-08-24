import React, { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Area, Legend } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Plus, Minus, Wifi, WifiOff, History, Monitor, Download, Shield, DoorOpen, DoorClosed, Activity, Clock } from "lucide-react";

/**
 * Club Counter Demo (single-file React component)
 *
 * Highlights
 * - Multi-device sync (open multiple tabs) via BroadcastChannel + localStorage fallback
 * - Event-sourced ledger (immutable) with audit metadata
 * - Live occupancy + capacity with One-In/One-Out gating
 * - Beautiful historical chart with ACTUAL vs FORECAST + capacity overlay
 * - Offline simulation with queue + reconciliation on reconnect
 * - Export CSV, open Signage View (?signage=1), role/door identity, and a simple peer presence indicator
 *
 * This is a demo – not production. It’s designed to be shown to investors/customers to convey UX + robustness.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Tiny Tailwind primitives (Cards/Buttons/Badges) so we don't depend on UI kits
// ──────────────────────────────────────────────────────────────────────────────
const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = "", children }) => (
  <div className={`rounded-2xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur shadow-sm border border-zinc-200/50 dark:border-zinc-800 ${className}`}>{children}</div>
);
const CardHeader: React.FC<{ className?: string; title?: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }>=({ className = "", title, subtitle, right }) => (
  <div className={`flex items-start justify-between p-5 ${className}`}>
    <div>
      {title && <h3 className="text-lg font-semibold tracking-tight">{title}</h3>}
      {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{subtitle}</p>}
    </div>
    {right && <div className="shrink-0">{right}</div>}
  </div>
);
const CardContent: React.FC<{ className?: string; children: React.ReactNode }>=({ className = "", children }) => (
  <div className={`p-5 pt-0 ${className}`}>{children}</div>
);
const Button: React.FC<{
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "ok";
  disabled?: boolean;
  title?: string;
}> = ({ className = "", children, onClick, variant = "primary", disabled, title }) => {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles: Record<string, string> = {
    primary: "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
    ok: "bg-emerald-600 text-white hover:bg-emerald-500",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    ghost: "bg-transparent text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
};
const Badge: React.FC<{ children: React.ReactNode; color?: "default" | "green" | "amber" | "red" | "blue"; className?: string }>=({ children, color = "default", className = "" }) => {
  const map = {
    default: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    red: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[color]} ${className}`}>{children}</span>;
};
const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string; id?: string }>=({ checked, onChange, label, id }) => (
  <label className="inline-flex items-center gap-3 cursor-pointer select-none" htmlFor={id}>
    <span className="text-sm text-zinc-600 dark:text-zinc-300">{label}</span>
    <span className={`relative w-12 h-7 rounded-full transition ${checked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white dark:bg-zinc-100 transition-transform ${checked ? "translate-x-5" : ""}`}></span>
    </span>
  </label>
);

// ──────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────────────────────────────────────
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const niceTime = (d: Date | number) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const formatTS = (d: number) => new Date(d).toLocaleString();
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toCSV = (rows: any[]) => {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","));
  return [header, ...lines].join("\n");
};

// ──────────────────────────────────────────────────────────────────────────────
// Event ledger types
// ──────────────────────────────────────────────────────────────────────────────
type Role = "Doorman" | "Manager" | "Marshal";

type LedgerEvent =
  | { id: string; ts: number; type: "IN" | "OUT"; amount: number; deviceId: string; door: string; role: Role }
  | { id: string; ts: number; type: "SET"; value: number; deviceId: string; door: string; role: Role; reason?: string }
  | { id: string; ts: number; type: "CAPACITY"; value: number; deviceId: string; door: string; role: Role }
  | { id: string; ts: number; type: "ADJUST"; delta: number; deviceId: string; door: string; role: Role; reason?: string };

// ──────────────────────────────────────────────────────────────────────────────
// Demo forecasting – smooth bell-shaped curve with adjustable peak
// ──────────────────────────────────────────────────────────────────────────────
function buildForecastSeries(startTs: number, hours = 6, intervalMin = 5, peakHour = 2.2, peakValue = 180, capacity = 200) {
  const points: { t: number; forecast: number; capacity: number }[] = [];
  const totalPoints = Math.floor((hours * 60) / intervalMin);
  const sigma = 1.1; // wider evening curve
  for (let i = 0; i <= totalPoints; i++) {
    const tHours = (i * intervalMin) / 60; // hours since start
    const x = (tHours - peakHour) / sigma;
    const fx = Math.exp(-0.5 * x * x) * peakValue; // Gaussian-shaped forecast
    const ts = startTs + i * intervalMin * 60 * 1000;
    points.push({ t: ts, forecast: clamp(fx, 0, capacity * 1.15), capacity });
  }
  return points;
}

// Map ledger to actual occupancy over time (sampled per interval)
function buildActualSeries(ledger: LedgerEvent[], startTs: number, hours = 6, intervalMin = 5) {
  const points: { t: number; actual: number }[] = [];
  const totalPoints = Math.floor((hours * 60) / intervalMin);
  // Pre-sort for safety
  const evts = [...ledger].sort((a, b) => a.ts - b.ts);
  let occ = 0;
  // Apply any SET before startTs to initialize occ
  for (const e of evts) {
    if (e.ts > startTs) break;
    if (e.type === "IN") occ += e.amount;
    if (e.type === "OUT") occ -= e.amount;
    if (e.type === "ADJUST") occ += e.delta;
    if (e.type === "SET") occ = e.value;
  }
  for (let i = 0; i <= totalPoints; i++) {
    const ts = startTs + i * intervalMin * 60 * 1000;
    // apply events up to ts
    while (evts.length && evts[0].ts <= ts) {
      const e = evts.shift()!;
      if (e.type === "IN") occ += e.amount;
      if (e.type === "OUT") occ -= e.amount;
      if (e.type === "ADJUST") occ += e.delta;
      if (e.type === "SET") occ = e.value;
    }
    points.push({ t: ts, actual: Math.max(0, occ) });
  }
  return points;
}

// Compute instantaneous occupancy + capacity from ledger
function computeStateFromLedger(ledger: LedgerEvent[], defaultCapacity = 200) {
  let occupancy = 0;
  let capacity = defaultCapacity;
  for (const e of ledger.sort((a, b) => a.ts - b.ts)) {
    if (e.type === "IN") occupancy += e.amount;
    if (e.type === "OUT") occupancy -= e.amount;
    if (e.type === "ADJUST") occupancy += e.delta;
    if (e.type === "SET") occupancy = e.value;
    if (e.type === "CAPACITY") capacity = e.value;
  }
  return { occupancy: Math.max(0, occupancy), capacity };
}

// ──────────────────────────────────────────────────────────────────────────────
// Demo App
// ──────────────────────────────────────────────────────────────────────────────
const CHANNEL = "clubcounter_demo_channel_v1";
const LEDGER_KEY = "clubcounter_demo_ledger";
const DEVICE_KEY = "clubcounter_demo_device";
const SETTINGS_KEY = "clubcounter_demo_settings";

const roles: Role[] = ["Doorman", "Manager", "Marshal"];

export default function ClubCounterDemo() {
  const signageMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signage") === "1";
  const [deviceId] = useState(() => {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  });
  const [door, setDoor] = useState(() => JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").door || "Door A");
  const [role, setRole] = useState<Role>(() => JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").role || "Doorman");
  const [offline, setOffline] = useState(false);
  const [oneInOneOut, setOneInOneOut] = useState(true);
  const [peakHour, setPeakHour] = useState(2.2); // hours from now
  const [peakValue, setPeakValue] = useState(180);
  const [hoursSpan, setHoursSpan] = useState(6);
  const [ledger, setLedger] = useState<LedgerEvent[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LEDGER_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const pendingQueue = useRef<LedgerEvent[]>([]);
  const [peers, setPeers] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  const bcRef = useRef<BroadcastChannel | null>(null);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ door, role }));
  }, [door, role]);

  // Heartbeat clock & peers pruning
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const prune = setInterval(() => {
      setPeers((p) => {
        const n: Record<string, number> = {};
        Object.entries(p).forEach(([id, ts]) => {
          if (Date.now() - ts < 5000) n[id] = ts; // keep peers seen in last 5s
        });
        return n;
      });
    }, 2500);
    return () => clearInterval(prune);
  }, []);

  // Initialize BroadcastChannel + storage fallback listeners
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bcRef.current = bc;
    } catch {
      bcRef.current = null;
    }

    const onMessage = (evt: MessageEvent) => {
      const data = evt.data;
      if (!data) return;
      if (data.type === "HELLO") {
        setPeers((p) => ({ ...p, [data.deviceId]: Date.now() }));
        // reply snapshot if requested
        if (data.requestSnapshot) {
          bcRef.current?.postMessage({ type: "SNAPSHOT", ledger, from: deviceId });
        }
      } else if (data.type === "HEARTBEAT") {
        setPeers((p) => ({ ...p, [data.deviceId]: Date.now() }));
      } else if (data.type === "EVENT") {
        applyRemoteEvent(data.event);
      } else if (data.type === "SNAPSHOT") {
        // Merge remote snapshot
        mergeRemoteLedger(data.ledger as LedgerEvent[]);
      }
    };

    bc?.addEventListener("message", onMessage);

    // Storage fallback for EVENT fanout
    const onStorage = (e: StorageEvent) => {
      if (e.key === LEDGER_KEY && e.newValue) {
        try {
          const incoming: LedgerEvent[] = JSON.parse(e.newValue);
          mergeRemoteLedger(incoming);
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    // Say hello & ask for snapshot
    bc?.postMessage({ type: "HELLO", deviceId, requestSnapshot: true });
    const hb = setInterval(() => bc?.postMessage({ type: "HEARTBEAT", deviceId }), 1500);

    return () => {
      bc?.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      clearInterval(hb);
      bc?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRemoteEvent = (event: LedgerEvent) => {
    setLedger((prev) => {
      if (prev.some((e) => e.id === event.id)) return prev; // dedupe
      const next = [...prev, event].sort((a, b) => a.ts - b.ts);
      localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
      return next;
    });
  };

  const mergeRemoteLedger = (remote: LedgerEvent[]) => {
    setLedger((prev) => {
      const map = new Map(prev.map((e) => [e.id, e] as const));
      for (const r of remote) if (!map.has(r.id)) map.set(r.id, r);
      const merged = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
      localStorage.setItem(LEDGER_KEY, JSON.stringify(merged));
      return merged;
    });
  };

  const addEvent = (event: LedgerEvent) => {
    if (offline) {
      pendingQueue.current.push(event);
      setLedger((prev) => {
        const next = [...prev, event].sort((a, b) => a.ts - b.ts);
        localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
        return next;
      });
      return;
    }
    // Broadcast first to minimize race conditions
    bcRef.current?.postMessage({ type: "EVENT", event });
    setLedger((prev) => {
      const next = [...prev, event].sort((a, b) => a.ts - b.ts);
      localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
      // storage event helps fallback tabs
      return next;
    });
  };

  // Flush offline queue when going online
  useEffect(() => {
    if (!offline && pendingQueue.current.length) {
      const q = [...pendingQueue.current];
      pendingQueue.current = [];
      q.forEach((e) => bcRef.current?.postMessage({ type: "EVENT", event: e }));
    }
  }, [offline]);

  const { occupancy, capacity } = useMemo(() => computeStateFromLedger(ledger, 200), [ledger]);

  // Chart data
  const startTs = useMemo(() => {
    const now = Date.now();
    // align to past 5-min interval for nicer axes
    const minutes = Math.floor(new Date(now).getMinutes() / 5) * 5;
    const aligned = new Date(now);
    aligned.setMinutes(minutes, 0, 0);
    return +aligned;
  }, []);

  const forecast = useMemo(() => buildForecastSeries(startTs, hoursSpan, 5, peakHour, peakValue, capacity), [startTs, hoursSpan, peakHour, peakValue, capacity]);
  const actual = useMemo(() => buildActualSeries(ledger, startTs, hoursSpan, 5), [ledger, startTs, hoursSpan]);

  const series = useMemo(() => {
    // Merge series by timestamp
    const map = new Map<number, any>();
    forecast.forEach((p) => map.set(p.t, { t: p.t, forecast: p.forecast, capacity: p.capacity }));
    actual.forEach((p) => map.set(p.t, { ...(map.get(p.t) || { t: p.t }), actual: p.actual }));
    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }, [forecast, actual]);

  // Status color for occupancy usage
  const usage = capacity ? (occupancy / capacity) * 100 : 0;
  const status: { color: "green" | "amber" | "red"; text: string } =
    usage <= 80 ? { color: "green", text: "Comfortable" } : usage <= 100 ? { color: "amber", text: "Near capacity" } : { color: "red", text: "Over capacity" };

  const canEnter = !oneInOneOut || occupancy < capacity || role === "Manager";
  const canExit = true;
  const isMarshal = role === "Marshal";

  // Signage-only minimal view
  if (signageMode) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-b from-zinc-950 to-zinc-900 text-white flex items-center justify-center p-10">
        <div className="max-w-6xl w-full text-center">
          <div className="flex items-center justify-center gap-4 mb-8">
            <Users className="w-10 h-10" />
            <h1 className="text-5xl font-bold tracking-tight">Live Occupancy</h1>
          </div>
          <div className="mt-6 grid sm:grid-cols-3 gap-6">
            <Card className="sm:col-span-2">
              <CardHeader title={<span className="text-2xl">Current</span>} subtitle={<span className="text-zinc-400">Updated {niceTime(Date.now())}</span>} right={<Badge color={status.color}>{status.text}</Badge>} />
              <CardContent>
                <div className="flex flex-col items-center justify-center py-6">
                  <motion.div key={occupancy} initial={{ scale: 0.9, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 14 }} className="text-[7rem] leading-none font-extrabold">
                    {occupancy}
                  </motion.div>
                  <div className="text-xl text-zinc-400">/ {capacity} capacity</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader title={<span className="text-2xl">Status</span>} subtitle={<span className="text-zinc-400">One-in/One-out</span>} />
              <CardContent>
                <div className="flex flex-col gap-4 items-center py-6">
                  {usage > 100 ? <DoorClosed className="w-14 h-14 text-rose-400" /> : <DoorOpen className="w-14 h-14 text-emerald-400" />}
                  <div className="text-lg">{usage > 100 ? "Closed to entry" : usage >= 100 ? "1-in/1-out" : "Open"}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Main demo UI
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900 text-zinc-900 dark:text-zinc-50">
      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center gap-3 justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-emerald-500" />
              <h1 className="text-2xl font-bold tracking-tight">Venue Counter – Demo</h1>
            </div>
            <Badge color="blue" className="hidden md:inline-flex">Event-sourced • CRDT-ish sync</Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              {Object.keys(peers).length ? <Wifi className="w-5 h-5 text-emerald-500" /> : <WifiOff className="w-5 h-5 text-amber-500" />}
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Peers: {Object.keys(peers).length}</span>
            </div>
            <Button variant="ghost" onClick={() => window.open(window.location.pathname + "?signage=1", "_blank")}> <Monitor className="w-4 h-4"/> Signage View</Button>
            <Button variant="ghost" onClick={() => {
              const csv = toCSV(ledger.map(e => ({ id: e.id, time: formatTS(e.ts), type: e.type, amount: (e as any).amount ?? (e as any).delta ?? (e as any).value ?? "", deviceId: e.deviceId, door: e.door, role: e.role })));
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `counter_ledger_${new Date().toISOString().slice(0,19)}.csv`; a.click(); URL.revokeObjectURL(url);
            }}> <Download className="w-4 h-4"/> Export CSV</Button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Counter & Controls */}
          <Card className="md:col-span-1">
            <CardHeader title={<span className="flex items-center gap-2"><Users className="w-5 h-5"/> Live Counter</span>} subtitle={<span className="text-zinc-500">Fast, glove-friendly controls for door staff</span>} right={<Badge color={status.color}>{status.text}</Badge>} />
            <CardContent>
              <div className="flex flex-col gap-5">
                {/* Identity */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-zinc-500">Door</label>
                    <input value={door} onChange={(e)=>setDoor(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 outline-none focus:ring-2 ring-emerald-500"/>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-wide text-zinc-500">Role</label>
                    <select value={role} onChange={(e)=>setRole(e.target.value as Role)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 outline-none focus:ring-2 ring-emerald-500">
                      {roles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                {/* Big counter */}
                <div className="flex items-center justify-between">
                  <div className="flex-1 text-center">
                    <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Occupancy</div>
                    <motion.div key={occupancy} initial={{ scale: 0.9, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 14 }} className="text-6xl font-extrabold">
                      {occupancy}
                    </motion.div>
                    <div className="text-sm text-zinc-500">of {capacity} capacity</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div className={`h-full transition-all ${usage <= 80 ? "bg-emerald-500" : usage <= 100 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${clamp(usage, 0, 120)}%` }} />
                  </div>
                  <Badge color={status.color}>{Math.round(usage)}%</Badge>
                </div>

                {/* IN/OUT buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <Button title={canEnter ? "Count entry" : "Entry locked (1-in/1-out)"} onClick={()=>{
                    if (!canEnter || isMarshal) return;
                    addEvent({ id: uid(), ts: Date.now(), type: "IN", amount: 1, deviceId, door, role });
                  }} variant="ok" disabled={!canEnter || isMarshal} className="text-lg py-5"> <Plus className="w-5 h-5"/> IN </Button>
                  <Button title="Count exit" onClick={()=>{
                    if (!canExit || isMarshal) return;
                    addEvent({ id: uid(), ts: Date.now(), type: "OUT", amount: 1, deviceId, door, role });
                  }} variant="danger" disabled={!canExit || isMarshal} className="text-lg py-5"> <Minus className="w-5 h-5"/> OUT </Button>
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-2 gap-3">
                  <Switch checked={offline} onChange={setOffline} label="Simulate offline" id="offline" />
                  <Switch checked={oneInOneOut} onChange={setOneInOneOut} label="One-in/One-out" id="oioo" />
                </div>

                {/* Manager controls */}
                {role === "Manager" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="ghost" onClick={()=>{
                      const v = prompt("Set occupancy to value:", String(occupancy));
                      if (v==null) return; const num = Math.max(0, Math.floor(Number(v))); if (!Number.isFinite(num)) return;
                      addEvent({ id: uid(), ts: Date.now(), type: "SET", value: num, deviceId, door, role, reason: "Manager set" });
                    }}><Shield className="w-4 h-4"/> Set occupancy…</Button>
                    <Button variant="ghost" onClick={()=>{
                      const v = prompt("Adjust occupancy by (e.g., -5 or 3):", "-5");
                      if (v==null) return; const num = Math.floor(Number(v)); if (!Number.isFinite(num) || num===0) return;
                      addEvent({ id: uid(), ts: Date.now(), type: "ADJUST", delta: num, deviceId, door, role, reason: "Manager adjust" });
                    }}>± Adjust…</Button>
                  </div>
                )}

                {/* Capacity */}
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-zinc-500">Max capacity</label>
                    <input type="number" min={0} max={2000} value={capacity}
                      onChange={(e)=>{
                        const v = clamp(Math.floor(Number(e.target.value || 0)), 0, 2000);
                        addEvent({ id: uid(), ts: Date.now(), type: "CAPACITY", value: v, deviceId, door, role });
                      }}
                      className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 outline-none focus:ring-2 ring-emerald-500"/>
                  </div>
                  <Button variant="ghost" onClick={()=>simulateCrowd(addEvent, deviceId, door, role)}> <Clock className="w-4 h-4"/> Simulate crowd</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chart */}
          <Card className="md:col-span-2">
            <CardHeader
              title={<span className="flex items-center gap-2"><History className="w-5 h-5"/> Tonight Timeline</span>}
              subtitle={<span className="text-zinc-500">Live count, capacity & forecast in one view</span>}
              right={<div className="flex items-center gap-2">
                <Badge color="green">Actual</Badge>
                <Badge color="blue">Forecast</Badge>
                <Badge color="amber">Capacity</Badge>
              </div>}
            />
            <CardContent className="pt-2">
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="t" tickFormatter={(t)=>niceTime(t)} type="number" domain={[series[0]?.t ?? startTs, series[series.length-1]?.t ?? startTs]} />
                    <YAxis allowDecimals={false} />
                    <Tooltip labelFormatter={(l)=>new Date(Number(l)).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} />
                    <Area type="monotone" dataKey="forecast" strokeOpacity={0} fillOpacity={0.15} />
                    <Line type="monotone" dataKey="forecast" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="actual" strokeWidth={3} dot={false} />
                    <ReferenceLine y={capacity} strokeDasharray="4 2" />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Forecast controls */}
              <div className="mt-4 grid md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs uppercase tracking-wide text-zinc-500">Hours span</label>
                  <input type="range" min={3} max={8} step={1} value={hoursSpan} onChange={(e)=>setHoursSpan(Number(e.target.value))} className="w-full"/>
                  <div className="text-sm text-zinc-500">{hoursSpan}h window</div>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-zinc-500">Peak time (h from now)</label>
                  <input type="range" min={0.5} max={6} step={0.1} value={peakHour} onChange={(e)=>setPeakHour(Number(e.target.value))} className="w-full"/>
                  <div className="text-sm text-zinc-500">~ {peakHour.toFixed(1)}h</div>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-zinc-500">Peak value</label>
                  <input type="range" min={0} max={capacity*1.2|| 240} step={5} value={peakValue} onChange={(e)=>setPeakValue(Number(e.target.value))} className="w-full"/>
                  <div className="text-sm text-zinc-500">{peakValue} ppl</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* History / Audit */}
        <div className="mt-6 grid grid-cols-1">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Shield className="w-5 h-5"/> Audit Log</span>} subtitle={<span className="text-zinc-500">Immutable event history with who/when/where</span>} />
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Time</th>
                      <th className="text-left px-4 py-3 font-semibold">Type</th>
                      <th className="text-left px-4 py-3 font-semibold">Δ / Value</th>
                      <th className="text-left px-4 py-3 font-semibold">Door</th>
                      <th className="text-left px-4 py-3 font-semibold">Role</th>
                      <th className="text-left px-4 py-3 font-semibold">Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.slice().reverse().map((e) => (
                      <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-2 whitespace-nowrap">{formatTS(e.ts)}</td>
                        <td className="px-4 py-2">
                          {e.type === "IN" && <Badge color="green">IN</Badge>}
                          {e.type === "OUT" && <Badge color="red">OUT</Badge>}
                          {e.type === "CAPACITY" && <Badge color="amber">CAPACITY</Badge>}
                          {e.type === "SET" && <Badge color="blue">SET</Badge>}
                          {e.type === "ADJUST" && <Badge>ADJUST</Badge>}
                        </td>
                        <td className="px-4 py-2">
                          {e.type === "IN" && `+${e.amount}`}
                          {e.type === "OUT" && `-${e.amount}`}
                          {e.type === "CAPACITY" && e.value}
                          {e.type === "SET" && e.value}
                          {e.type === "ADJUST" && (e.delta>0?`+${e.delta}`:e.delta)}
                        </td>
                        <td className="px-4 py-2">{e.door}</td>
                        <td className="px-4 py-2">{e.role}</td>
                        <td className="px-4 py-2 text-zinc-400 text-xs">{e.deviceId.slice(-6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer note */}
        <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-6">
          Demo only • Open two tabs to see multi-device sync • Toggle "Simulate offline" then click events and disable to watch reconciliation • Use Signage View for TV mode
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Crowd simulation helper
// ──────────────────────────────────────────────────────────────────────────────
function simulateCrowd(add: (e: LedgerEvent)=>void, deviceId: string, door: string, role: Role) {
  const script: Array<{ delay: number; type: "IN" | "OUT"; amount: number }> = [];
  // Small burst of INs, then trickle OUTs
  for (let i=0;i<12;i++) script.push({ delay: i*400, type: "IN", amount: 1 });
  for (let i=0;i<6;i++) script.push({ delay: 6000 + i*1500, type: "OUT", amount: 1 });
  script.forEach(({ delay, type, amount }) => {
    setTimeout(() => add({ id: uid(), ts: Date.now(), type, amount, deviceId, door, role }), delay);
  });
}
