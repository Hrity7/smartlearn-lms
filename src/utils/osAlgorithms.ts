export type ReplacementPolicy = 'fifo' | 'lru' | 'opt' | 'clock';

export interface PageStep {
  step: number;
  page: number;
  hit: boolean;
  evicted: number | null;
  frames: (number | null)[];
  refBits?: number[];
  clockHand?: number;
}

export interface PageReplacementResult {
  policy: string;
  frames: number;
  references: number;
  hits: number;
  faults: number;
  hitRatio: number;
  faultRatio: number;
  trace: PageStep[];
}

export function simulatePageReplacement(
  references: number[],
  frameCount: number,
  policy: ReplacementPolicy
): PageReplacementResult {
  const frames = Math.max(1, Math.min(10, Math.floor(frameCount)));
  const refs = references.slice(0, 60);
  const resident: (number | null)[] = Array(frames).fill(null);
  const loadOrder: number[] = [];
  const lastUsed = new Map<number, number>();
  const refBits: number[] = Array(frames).fill(0);
  let clockHand = 0;
  let faults = 0;
  const trace: PageStep[] = [];

  refs.forEach((page, idx) => {
    const existingSlot = resident.indexOf(page);
    const hit = existingSlot !== -1;
    let evicted: number | null = null;

    if (hit) {
      lastUsed.set(page, idx);
      refBits[existingSlot] = 1;
    } else {
      faults += 1;
      const emptySlot = resident.indexOf(null);
      if (emptySlot !== -1) {
        resident[emptySlot] = page;
        loadOrder.push(page);
        refBits[emptySlot] = 1;
        if (policy === 'clock') {
          clockHand = (emptySlot + 1) % frames;
        }
      } else {
        if (policy === 'fifo') {
          evicted = loadOrder.shift() ?? null;
          const slot = resident.indexOf(evicted);
          if (slot !== -1) resident[slot] = page;
          loadOrder.push(page);
        } else if (policy === 'lru') {
          let minIdx = Infinity;
          let victim = resident[0] as number;
          for (const p of resident) {
            if (p !== null) {
              const lu = lastUsed.get(p) ?? -1;
              if (lu < minIdx) {
                minIdx = lu;
                victim = p;
              }
            }
          }
          evicted = victim;
          const slot = resident.indexOf(victim);
          if (slot !== -1) resident[slot] = page;
          const orderPos = loadOrder.indexOf(victim);
          if (orderPos !== -1) loadOrder.splice(orderPos, 1);
          loadOrder.push(page);
        } else if (policy === 'opt') {
          let farthestUse = -1;
          let victim = resident[0] as number;
          for (const p of resident) {
            if (p !== null) {
              const nextIdx = refs.indexOf(p, idx + 1);
              const effectiveNext = nextIdx === -1 ? Infinity : nextIdx;
              if (effectiveNext > farthestUse) {
                farthestUse = effectiveNext;
                victim = p;
              }
            }
          }
          evicted = victim;
          const slot = resident.indexOf(victim);
          if (slot !== -1) resident[slot] = page;
          const orderPos = loadOrder.indexOf(victim);
          if (orderPos !== -1) loadOrder.splice(orderPos, 1);
          loadOrder.push(page);
        } else if (policy === 'clock') {
          while (refBits[clockHand] === 1) {
            refBits[clockHand] = 0;
            clockHand = (clockHand + 1) % frames;
          }
          evicted = resident[clockHand];
          resident[clockHand] = page;
          refBits[clockHand] = 1;
          clockHand = (clockHand + 1) % frames;
        }
      }
      lastUsed.set(page, idx);
    }

    trace.push({
      step: idx + 1,
      page,
      hit,
      evicted,
      frames: [...resident],
      refBits: [...refBits],
      clockHand,
    });
  });

  const hits = refs.length - faults;
  return {
    policy: policy.toUpperCase(),
    frames,
    references: refs.length,
    hits,
    faults,
    hitRatio: refs.length ? Number(((hits / refs.length) * 100).toFixed(1)) : 0,
    faultRatio: refs.length ? Number(((faults / refs.length) * 100).toFixed(1)) : 0,
    trace,
  };
}

