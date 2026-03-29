import { getDatasetKey, normalizeQuery } from './query'
import { normalizeWindow } from './windowing'
import type {
  GridCachedDataSourceOptions,
  GridCachedNodeWindow,
  GridCachedWindow,
  GridDataSource,
  GridEditableDataSource,
  GridExecutionRequest,
  GridHierarchicalDataSource,
  GridHierarchicalLiveDataSource,
  GridLiveDataSource,
  GridLoadTarget,
  GridNodeLoadResult,
  GridPatch,
  GridQuery,
  GridQueryCache,
  GridQueryCacheOptions,
  GridWindow,
} from './types'

type CacheDataset<TData> = {
  windows: Map<string, GridCachedWindow<TData>>
  nodeWindows: Map<string, GridCachedNodeWindow<TData>>
  lastUsedAt: number
}

function getWindowKey(window: GridWindow): string {
  return `${window.start}:${window.end}`
}

function windowsOverlap(left: GridWindow, right: GridWindow): boolean {
  return left.start < right.end && right.start < left.end
}

function parseWindowKey(windowKey: string): GridWindow {
  const [start, end] = windowKey.split(':').map(Number)
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
  }
}

function getTargetKey(target: GridLoadTarget): string {
  return target.kind === 'root-window'
    ? `root:${getWindowKey(target.window)}`
    : `children:${target.parentNodeId}:${getWindowKey(target.window)}`
}

function patchTouchesQueryShape(
  query: GridQuery,
  changedFields?: readonly string[],
): boolean {
  if (!changedFields || changedFields.length === 0) {
    return true
  }

  if (query.globalFilter !== null && query.globalFilter !== undefined) {
    return true
  }

  const sensitiveFields = new Set<string>([
    ...query.sort.map((entry) => entry.columnId),
    ...query.filters.map((entry) => entry.columnId),
  ])

  return changedFields.some((field) => sensitiveFields.has(field))
}

export class MemoryGridQueryCache<TData> implements GridQueryCache<TData> {
  private readonly datasets = new Map<string, CacheDataset<TData>>()

  constructor(private readonly options: GridQueryCacheOptions = {}) {}

  get(datasetKey: string, window: GridWindow): GridCachedWindow<TData> | null {
    const dataset = this.datasets.get(datasetKey)
    if (!dataset) {
      return null
    }

    dataset.lastUsedAt = Date.now()
    return dataset.windows.get(getWindowKey(normalizeWindow(window))) ?? null
  }

  set(
    datasetKey: string,
    window: GridWindow,
    value: GridCachedWindow<TData>,
  ): void {
    const normalizedWindow = normalizeWindow(window)
    const now = Date.now()
    const dataset = this.datasets.get(datasetKey) ?? {
      windows: new Map<string, GridCachedWindow<TData>>(),
      nodeWindows: new Map<string, GridCachedNodeWindow<TData>>(),
      lastUsedAt: now,
    }

    dataset.lastUsedAt = now
    dataset.windows.set(getWindowKey(normalizedWindow), value)
    this.datasets.set(datasetKey, dataset)
    this.pruneDataset(dataset)
    this.pruneDatasets()
  }

  markWindowStale(datasetKey: string, window: GridWindow): void {
    const dataset = this.datasets.get(datasetKey)
    if (!dataset) {
      return
    }

    const normalizedWindow = normalizeWindow(window)
    for (const [windowKey, entry] of dataset.windows) {
      if (!windowsOverlap(parseWindowKey(windowKey), normalizedWindow)) {
        continue
      }

      dataset.windows.set(windowKey, {
        ...entry,
        staleAt: entry.staleAt ?? Date.now(),
      })
    }
  }

  getNodes(
    datasetKey: string,
    target: GridLoadTarget,
  ): GridCachedNodeWindow<TData> | null {
    const dataset = this.datasets.get(datasetKey)
    if (!dataset) {
      return null
    }

    dataset.lastUsedAt = Date.now()
    return dataset.nodeWindows.get(getTargetKey(target)) ?? null
  }

  setNodes(
    datasetKey: string,
    target: GridLoadTarget,
    value: GridCachedNodeWindow<TData>,
  ): void {
    const now = Date.now()
    const dataset = this.datasets.get(datasetKey) ?? {
      windows: new Map<string, GridCachedWindow<TData>>(),
      nodeWindows: new Map<string, GridCachedNodeWindow<TData>>(),
      lastUsedAt: now,
    }

    dataset.lastUsedAt = now
    dataset.nodeWindows.set(getTargetKey(target), value)
    this.datasets.set(datasetKey, dataset)
    this.pruneDataset(dataset)
    this.pruneDatasets()
  }

  markNodesStale(datasetKey: string, target: GridLoadTarget): void {
    const dataset = this.datasets.get(datasetKey)
    if (!dataset) {
      return
    }

    const key = getTargetKey(target)
    const entry = dataset.nodeWindows.get(key)
    if (!entry) {
      return
    }

    dataset.nodeWindows.set(key, {
      ...entry,
      staleAt: entry.staleAt ?? Date.now(),
    })
  }

