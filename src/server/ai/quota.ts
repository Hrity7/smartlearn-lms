interface DailyUsage {
  date: string;
  count: number;
}

const userDailyUsageMap = new Map<number, DailyUsage>();

export function getAiDailyLimit(): number {
  const parsed = parseInt(process.env.AI_DAILY_LIMIT_PER_USER || '50', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function checkAndIncrementUserAiQuota(userId: number): {
  allowed: boolean;
  remaining: number;
  limit: number;
} {
  const limit = getAiDailyLimit();
  const today = new Date().toISOString().slice(0, 10);
  const current = userDailyUsageMap.get(userId);

  if (!current || current.date !== today) {
    userDailyUsageMap.set(userId, { date: today, count: 1 });
    return { allowed: true, remaining: limit - 1, limit };
  }

  if (current.count >= limit) {
    return { allowed: false, remaining: 0, limit };
  }

  current.count += 1;
  return { allowed: true, remaining: limit - current.count, limit };
}

export function refundUserAiQuota(userId: number): void {
  const current = userDailyUsageMap.get(userId);
  if (current && current.count > 0) {
    current.count -= 1;
  }
}

export function resetAiDailyQuota() {
  userDailyUsageMap.clear();
}