export type DiskPolicy = 'fcfs' | 'sstf' | 'scan' | 'cscan';

export interface DiskSeekStep {
  step: number;
  from: number;
  to: number;
  distance: number;
  cumulative: number;
  note?: string;
}

export interface DiskSimulationResult {
  policy: string;
  initialHead: number;
  order: number[];
  totalMovement: number;
  averageMovement: number;
  steps: DiskSeekStep[];
}

export function simulateDiskSchedule(
  requests: number[],
  initialHead: number,
  policy: DiskPolicy,
  maxTrack = 199
): DiskSimulationResult {
  const head = Math.max(0, Math.min(maxTrack, Math.floor(initialHead)));
  const cleanReqs = requests.map((r) => Math.max(0, Math.min(maxTrack, Math.floor(r))));
  const order: number[] = [];
  const steps: DiskSeekStep[] = [];
  let current = head;
  let total = 0;

  if (policy === 'fcfs') {
    cleanReqs.forEach((track, i) => {
      const dist = Math.abs(track - current);
      total += dist;
      order.push(track);
      steps.push({ step: i + 1, from: current, to: track, distance: dist, cumulative: total });
      current = track;
    });
  } else if (policy === 'sstf') {
    const pending = cleanReqs.map((track, idx) => ({ idx, track }));
    let stepNum = 1;
    while (pending.length > 0) {
      pending.sort((a, b) => {
        const dA = Math.abs(a.track - current);
        const dB = Math.abs(b.track - current);
        return dA !== dB ? dA - dB : a.idx - b.idx;
      });
      const chosen = pending.shift()!;
      const dist = Math.abs(chosen.track - current);
      total += dist;
      order.push(chosen.track);
      steps.push({
        step: stepNum++,
        from: current,
        to: chosen.track,
        distance: dist,
        cumulative: total,
      });
      current = chosen.track;
    }
  } else if (policy === 'scan') {
    // Elevator moving upward toward maxTrack first, then reversing
    const upper = cleanReqs.filter((t) => t >= head).sort((a, b) => a - b);
    const lower = cleanReqs.filter((t) => t < head).sort((a, b) => b - a);
    const sequence = [...upper];
    if (lower.length > 0 && (sequence.length === 0 || sequence[sequence.length - 1] !== maxTrack)) {
      sequence.push(maxTrack);
    }
    sequence.push(...lower);
    sequence.forEach((track, i) => {
      const dist = Math.abs(track - current);
      total += dist;
      order.push(track);
      steps.push({
        step: i + 1,
        from: current,
        to: track,
        distance: dist,
        cumulative: total,
        note: track === maxTrack && !cleanReqs.includes(maxTrack) ? 'Boundary reversal' : undefined,
      });
      current = track;
    });
  } else if (policy === 'cscan') {
    const upper = cleanReqs.filter((t) => t >= head).sort((a, b) => a - b);
    const lower = cleanReqs.filter((t) => t < head).sort((a, b) => a - b);
    const sequence = [...upper];
    if (lower.length > 0) {
      if (sequence.length === 0 || sequence[sequence.length - 1] !== maxTrack) {
        sequence.push(maxTrack);
      }
      sequence.push(0);
      sequence.push(...lower);
    }
    sequence.forEach((track, i) => {
      const dist = Math.abs(track - current);
      total += dist;
      order.push(track);
      steps.push({
        step: i + 1,
        from: current,
        to: track,
        distance: dist,
        cumulative: total,
        note:
          (track === maxTrack || track === 0) && !cleanReqs.includes(track)
            ? 'Circular wrap'
            : undefined,
      });
      current = track;
    });
  }

  return {
    policy: policy.toUpperCase(),
    initialHead: head,
    order,
    totalMovement: total,
    averageMovement: cleanReqs.length ? Number((total / cleanReqs.length).toFixed(1)) : 0,
    steps,
  };
}

