import { LMSState, DirtyTracker, ARRAY_COLLECTIONS, KEYED_MAP_COLLECTIONS } from './types';

export function getDocumentId(collectionName: string, item: any): string {
  if (collectionName === 'enrollments') {
    return `${item.student_id}_${item.course_id}`;
  }
  if (item && item.id !== undefined && item.id !== null) {
    return String(item.id);
  }
  throw new Error(`Item in collection ${collectionName} does not have an id`);
}

export function diffState(current: LMSState, previous: LMSState | null): DirtyTracker {
  const tracker: DirtyTracker = {
    upsertedDocs: {},
    deletedDocIds: {},
    upsertedKeyedMaps: {},
    deletedKeyedMapKeys: {},
    singletons: {},
    hasChanges: false,
  };

  for (const col of ARRAY_COLLECTIONS) {
    const currentList = ((current as any)[col] || []) as any[];
    const prevList = previous ? (((previous as any)[col] || []) as any[]) : [];

    const prevMap = new Map<string, any>();
    for (const item of prevList) {
      try {
        const id = getDocumentId(col, item);
        prevMap.set(id, item);
      } catch {
        // Skip invalid items
      }
    }

    const currentMap = new Map<string, any>();
    const upserted: Record<string, any> = {};

    for (const item of currentList) {
      try {
        const id = getDocumentId(col, item);
        currentMap.set(id, item);
        const prevItem = prevMap.get(id);

        if (!prevItem || JSON.stringify(item) !== JSON.stringify(prevItem)) {
          upserted[id] = item;
          tracker.hasChanges = true;
        }
      } catch {
        // Skip invalid items
      }
    }

    if (Object.keys(upserted).length > 0) {
      tracker.upsertedDocs[col] = upserted;
    }

    if (previous) {
      const deletedIds: string[] = [];
      for (const [id] of prevMap) {
        if (!currentMap.has(id)) {
          deletedIds.push(id);
          tracker.hasChanges = true;
        }
      }
      if (deletedIds.length > 0) {
        tracker.deletedDocIds[col] = deletedIds;
      }
    }
  }

  for (const mapCol of KEYED_MAP_COLLECTIONS) {
    const currentMap = ((current as any)[mapCol] || {}) as Record<string, any>;
    const prevMap = previous ? (((previous as any)[mapCol] || {}) as Record<string, any>) : {};

    const upserted: Record<string, any> = {};
    const deletedKeys: string[] = [];

    for (const [key, val] of Object.entries(currentMap)) {
      const prevVal = prevMap[key];
      if (!prevVal || JSON.stringify(val) !== JSON.stringify(prevVal)) {
        upserted[key] = val;
        tracker.hasChanges = true;
      }
    }

    if (previous) {
      for (const key of Object.keys(prevMap)) {
        if (!(key in currentMap)) {
          deletedKeys.push(key);
          tracker.hasChanges = true;
        }
      }
    }

    if (Object.keys(upserted).length > 0) {
      tracker.upsertedKeyedMaps[mapCol] = upserted;
    }
    if (deletedKeys.length > 0) {
      tracker.deletedKeyedMapKeys[mapCol] = deletedKeys;
    }
  }

  // Singletons: settings and platform_settings
  if (!previous || JSON.stringify(current.settings) !== JSON.stringify(previous.settings)) {
    tracker.singletons['settings'] = current.settings;
    tracker.hasChanges = true;
  }

  if (
    current.platform_settings &&
    (!previous || JSON.stringify(current.platform_settings) !== JSON.stringify(previous.platform_settings))
  ) {
    tracker.singletons['platform_settings'] = current.platform_settings;
    tracker.hasChanges = true;
  }

  return tracker;
}