  markDatasetStale(datasetKey: string): void {
    const dataset = this.datasets.get(datasetKey)
    if (!dataset) {
      return
    }

    for (const [windowKey, entry] of dataset.windows) {
      dataset.windows.set(windowKey, {
        ...entry,
        staleAt: entry.staleAt ?? Date.now(),
      })
    }

    for (const [targetKey, entry] of dataset.nodeWindows) {
      dataset.nodeWindows.set(targetKey, {
        ...entry,
        staleAt: entry.staleAt ?? Date.now(),
      })
    }
  }

  clear(datasetKey?: string): void {
    if (datasetKey === undefined) {
      this.datasets.clear()
      return
    }

    this.datasets.delete(datasetKey)
  }

  private pruneDataset(dataset: CacheDataset<TData>) {
    const maxWindowsPerDataset = Math.max(
      1,
      this.options.maxWindowsPerDataset ?? 20,
    )
    while (
      dataset.windows.size + dataset.nodeWindows.size >
      maxWindowsPerDataset
    ) {
      if (dataset.windows.size >= dataset.nodeWindows.size) {
        const oldestKey = dataset.windows.keys().next().value
        if (oldestKey !== undefined) {
          dataset.windows.delete(oldestKey)
          continue
        }
      }

      const oldestNodeKey = dataset.nodeWindows.keys().next().value
      if (oldestNodeKey === undefined) {
        break
      }

      dataset.nodeWindows.delete(oldestNodeKey)
    }
  }

  private pruneDatasets() {
    const maxDatasets = Math.max(1, this.options.maxDatasets ?? 10)
    while (this.datasets.size > maxDatasets) {
      let oldestKey: string | null = null
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [datasetKey, dataset] of this.datasets) {
        if (dataset.lastUsedAt >= oldestAt) {
          continue
        }

        oldestAt = dataset.lastUsedAt
        oldestKey = datasetKey
      }

      if (oldestKey === null) {
        break
      }

      this.datasets.delete(oldestKey)
    }
  }
}