export interface BankerProcessState {
  id: string;
  label?: string;
  max: Record<string, number>;
  allocation: Record<string, number>;
}

export interface BankerSafetyStep {
  step: number;
  pid: string;
  need: Record<string, number>;
  workBefore: Record<string, number>;
  workAfter: Record<string, number>;
  explanation: string;
}

export interface BankerSimulationResult {
  keys: string[];
  total: Record<string, number>;
  available: Record<string, number>;
  processes: Array<{
    id: string;
    label?: string;
    max: Record<string, number>;
    allocation: Record<string, number>;
    need: Record<string, number>;
  }>;
  safe: boolean;
  safeSequence: string[];
  steps: BankerSafetyStep[];
  requestVerdict?: {
    granted: boolean;
    pid: string;
    request: Record<string, number>;
    reason: string;
  };
}

export function simulateBankersAlgorithm(
  total: Record<string, number>,
  processes: BankerProcessState[],
  testRequest?: { pid: string; request: Record<string, number> }
): BankerSimulationResult {
  const keys = Object.keys(total);
  const procClones = processes.map((p) => ({
    id: p.id,
    label: p.label,
    max: { ...p.max },
    allocation: { ...p.allocation },
    need: Object.fromEntries(keys.map((k) => [k, Math.max(0, (p.max[k] ?? 0) - (p.allocation[k] ?? 0))])),
  }));

  const allocatedSum: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const p of procClones) {
    for (const k of keys) {
      allocatedSum[k] += p.allocation[k] ?? 0;
    }
  }

  const available: Record<string, number> = Object.fromEntries(
    keys.map((k) => [k, Math.max(0, (total[k] ?? 0) - allocatedSum[k])])
  );

  let requestVerdict: BankerSimulationResult['requestVerdict'] | undefined;

  if (testRequest && keys.some((k) => (testRequest.request[k] ?? 0) > 0)) {
    const target = procClones.find((p) => p.id === testRequest.pid);
    if (!target) {
      requestVerdict = {
        granted: false,
        pid: testRequest.pid,
        request: testRequest.request,
        reason: `Process ${testRequest.pid} is not registered in the resource table.`,
      };
    } else if (keys.some((k) => (testRequest.request[k] ?? 0) > (target.need[k] ?? 0))) {
      requestVerdict = {
        granted: false,
        pid: testRequest.pid,
        request: testRequest.request,
        reason: `Rejected: Request exceeds declared maximum remaining Need for ${testRequest.pid}.`,
      };
    } else if (keys.some((k) => (testRequest.request[k] ?? 0) > (available[k] ?? 0))) {
      requestVerdict = {
        granted: false,
        pid: testRequest.pid,
        request: testRequest.request,
        reason: `Deferred: Requested units exceed currently Available vector (${keys.map((k) => `${k}:${available[k]}`).join(', ')}).`,
      };
    } else {
      // Tentatively allocate
      for (const k of keys) {
        const reqVal = testRequest.request[k] ?? 0;
        available[k] -= reqVal;
        target.allocation[k] += reqVal;
        target.need[k] -= reqVal;
      }
    }
  }

  // Run Dijkstra's Safety Algorithm
  const work = { ...available };
  const finish = new Set<string>();
  const safeSequence: string[] = [];
  const steps: BankerSafetyStep[] = [];

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const p of procClones) {
      if (finish.has(p.id)) continue;
      const canFinish = keys.every((k) => (p.need[k] ?? 0) <= (work[k] ?? 0));
      if (canFinish) {
        const workBefore = { ...work };
        for (const k of keys) {
          work[k] += p.allocation[k] ?? 0;
        }
        const workAfter = { ...work };
        finish.add(p.id);
        safeSequence.push(p.id);
        steps.push({
          step: steps.length + 1,
          pid: p.id,
          need: { ...p.need },
          workBefore,
          workAfter,
          explanation: `Need(${p.id}) <= Work (${keys.map((k) => `${p.need[k]}<=${workBefore[k]}`).join(', ')}). Process ${p.id} completes and releases Allocation (${keys.map((k) => `${k}:+${p.allocation[k]}`).join(', ')}).`,
        });
        progressed = true;
      }
    }
  }

  const safe = finish.size === procClones.length;

  if (testRequest && !requestVerdict && keys.some((k) => (testRequest.request[k] ?? 0) > 0)) {
    if (safe) {
      requestVerdict = {
        granted: true,
        pid: testRequest.pid,
        request: testRequest.request,
        reason: `Granted: Tentative allocation leaves a verified Safe Sequence <${safeSequence.join(', ')}>.`,
      };
    } else {
      requestVerdict = {
        granted: false,
        pid: testRequest.pid,
        request: testRequest.request,
        reason: `Blocked by Banker's Safety Check: Granting (${keys.map((k) => `${k}:${testRequest.request[k] ?? 0}`).join(', ')}) to ${testRequest.pid} leaves NO safe completion sequence (deadlock risk).`,
      };
    }
  }

  return {
    keys,
    total,
    available,
    processes: procClones,
    safe,
    safeSequence,
    steps,
    requestVerdict,
  };
}

export type CpuPolicy = 'fcfs' | 'sjf' | 'srtf' | 'priority' | 'rr';

export interface CpuProcessInput {
  pid: string;
  name: string;
  arrival: number;
  burst: number;
  priority: number;
}

export interface GanttSlice {
  pid: string;
  name: string;
  start: number;
  end: number;
  duration: number;
}

export interface CpuProcessMetrics extends CpuProcessInput {
  startTime: number;
  completionTime: number;
  turnaroundTime: number;
  waitingTime: number;
  responseTime: number;
}

export interface CpuScheduleSimulationResult {
  policy: string;
  quantum: number;
  gantt: GanttSlice[];
  metrics: CpuProcessMetrics[];
  avgTurnaround: number;
  avgWaiting: number;
  avgResponse: number;
  totalDuration: number;
}

export function simulateCpuScheduling(
  processes: CpuProcessInput[],
  policy: CpuPolicy,
  quantum = 2
): CpuScheduleSimulationResult {
  const q = Math.max(1, Math.floor(quantum));
  const items = processes.map((p, idx) => ({
    ...p,
    idx,
    arrival: Math.max(0, Math.floor(p.arrival)),
    burst: Math.max(1, Math.floor(p.burst)),
    priority: Math.floor(p.priority),
    remaining: Math.max(1, Math.floor(p.burst)),
    firstStart: -1,
    completion: 0,
  }));

  const gantt: GanttSlice[] = [];
  let time = 0;
  let completed = 0;
  const n = items.length;

  const pushSlice = (pid: string, name: string, start: number, end: number) => {
    if (end <= start) return;
    const prev = gantt[gantt.length - 1];
    if (prev && prev.pid === pid && prev.end === start) {
      prev.end = end;
      prev.duration = prev.end - prev.start;
    } else {
      gantt.push({ pid, name, start, end, duration: end - start });
    }
  };

  if (policy === 'rr') {
    const readyQueue: typeof items = [];
    const arrived = new Set<string>();
    const enqueueArrivals = (upTo: number) => {
      items
        .filter((p) => !arrived.has(p.pid) && p.arrival <= upTo)
        .sort((a, b) => a.arrival - b.arrival || a.idx - b.idx)
        .forEach((p) => {
          arrived.add(p.pid);
          readyQueue.push(p);
        });
    };

    enqueueArrivals(0);
    while (completed < n) {
      if (readyQueue.length === 0) {
        const nextArrival = Math.min(...items.filter((p) => p.remaining > 0).map((p) => p.arrival));
        pushSlice('IDLE', 'CPU Idle', time, nextArrival);
        time = nextArrival;
        enqueueArrivals(time);
        continue;
      }
      const current = readyQueue.shift()!;
      if (current.firstStart === -1) current.firstStart = time;
      const slice = Math.min(q, current.remaining);
      pushSlice(current.pid, current.name, time, time + slice);
      time += slice;
      current.remaining -= slice;
      enqueueArrivals(time);
      if (current.remaining > 0) {
        readyQueue.push(current);
      } else {
        current.completion = time;
        completed += 1;
      }
    }
  } else if (policy === 'srtf') {
    let safety = 0;
    while (completed < n && safety < 2000) {
      safety++;
      const available = items.filter((p) => p.remaining > 0 && p.arrival <= time);
      if (available.length === 0) {
        const nextArrival = Math.min(...items.filter((p) => p.remaining > 0).map((p) => p.arrival));
        pushSlice('IDLE', 'CPU Idle', time, nextArrival);
        time = nextArrival;
        continue;
      }
      available.sort((a, b) => a.remaining - b.remaining || a.arrival - b.arrival || a.idx - b.idx);
      const chosen = available[0];
      if (chosen.firstStart === -1) chosen.firstStart = time;
      pushSlice(chosen.pid, chosen.name, time, time + 1);
      time += 1;
      chosen.remaining -= 1;
      if (chosen.remaining === 0) {
        chosen.completion = time;
        completed += 1;
      }
    }
  } else {
    // Non-preemptive FCFS, SJF, or Priority (with aging)
    while (completed < n) {
      const available = items.filter((p) => p.remaining > 0 && p.arrival <= time);
      if (available.length === 0) {
        const nextArrival = Math.min(...items.filter((p) => p.remaining > 0).map((p) => p.arrival));
        pushSlice('IDLE', 'CPU Idle', time, nextArrival);
        time = nextArrival;
        continue;
      }
      if (policy === 'fcfs') {
        available.sort((a, b) => a.arrival - b.arrival || a.idx - b.idx);
      } else if (policy === 'sjf') {
        available.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.idx - b.idx);
      } else {
        // Priority with aging: waiting improves priority
        available.sort((a, b) => {
          const effA = a.priority - Math.floor((time - a.arrival) / 5);
          const effB = b.priority - Math.floor((time - b.arrival) / 5);
          return effA - effB || a.arrival - b.arrival || a.idx - b.idx;
        });
      }
      const chosen = available[0];
      chosen.firstStart = time;
      pushSlice(chosen.pid, chosen.name, time, time + chosen.burst);
      time += chosen.burst;
      chosen.remaining = 0;
      chosen.completion = time;
      completed += 1;
    }
  }

  const metrics: CpuProcessMetrics[] = items.map((p) => {
    const tat = p.completion - p.arrival;
    const wt = tat - p.burst;
    const rt = p.firstStart - p.arrival;
    return {
      pid: p.pid,
      name: p.name,
      arrival: p.arrival,
      burst: p.burst,
      priority: p.priority,
      startTime: p.firstStart,
      completionTime: p.completion,
      turnaroundTime: tat,
      waitingTime: wt,
      responseTime: rt,
    };
  });

  const avgTurnaround = n
    ? Number((metrics.reduce((acc, m) => acc + m.turnaroundTime, 0) / n).toFixed(2))
    : 0;
  const avgWaiting = n
    ? Number((metrics.reduce((acc, m) => acc + m.waitingTime, 0) / n).toFixed(2))
    : 0;
  const avgResponse = n
    ? Number((metrics.reduce((acc, m) => acc + m.responseTime, 0) / n).toFixed(2))
    : 0;

  return {
    policy: policy.toUpperCase(),
    quantum: q,
    gantt,
    metrics,
    avgTurnaround,
    avgWaiting,
    avgResponse,
    totalDuration: time,
  };
}