export function createCachedDataSource<TData>(
  base: GridDataSource<TData>,
  cache: GridQueryCache<TData> = new MemoryGridQueryCache<TData>(),
  options: GridCachedDataSourceOptions<TData>,
): GridLiveDataSource<TData> &
  GridEditableDataSource<TData> &
  Partial<GridHierarchicalLiveDataSource<TData>> {
  const staleTimeMs = Math.max(0, options.staleTimeMs ?? 5_000)
  const trackedWindowsByDataset = new Map<string, Set<string>>()

  const trackWindow = (datasetKey: string, window: GridWindow) => {
    const windowKey = getWindowKey(window)
    const trackedWindows =
      trackedWindowsByDataset.get(datasetKey) ?? new Set<string>()
    trackedWindows.add(windowKey)
    trackedWindowsByDataset.set(datasetKey, trackedWindows)
  }

  const writeWindow = (
    query: GridQuery,
    rows: readonly TData[],
    pageInfo: Awaited<ReturnType<GridDataSource<TData>['load']>>['pageInfo'],
  ) => {
    if (query.slice.kind !== 'offset') {
      return
    }

    const window = {
      start: query.slice.offset,
      end: query.slice.offset + query.slice.limit,
    }
    const datasetKey = getDatasetKey(query)
    trackWindow(datasetKey, window)
    cache.set(datasetKey, window, {
      rows,
      pageInfo,
      rowCount:
        pageInfo.kind === 'offset' ? (pageInfo.totalRowCount ?? null) : null,
      rowIds: rows.map((row) => options.getRowId(row)),
      cachedAt: Date.now(),
      staleAt: null,
    })
  }

  const updateCacheFromPatch = (query: GridQuery, patch: GridPatch<TData>) => {
    if (query.slice.kind !== 'offset') {
      return
    }

    const datasetKey = getDatasetKey(query)
    if (query.hierarchy && query.hierarchy.mode !== 'flat') {
      cache.markDatasetStale(datasetKey)
      return
    }

    if (patch.type === 'invalidate' || patch.type === 'children-invalidate') {
      cache.markDatasetStale(datasetKey)
      return
    }

    if (
      patch.type === 'row-delete' ||
      patchTouchesQueryShape(query, patch.changedFields)
    ) {
      cache.markDatasetStale(datasetKey)
      return
    }

    const trackedWindowKeys = trackedWindowsByDataset.get(datasetKey)
    if (!trackedWindowKeys || trackedWindowKeys.size === 0) {
      cache.markDatasetStale(datasetKey)
      return
    }

    const rowId = options.getRowId(patch.row)
    let updatedWindowCount = 0
    const missingWindowKeys: string[] = []

    for (const windowKey of trackedWindowKeys) {
      const window = parseWindowKey(windowKey)
      const cachedWindow = cache.get(datasetKey, window)
      if (!cachedWindow) {
        missingWindowKeys.push(windowKey)
        continue
      }

      const rowIndex = cachedWindow.rowIds.indexOf(rowId)
      if (rowIndex === -1) {
        continue
      }

      updatedWindowCount += 1
      const nextRows = [...cachedWindow.rows]
      const nextRowIds = [...cachedWindow.rowIds]
      nextRows[rowIndex] = patch.row
      nextRowIds[rowIndex] = rowId
      cache.set(datasetKey, window, {
        ...cachedWindow,
        rows: nextRows,
        rowIds: nextRowIds,
        cachedAt: Date.now(),
        staleAt:
          patch.changedFields && patch.changedFields.length > 0
            ? cachedWindow.staleAt
            : Date.now(),
      })
    }

    for (const windowKey of missingWindowKeys) {
      trackedWindowKeys.delete(windowKey)
    }

    if (updatedWindowCount === 0) {
      cache.markDatasetStale(datasetKey)
    }
  }

  const cachedDataSource: GridLiveDataSource<TData> &
    GridEditableDataSource<TData> = {
    async load(query, context) {
      const normalizedQuery = normalizeQuery(query)
      if (normalizedQuery.slice.kind !== 'offset') {
        return base.load(normalizedQuery, context)
      }

      const datasetKey = getDatasetKey(normalizedQuery)
      const window = {
        start: normalizedQuery.slice.offset,
        end: normalizedQuery.slice.offset + normalizedQuery.slice.limit,
      }
      trackWindow(datasetKey, window)
      const cachedWindow = cache.get(datasetKey, window)
      const now = Date.now()
      const isFresh =
        cachedWindow !== null &&
        cachedWindow.staleAt === null &&
        now - cachedWindow.cachedAt <= staleTimeMs

      if (context.reason !== 'refresh' && cachedWindow) {
        return {
          rows: [...cachedWindow.rows],
          pageInfo: cachedWindow.pageInfo,
          cacheState: isFresh ? 'fresh' : 'stale',
        }
      }

      const result = await base.load(normalizedQuery, context)
      writeWindow(normalizedQuery, result.rows, result.pageInfo)
      return {
        ...result,
        cacheState: cachedWindow ? 'fresh' : 'miss',
      }
    },
    subscribe:
      'subscribe' in base &&
      typeof (base as GridLiveDataSource<TData>).subscribe === 'function'
        ? (query, sink) =>
            (base as GridLiveDataSource<TData>).subscribe!(query, (patch) => {
              updateCacheFromPatch(normalizeQuery(query), patch)
              sink(patch)
            })
        : undefined,
    save:
      'save' in base &&
      typeof (base as GridEditableDataSource<TData>).save === 'function'
        ? async (request, context) => {
            const result = await (base as GridEditableDataSource<TData>).save!(
              request,
              context,
            )
            for (const datasetKey of trackedWindowsByDataset.keys()) {
              cache.markDatasetStale(datasetKey)
            }
            return result
          }
        : undefined,
  }

  if (
    'subscribeNodes' in base &&
    typeof (base as GridHierarchicalLiveDataSource<TData>).subscribeNodes ===
      'function'
  ) {
    ;(
      cachedDataSource as GridLiveDataSource<TData> &
        GridEditableDataSource<TData> &
        GridHierarchicalLiveDataSource<TData>
    ).subscribeNodes = (query, expansion, sink) =>
      (base as GridHierarchicalLiveDataSource<TData>).subscribeNodes!(
        query,
        expansion,
        (patch) => {
          updateCacheFromPatch(normalizeQuery(query), patch)
          sink(patch)
        },
      )
  }

  if (
    'loadNodes' in base &&
    typeof (base as GridHierarchicalDataSource<TData>).loadNodes === 'function'
  ) {
    ;(
      cachedDataSource as GridLiveDataSource<TData> &
        GridEditableDataSource<TData> &
        GridHierarchicalDataSource<TData>
    ).loadNodes = async (
      request: GridExecutionRequest,
      context,
    ): Promise<GridNodeLoadResult<TData>> => {
      const datasetKey = getDatasetKey(request.query)
      const cachedWindow = cache.getNodes?.(datasetKey, request.target) ?? null
      const now = Date.now()
      const isFresh =
        cachedWindow !== null &&
        cachedWindow.staleAt === null &&
        now - cachedWindow.cachedAt <= staleTimeMs

      if (context.reason !== 'refresh' && cachedWindow) {
        return {
          target: request.target,
          nodes: [...cachedWindow.nodes],
          totalChildren: cachedWindow.totalChildren,
          totalRowCount: cachedWindow.totalRowCount,
          cacheState: isFresh ? 'fresh' : 'stale',
        }
      }

      const result = await (
        base as GridHierarchicalDataSource<TData>
      ).loadNodes(request, context)

      cache.setNodes?.(datasetKey, request.target, {
        nodes: result.nodes,
        totalChildren: result.totalChildren,
        totalRowCount: result.totalRowCount ?? null,
        cachedAt: Date.now(),
        staleAt: null,
      } satisfies GridCachedNodeWindow<TData>)

      return {
        ...result,
        cacheState: cachedWindow ? 'fresh' : 'miss',
      }
    }
  }

  return cachedDataSource
}
