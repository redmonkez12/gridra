import {
  DEFAULT_OVERSCAN,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_VIEWPORT_DEBOUNCE_MS,
  getMatchKey,
  getPageWindow,
  getViewKey,
  normalizeHierarchy,
  normalizeQuery,
} from './query'
import {
  clearNodeStore,
  createEmptyNodeStore,
  getContainerKey,
  getContainerState,
  getNodeById,
  getNodeByRowId,
  getVisibleProjection,
  markContainerWindowStale,
  removeStoredNode,
  toLegacyRowStore,
  updateStoredNode,
  upsertNodeStoreWindow,
} from './hierarchy'
import {
  createAllMatchingSelection,
  createEmptyColumnsState,
  createEmptySelectionState,
  createSelectionRequest,
  getSelectionScopeStatus,
  isRowSelected,
  normalizeColumnsState,
  normalizeSelectionState,
} from './state'
import { getMissingWindows, mergeWindows } from './windowing'
import type {
  GridCellDraft,
  GridColumnsState,
  GridController,
  GridControllerOptions,
  GridDataSource,
  GridEditableDataSource,
  GridExecutionRequest,
  GridHierarchicalDataSource,
  GridHierarchicalLiveDataSource,
  GridLoadReason,
  GridLoadTarget,
  GridLiveDataSource,
  GridLiveState,
  GridNode,
  GridNodeId,
  GridNodeLoadResult,
  GridNodeStore,
  GridPatch,
  GridQuery,
  GridRequestState,
  GridRowDraft,
  GridRowId,
  GridRowRevision,
  GridSaveMode,
  GridSelectionState,
  GridState,
  GridVisibleNode,
  GridVisibleRow,
  GridWindow,
} from './types'

type ActiveRequest = {
  requestId: number
  reason: GridLoadReason
  viewKey: string
  target: GridLoadTarget
  controller: AbortController
}

function getDraftKey(rowId: GridRowId): string {
  return String(rowId)
}

function createInitialRequestState(): GridRequestState {
  return {
    status: 'idle',
    error: null,
    inFlightCount: 0,
    lastRequestId: 0,
    isInitialLoading: false,
    isReloading: false,
  }
}

function createInitialLiveState(): GridLiveState {
  return {
    status: 'idle',
    error: null,
    subscriptionKey: null,
    lastPatchAt: null,
    hasPendingInvalidation: false,
  }
}

function createInitialEditingState(saveMode: GridSaveMode) {
  return {
    saveMode,
    activeCell: null,
    drafts: {},
    pending: {},
  }
}

function createInitialState<TData>(
  query: GridQuery,
  virtualization: GridControllerOptions<TData>['virtualization'],
  initialSelection?: GridSelectionState,
  initialColumns?: GridColumnsState,
  saveMode: GridSaveMode = 'pessimistic',
): GridState<TData> {
  const normalizedQuery = normalizeQuery(query)
  const initialViewport = getPageWindow(normalizedQuery)

  return {
    query: normalizedQuery,
    columns: normalizeColumnsState(initialColumns ?? createEmptyColumnsState()),
    selection: normalizeSelectionState(
      initialSelection ?? createEmptySelectionState(),
    ),
    hierarchy: {
      expandedNodeIds: [],
    },
    data: {
      viewKey: getViewKey(normalizedQuery),
      matchKey: getMatchKey(normalizedQuery),
      rowStore: toLegacyRowStore([]),
      nodeStore: createEmptyNodeStore<TData>(),
      rowCount: null,
      visibleRowCount: 0,
      hasNextPage: null,
      pageInfo: null,
      hasData: false,
      cacheState: 'miss',
    },
    request: createInitialRequestState(),
    virtualization: {
      enabled: virtualization?.enabled ?? false,
      rowHeight: virtualization?.rowHeight ?? DEFAULT_ROW_HEIGHT,
      overscan: virtualization?.overscan ?? DEFAULT_OVERSCAN,
      viewportDebounceMs:
        virtualization?.viewportDebounceMs ?? DEFAULT_VIEWPORT_DEBOUNCE_MS,
      viewport: initialViewport,
      requestedRange: null,
    },
    live: createInitialLiveState(),
    editing: createInitialEditingState(saveMode),
  }
}

function clampWindow(window: GridWindow, rowCount: number | null): GridWindow {
  if (rowCount === null) {
    return window
  }

  return {
    start: Math.min(window.start, rowCount),
    end: Math.min(window.end, rowCount),
  }
}

function isHierarchicalMode(query: GridQuery): boolean {
  const hierarchy = normalizeHierarchy(query.hierarchy)
  return hierarchy.mode !== 'flat'
}

function targetKey(target: GridLoadTarget): string {
  return target.kind === 'root-window'
    ? `root:${target.window.start}:${target.window.end}`
    : `children:${target.parentNodeId}:${target.window.start}:${target.window.end}`
}

function groupIndexes(indexes: readonly number[]): GridWindow[] {
  if (indexes.length === 0) {
    return []
  }

  const sorted = [...indexes].sort((a, b) => a - b)
  const windows: GridWindow[] = []
  let start = sorted[0]
  let previous = sorted[0]

  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value
      continue
    }

    windows.push({ start, end: previous + 1 })
    start = value
    previous = value
  }

  windows.push({ start, end: previous + 1 })
  return windows
}

function makeNodeFromRow<TData>(
  row: TData,
  getRowId: (row: TData) => GridRowId,
  getRowRevision?: (row: TData) => GridRowRevision | undefined,
): GridNode<TData> {
  const rowId = getRowId(row)
  return {
    kind: 'leaf',
    nodeId: `row:${String(rowId)}`,
    parentNodeId: null,
    depth: 0,
    isExpanded: false,
    isExpandable: false,
    childCount: null,
    rowId,
    row,
    revision: getRowRevision?.(row),
  }
}

function patchTouchesQueryShape(
  query: GridQuery,
  changedFields?: readonly string[],
) {
  if (!changedFields || changedFields.length === 0) {
    return true
  }

  if (query.globalFilter !== null && query.globalFilter !== undefined) {
    return true
  }

  const hierarchy = normalizeHierarchy(query.hierarchy)
  const aggregates =
    hierarchy.mode === 'flat' ? [] : (hierarchy.aggregates ?? [])
  const sensitiveFields = new Set<string>([
    ...query.sort.map((entry) => entry.columnId),
    ...query.filters.map((entry) => entry.columnId),
    ...(hierarchy.mode === 'group'
      ? hierarchy.groupBy.map((entry) => entry.columnId)
      : []),
    ...aggregates.map((entry) => entry.columnId),
  ])

  return changedFields.some((field) => sensitiveFields.has(field))
}

export function createGridController<TData>(
  options: GridControllerOptions<TData>,
): GridController<TData> {
  const assertSupportedQuery = (query: GridQuery) => {
    if (query.slice.kind === 'cursor') {
      throw new Error(
        'Cursor pagination is not supported yet. Use offset pagination for this grid.',
      )
    }

    if (isHierarchicalMode(query)) {
      const dataSource = options.dataSource as GridHierarchicalDataSource<TData>
      if (typeof dataSource.loadNodes !== 'function') {
        throw new Error(
          'Hierarchical queries require a data source that implements loadNodes(request, context).',
        )
      }
    }
  }

  const initialQuery = normalizeQuery(options.initialQuery)
  assertSupportedQuery(initialQuery)

  let dataSource = options.dataSource
  let getRowId = options.getRowId
  let getRowRevision = options.getRowRevision
  const editingOptions = options.editing
  let state = createInitialState<TData>(
    initialQuery,
    options.virtualization,
    options.initialSelection,
    options.initialColumns,
    options.editing?.saveMode ?? 'pessimistic',
  )
  const listeners = new Set<() => void>()
  const activeRequests = new Map<string, ActiveRequest>()
  const retryRequests = new Map<
    string,
    {
      viewKey: string
      reason: GridLoadReason
      timeoutId: ReturnType<typeof setTimeout>
      target: GridLoadTarget
    }
  >()
  const activeSaves = new Set<AbortController>()
  const retryOptions = {
    maxRetries: Math.max(0, options.retry?.maxRetries ?? 2),
    baseDelayMs: Math.max(0, options.retry?.baseDelayMs ?? 150),
    maxDelayMs: Math.max(0, options.retry?.maxDelayMs ?? 1_000),
    backoffMultiplier: Math.max(1, options.retry?.backoffMultiplier ?? 2),
  }
  let projectionCache: {
    nodeStore: GridNodeStore<TData>
    expandedKey: string
    rows: readonly GridVisibleRow<TData>[]
    nodes: readonly GridVisibleNode<TData>[]
    totalVisibleCount: number
  } | null = null
  let visibleSliceCache: {
    nodeStore: GridNodeStore<TData>
    drafts: GridState<TData>['editing']['drafts']
    pending: GridState<TData>['editing']['pending']
    window: GridWindow
    rows: readonly GridVisibleRow<TData>[]
    nodes: readonly GridVisibleNode<TData>[]
  } | null = null
  let destroyed = false
  let requestSequence = 0
  let mutationSequence = 0
  let viewportLoadTimeout: ReturnType<typeof setTimeout> | null = null
  let liveUnsubscribe: (() => void) | null = null

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (
    updater: (current: GridState<TData>) => GridState<TData>,
  ) => {
    state = updater(state)
    notify()
  }

  const clearProjectionCache = () => {
    projectionCache = null
    visibleSliceCache = null
  }

  const retainProjectionCaches = (nextNodeStore: GridNodeStore<TData>) => {
    if (
      projectionCache !== null &&
      projectionCache.nodeStore === state.data.nodeStore
    ) {
      projectionCache = {
        ...projectionCache,
        nodeStore: nextNodeStore,
      }
    }

    if (
      visibleSliceCache !== null &&
      visibleSliceCache.nodeStore === state.data.nodeStore
    ) {
      visibleSliceCache = {
        ...visibleSliceCache,
        nodeStore: nextNodeStore,
      }
    }
  }

  const expandedNodeSet = () => new Set(state.hierarchy.expandedNodeIds)

  const pruneExpandedNodeIds = (nodeStore: GridNodeStore<TData>) =>
    state.hierarchy.expandedNodeIds.filter((nodeId) => {
      const node = nodeStore.nodesById.get(nodeId)
      return (
        node !== undefined &&
        nodeStore.locationByNodeId.has(nodeId) &&
        (node.isExpandable || nodeStore.containers.has(getContainerKey(nodeId)))
      )
    })

  const getProjection = () => {
    const expandedKey = JSON.stringify(state.hierarchy.expandedNodeIds)
    if (
      projectionCache !== null &&
      projectionCache.nodeStore === state.data.nodeStore &&
      projectionCache.expandedKey === expandedKey
    ) {
      return projectionCache
    }

    const projection = getVisibleProjection(
      state.data.nodeStore,
      expandedNodeSet(),
    )
    projectionCache = {
      nodeStore: state.data.nodeStore,
      expandedKey,
      rows: projection.rows,
      nodes: projection.nodes,
      totalVisibleCount: projection.totalVisibleCount,
    }
    return projectionCache
  }

  const updateProjectionState = (
    nodeStore: GridNodeStore<TData>,
    rowCount: number | null,
    hasNextPage: boolean | null,
    cacheState: GridState<TData>['data']['cacheState'],
    pageInfo: GridState<TData>['data']['pageInfo'],
  ) => {
    const projection = getVisibleProjection(nodeStore, expandedNodeSet())
    clearProjectionCache()
    projectionCache = {
      nodeStore,
      expandedKey: JSON.stringify(state.hierarchy.expandedNodeIds),
      rows: projection.rows,
      nodes: projection.nodes,
      totalVisibleCount: projection.totalVisibleCount,
    }

    return {
      nodeStore,
      rowStore: toLegacyRowStore(projection.rows),
      visibleRowCount: projection.totalVisibleCount,
      hasData: projection.totalVisibleCount > 0,
      rowCount,
      hasNextPage,
      cacheState,
      pageInfo,
    }
  }

  const getVisibleWindow = (): GridWindow => {
    const projection = getProjection()
    const total = projection.totalVisibleCount
    const base = state.virtualization.enabled
      ? state.virtualization.viewport
      : getPageWindow(state.query)
    return clampWindow(base, total === 0 ? null : total)
  }

  const getVisibleRowsSlice = (): readonly GridVisibleRow<TData>[] => {
    const visibleWindow = getVisibleWindow()
    if (
      visibleSliceCache !== null &&
      visibleSliceCache.nodeStore === state.data.nodeStore &&
      visibleSliceCache.drafts === state.editing.drafts &&
      visibleSliceCache.pending === state.editing.pending &&
      visibleSliceCache.window.start === visibleWindow.start &&
      visibleSliceCache.window.end === visibleWindow.end
    ) {
      return visibleSliceCache.rows
    }

    const projection = getProjection()
    const rows = projection.rows
      .slice(visibleWindow.start, visibleWindow.end)
      .map((row) => {
        if (!row.isLoaded || row.rowId === null || row.row === null) {
          return row
        }

        const draftKey = getDraftKey(row.rowId)
        const pendingRow = state.editing.pending[draftKey]?.row
        const draft = state.editing.drafts[draftKey]

        return {
          ...row,
          row: pendingRow ?? (draft ? resolveDraftRow(draft) : row.row),
        }
      })
    const nodes = rows.map((row) => ({
      visibleIndex: row.index,
      node: row.node,
      row: row.row,
      canonicalRow: row.canonicalRow,
      rowId: row.rowId,
    }))
    visibleSliceCache = {
      nodeStore: state.data.nodeStore,
      drafts: state.editing.drafts,
      pending: state.editing.pending,
      window: visibleWindow,
      rows,
      nodes,
    }
    return rows
  }

  const getVisibleNodesSlice = (): readonly GridVisibleNode<TData>[] => {
    getVisibleRowsSlice()
    return visibleSliceCache?.nodes ?? []
  }

  const clearViewportLoadTimeout = () => {
    if (viewportLoadTimeout === null) {
      return
    }

    clearTimeout(viewportLoadTimeout)
    viewportLoadTimeout = null
  }

  const clearRetry = (target: GridLoadTarget) => {
    const key = targetKey(target)
    const retryRequest = retryRequests.get(key)
    if (!retryRequest) {
      return
    }

    clearTimeout(retryRequest.timeoutId)
    retryRequests.delete(key)
  }

  const finishRequest = (key: string, requestId: number) => {
    if (!activeRequests.has(key)) {
      return
    }

    if (activeRequests.get(key)?.requestId !== requestId) {
      return
    }

    activeRequests.delete(key)
    setState((current) => {
      const inFlightCount = Math.max(0, current.request.inFlightCount - 1)
      return {
        ...current,
        request: {
          ...current.request,
          inFlightCount,
          status:
            current.request.status === 'error'
              ? 'error'
              : current.data.hasData || inFlightCount === 0
                ? 'ready'
                : 'loading',
          isInitialLoading:
            inFlightCount === 0 ? false : current.request.isInitialLoading,
          isReloading:
            inFlightCount === 0 ? false : current.request.isReloading,
        },
      }
    })
  }

  const abortAllRequests = () => {
    for (const request of activeRequests.values()) {
      request.controller.abort()
    }
    activeRequests.clear()

    for (const retryRequest of retryRequests.values()) {
      clearTimeout(retryRequest.timeoutId)
    }
    retryRequests.clear()

    setState((current) => ({
      ...current,
      request: {
        ...current.request,
        inFlightCount: 0,
        isInitialLoading: false,
        isReloading: false,
        status: current.data.hasData ? 'ready' : 'idle',
      },
    }))
  }

  const getPendingWindows = (ownerNodeId: GridNodeId | null): GridWindow[] =>
    [
      ...Array.from(activeRequests.values()).map((request) => request.target),
      ...Array.from(retryRequests.values()).map((request) => request.target),
    ]
      .filter((target) =>
        target.kind === 'root-window'
          ? ownerNodeId === null
          : ownerNodeId === target.parentNodeId,
      )
      .map((target) => target.window)

  const resolveDraftRow = (draft: GridRowDraft<TData>): TData => {
    if (!editingOptions) {
      return draft.remoteRow
    }

    let resolved = draft.remoteRow
    for (const cell of Object.values(draft.cells)) {
      resolved = editingOptions.applyCellValue(
        resolved,
        cell.columnId,
        cell.value,
      )
    }

    return resolved
  }

  const getDraftCellValue = (row: TData, columnId: string): unknown =>
    editingOptions?.getCellValue?.(row, columnId) ??
    (row as Record<string, unknown>)[columnId]

  const draftMatchesRow = (draft: GridRowDraft<TData>, row: TData): boolean =>
    Object.values(draft.cells).every((cell) =>
      Object.is(getDraftCellValue(row, cell.columnId), cell.value),
    )

  const getRecordNode = (rowId: GridRowId) =>
    getNodeByRowId(state.data.nodeStore, rowId)

  const syncDraftsFromStore = (nodeStore: GridNodeStore<TData>) => {
    if (Object.keys(state.editing.drafts).length === 0) {
      return state.editing
    }

    let changed = false
    const nextDrafts: Record<string, GridRowDraft<TData>> = {
      ...state.editing.drafts,
    }

    for (const [draftKey, draft] of Object.entries(state.editing.drafts)) {
      const node = getNodeByRowId(nodeStore, draft.rowId)
      if (!node || (node.kind !== 'leaf' && node.kind !== 'tree')) {
        continue
      }

      if (node.row === draft.remoteRow) {
        continue
      }

      nextDrafts[draftKey] = {
        ...draft,
        remoteRow: node.row,
      }
      changed = true
    }

    return changed ? { ...state.editing, drafts: nextDrafts } : state.editing
  }

  const getCellDraft = (
    rowId: GridRowId,
    columnId: string,
  ): GridCellDraft | null =>
    state.editing.drafts[getDraftKey(rowId)]?.cells[columnId] ?? null

  const setSelectionState = (selection: GridSelectionState) => {
    setState((current) => ({
      ...current,
      selection: normalizeSelectionState(selection),
    }))
  }

  const setColumnsState = (columns: GridColumnsState) => {
    setState((current) => ({
      ...current,
      columns: normalizeColumnsState(columns),
    }))
  }

  const resubscribeLive = () => {
    liveUnsubscribe?.()
    liveUnsubscribe = null

    const hierarchicalSource =
      dataSource as GridHierarchicalLiveDataSource<TData>
    const liveSource = dataSource as GridLiveDataSource<TData>
    const subscribe =
      isHierarchicalMode(state.query) && hierarchicalSource.subscribeNodes
        ? (sink: (patch: GridPatch<TData>) => void) =>
            hierarchicalSource.subscribeNodes!(
              state.query,
              expandedNodeSet(),
              sink,
            )
        : liveSource.subscribe
          ? (sink: (patch: GridPatch<TData>) => void) =>
              liveSource.subscribe!(state.query, sink)
          : null

    if (!subscribe) {
      setState((current) => ({
        ...current,
        live: {
          ...current.live,
          status: 'idle',
          error: null,
          subscriptionKey: null,
        },
      }))
      return
    }

    setState((current) => ({
      ...current,
      live: {
        ...current.live,
        status: 'subscribing',
        error: null,
        subscriptionKey: current.data.viewKey,
      },
    }))

    try {
      const subscriptionKey = state.data.viewKey
      liveUnsubscribe = subscribe((patch) => {
        if (
          destroyed ||
          state.live.subscriptionKey !== subscriptionKey ||
          state.data.viewKey !== subscriptionKey
        ) {
          return
        }

        controller.applyPatch(patch)
      })

      setState((current) => ({
        ...current,
        live: {
          ...current.live,
          status: 'ready',
          error: null,
          subscriptionKey: current.data.viewKey,
        },
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        live: {
          ...current.live,
          status: 'error',
          error,
        },
      }))
    }
  }

  const loadTarget = async (
    target: GridLoadTarget,
    reason: GridLoadReason,
    requestId: number,
    signal: AbortSignal,
  ): Promise<GridNodeLoadResult<TData>> => {
    if (!isHierarchicalMode(state.query)) {
      const result = await dataSource.load(
        {
          ...state.query,
          slice: {
            kind: 'offset',
            offset: target.window.start,
            limit: Math.max(1, target.window.end - target.window.start),
          },
        },
        {
          requestId,
          reason,
          signal,
        },
      )

      return {
        target,
        nodes: result.rows.map((row) =>
          makeNodeFromRow(row, getRowId, getRowRevision),
        ),
        totalChildren:
          result.pageInfo.kind === 'offset'
            ? (result.pageInfo.totalRowCount ?? null)
            : null,
        totalRowCount:
          result.pageInfo.kind === 'offset'
            ? (result.pageInfo.totalRowCount ?? null)
            : null,
        hasNextPage: result.pageInfo.hasNextPage,
        cacheState: result.cacheState,
      }
    }

    const hierarchicalSource = dataSource as GridHierarchicalDataSource<TData>
    const request: GridExecutionRequest = {
      query: state.query,
      expansion: expandedNodeSet(),
      target,
    }
    return hierarchicalSource.loadNodes(request, {
      requestId,
      reason,
      signal,
    })
  }

  const startTargetLoad = (
    target: GridLoadTarget,
    reason: GridLoadReason,
    attempt = 0,
  ) => {
    clearRetry(target)
    requestSequence += 1
    const requestId = requestSequence
    const controller = new AbortController()
    const key = targetKey(target)

    activeRequests.set(key, {
      requestId,
      reason,
      viewKey: state.data.viewKey,
      target,
      controller,
    })

    setState((current) => {
      const hasData = current.data.hasData
      return {
        ...current,
        request: {
          ...current.request,
          error: null,
          status: hasData ? 'ready' : 'loading',
          inFlightCount: current.request.inFlightCount + 1,
          lastRequestId: requestId,
          isInitialLoading: !hasData,
          isReloading: hasData,
        },
      }
    })

    void loadTarget(target, reason, requestId, controller.signal)
      .then((result) => {
        const activeRequest = activeRequests.get(key)
        if (!activeRequest || activeRequest.viewKey !== state.data.viewKey) {
          return
        }

        const nextNodeStore = upsertNodeStoreWindow(
          state.data.nodeStore,
          result.target,
          result.nodes,
          {
            totalChildren: result.totalChildren,
            hasNextPage: result.hasNextPage,
          },
        )
        const nextEditing = syncDraftsFromStore(nextNodeStore)
        const nextData = updateProjectionState(
          nextNodeStore,
          result.totalRowCount ?? state.data.rowCount,
          result.hasNextPage ?? state.data.hasNextPage,
          result.cacheState ?? 'miss',
          state.data.pageInfo,
        )
        const nextExpandedNodeIds = pruneExpandedNodeIds(nextNodeStore)
        const didPruneExpandedNodes =
          nextExpandedNodeIds.length !== state.hierarchy.expandedNodeIds.length

        setState((current) => ({
          ...current,
          hierarchy: didPruneExpandedNodes
            ? {
                ...current.hierarchy,
                expandedNodeIds: nextExpandedNodeIds,
              }
            : current.hierarchy,
          data: {
            ...current.data,
            ...nextData,
          },
          editing: nextEditing,
          request: {
            ...current.request,
            status: 'ready',
            error: null,
          },
          live: {
            ...current.live,
            hasPendingInvalidation: Array.from(
              nextNodeStore.containers.values(),
            ).some((container) => container.staleWindows.length > 0),
          },
        }))
        if (didPruneExpandedNodes) {
          resubscribeLive()
        }

        if (result.cacheState === 'stale' && reason !== 'refresh') {
          setTimeout(() => {
            if (!destroyed) {
              scheduleVisibleLoads('refresh', true)
            }
          }, 0)
        } else if (reason === 'expand') {
          setTimeout(() => {
            if (!destroyed) {
              scheduleVisibleLoads('viewport-change')
            }
          }, 0)
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        const activeRequest = activeRequests.get(key)
        if (!activeRequest || activeRequest.viewKey !== state.data.viewKey) {
          return
        }

        if (attempt < retryOptions.maxRetries) {
          const delay = Math.min(
            retryOptions.maxDelayMs,
            retryOptions.baseDelayMs *
              retryOptions.backoffMultiplier ** attempt,
          )
          retryRequests.set(key, {
            viewKey: activeRequest.viewKey,
            reason,
            target,
            timeoutId: setTimeout(() => {
              retryRequests.delete(key)
              startTargetLoad(target, reason, attempt + 1)
            }, delay),
          })
        } else {
          setState((current) => ({
            ...current,
            request: {
              ...current.request,
              status: 'error',
              error,
            },
          }))
        }
      })
      .finally(() => {
        finishRequest(key, requestId)
      })
  }

  const requestVisiblePlaceholders = (reason: GridLoadReason) => {
    const requestedWindow =
      state.virtualization.requestedRange ?? getVisibleWindow()
    const visibleRows = getProjection().rows.slice(
      requestedWindow.start,
      requestedWindow.end,
    )
    const indexesByOwner = new Map<string, number[]>()

    for (const row of visibleRows) {
      if (row.node.kind !== 'placeholder' || row.node.childIndex === null) {
        continue
      }

      const ownerKey = getContainerKey(row.node.ownerNodeId)
      const bucket = indexesByOwner.get(ownerKey) ?? []
      bucket.push(row.node.childIndex)
      indexesByOwner.set(ownerKey, bucket)
    }

    for (const [ownerKey, indexes] of indexesByOwner) {
      const ownerNodeId = ownerKey === getContainerKey(null) ? null : ownerKey
      for (const window of groupIndexes(indexes)) {
        startTargetLoad(
          ownerNodeId === null
            ? { kind: 'root-window', window }
            : { kind: 'children-window', parentNodeId: ownerNodeId, window },
          reason,
        )
      }
    }
  }

  const requestTargetWindows = (
    ownerNodeId: GridNodeId | null,
    windows: readonly GridWindow[],
    reason: GridLoadReason,
    force = false,
  ) => {
    const container = getContainerState(state.data.nodeStore, ownerNodeId)
    const pending = getPendingWindows(ownerNodeId)
    const loadWindows = force
      ? windows
      : windows.flatMap((window) =>
          getMissingWindows(
            window,
            container.loadedWindows,
            pending,
            container.staleWindows,
          ),
        )

    for (const window of mergeWindows(loadWindows)) {
      startTargetLoad(
        ownerNodeId === null
          ? { kind: 'root-window', window }
          : { kind: 'children-window', parentNodeId: ownerNodeId, window },
        reason,
      )
    }
  }

  const scheduleVisibleLoads = (reason: GridLoadReason, force = false) => {
    if (destroyed) {
      return
    }

    const requestedWindow = state.virtualization.enabled
      ? {
          start: Math.max(
            0,
            state.virtualization.viewport.start - state.virtualization.overscan,
          ),
          end:
            state.virtualization.viewport.end + state.virtualization.overscan,
        }
      : getPageWindow(state.query)

    setState((current) => ({
      ...current,
      virtualization: {
        ...current.virtualization,
        requestedRange: requestedWindow,
      },
    }))

    const rootContainer = getContainerState(state.data.nodeStore, null)
    const rootWindows = force
      ? [requestedWindow]
      : rootContainer.childCount === null &&
          rootContainer.loadedWindows.length === 0
        ? [requestedWindow]
        : []

    requestTargetWindows(null, rootWindows, reason, force)

    for (const nodeId of state.hierarchy.expandedNodeIds) {
      const childContainer = getContainerState(state.data.nodeStore, nodeId)
      if (
        childContainer.childCount === null &&
        childContainer.loadedWindows.length === 0
      ) {
        requestTargetWindows(
          nodeId,
          [
            {
              start: 0,
              end: Math.max(1, state.query.slice.limit),
            },
          ],
          'expand',
          force,
        )
      }
    }

    requestVisiblePlaceholders(reason)
  }

  const setQuery = (
    query: GridQuery,
    reason: Exclude<GridLoadReason, 'initial'> = 'query-change',
  ) => {
    const normalizedQuery = normalizeQuery(query)
    assertSupportedQuery(normalizedQuery)
    const previousViewKey = state.data.viewKey
    const nextViewKey = getViewKey(normalizedQuery)
    const nextMatchKey = getMatchKey(normalizedQuery)
    const preserveRows = previousViewKey === nextViewKey

    clearViewportLoadTimeout()
    if (!preserveRows) {
      abortAllRequests()
    }

    setState((current) => {
      const nextNodeStore = preserveRows
        ? current.data.nodeStore
        : clearNodeStore<TData>()
      const nextData = updateProjectionState(
        nextNodeStore,
        preserveRows ? current.data.rowCount : null,
        preserveRows ? current.data.hasNextPage : null,
        preserveRows ? current.data.cacheState : 'miss',
        preserveRows ? current.data.pageInfo : null,
      )

      return {
        ...current,
        query: normalizedQuery,
        hierarchy: preserveRows ? current.hierarchy : { expandedNodeIds: [] },
        data: {
          ...current.data,
          viewKey: nextViewKey,
          matchKey: nextMatchKey,
          ...nextData,
        },
        request: {
          ...current.request,
          error: null,
          status: nextData.hasData ? 'ready' : 'idle',
        },
        live: {
          ...current.live,
          hasPendingInvalidation: false,
        },
        editing: preserveRows
          ? current.editing
          : createInitialEditingState(current.editing.saveMode),
      }
    })

    clearProjectionCache()

    if (
      !preserveRows &&
      normalizedQuery.slice.kind === 'offset' &&
      state.virtualization.enabled
    ) {
      const nextSlice = normalizedQuery.slice
      setState((current) => ({
        ...current,
        virtualization: {
          ...current.virtualization,
          viewport: {
            start: nextSlice.offset,
            end: nextSlice.offset + nextSlice.limit,
          },
          requestedRange: null,
        },
      }))
    }

    resubscribeLive()
    scheduleVisibleLoads(reason)
  }

  const markContainerStaleAndRefresh = (
    ownerNodeId: GridNodeId | null,
    window: GridWindow,
  ) => {
    const nextNodeStore = markContainerWindowStale(
      state.data.nodeStore,
      ownerNodeId,
      [window],
    )
    retainProjectionCaches(nextNodeStore)

    setState((current) => ({
      ...current,
      data: {
        ...current.data,
        nodeStore: nextNodeStore,
      },
      live: {
        ...current.live,
        hasPendingInvalidation: true,
      },
    }))

    requestTargetWindows(ownerNodeId, [window], 'refresh', true)
  }

  const createRefreshWindow = (index: number): GridWindow => ({
    start: Math.max(0, index),
    end: Math.max(Math.max(0, index) + 1, state.query.slice.limit),
  })

  const refreshHierarchyPath = (
    ownerNodeId: GridNodeId | null,
    indexHint?: number,
  ) => {
    const refreshTargets = new Map<
      string,
      {
        ownerNodeId: GridNodeId | null
        window: GridWindow
      }
    >()

    const pushTarget = (
      nextOwnerNodeId: GridNodeId | null,
      nextIndex: number | undefined,
    ) => {
      if (nextIndex === undefined) {
        return
      }

      const window = createRefreshWindow(nextIndex)
      refreshTargets.set(
        `${getContainerKey(nextOwnerNodeId)}:${window.start}:${window.end}`,
        {
          ownerNodeId: nextOwnerNodeId,
          window,
        },
      )
    }

    pushTarget(ownerNodeId, indexHint)

    let currentNodeId = ownerNodeId
    while (currentNodeId !== null) {
      const location = state.data.nodeStore.locationByNodeId.get(currentNodeId)
      if (!location) {
        break
      }

      pushTarget(location.ownerNodeId, location.index)
      currentNodeId =
        state.data.nodeStore.nodesById.get(currentNodeId)?.parentNodeId ?? null
    }

    for (const target of refreshTargets.values()) {
      markContainerStaleAndRefresh(target.ownerNodeId, target.window)
    }
  }

  const applyPatch = (patch: GridPatch<TData>) => {
    const markPatchObserved = () => {
      setState((current) => ({
        ...current,
        live: {
          ...current.live,
          lastPatchAt: Date.now(),
          status:
            current.live.status === 'idle' ? 'ready' : current.live.status,
          error: null,
        },
      }))
    }

    markPatchObserved()

    if (patch.type === 'invalidate') {
      const rootContainer = getContainerState(state.data.nodeStore, null)
      if (rootContainer.loadedWindows.length === 0) {
        scheduleVisibleLoads('refresh', true)
        return
      }

      markContainerStaleAndRefresh(
        null,
        mergeWindows(rootContainer.loadedWindows)[0] ??
          getPageWindow(state.query),
      )
      return
    }

    if (patch.type === 'children-invalidate') {
      const container = getContainerState(
        state.data.nodeStore,
        patch.parentNodeId,
      )
      const staleWindows =
        container.loadedWindows.length > 0
          ? container.loadedWindows
          : [
              {
                start: 0,
                end: Math.max(1, state.query.slice.limit),
              },
            ]
      markContainerStaleAndRefresh(
        patch.parentNodeId,
        mergeWindows(staleWindows)[0]!,
      )
      return
    }

    const rowId =
      patch.type === 'row-upsert' ? getRowId(patch.row) : patch.rowId
    const node = getRecordNode(rowId)

    if (patch.type === 'row-upsert') {
      const draftKey = getDraftKey(rowId)
      const pending = state.editing.pending[draftKey]
      const draft = state.editing.drafts[draftKey]
      const currentMutationId =
        draft?.clientMutationId ?? pending?.clientMutationId
      const isAcknowledgedMutation =
        patch.acknowledgedMutationId !== undefined &&
        currentMutationId === patch.acknowledgedMutationId

      if (draft && !isAcknowledgedMutation) {
        const overlapsDraft =
          patch.changedFields?.some(
            (field) => draft.cells[field] !== undefined,
          ) ?? true

        setState((current) => {
          const currentDraft = current.editing.drafts[draftKey]
          if (!currentDraft) {
            return current
          }

          return {
            ...current,
            editing: {
              ...current.editing,
              drafts: {
                ...current.editing.drafts,
                [draftKey]: {
                  ...currentDraft,
                  remoteRow: patch.row,
                  phase: overlapsDraft ? 'conflict' : currentDraft.phase,
                },
              },
            },
          }
        })
      }

      if (!node || (node.kind !== 'leaf' && node.kind !== 'tree')) {
        const ownerNodeId = patch.parentNodeId ?? null
        const index = patch.position?.index ?? 0
        if (isHierarchicalMode(state.query)) {
          refreshHierarchyPath(ownerNodeId, index)
        } else {
          markContainerStaleAndRefresh(ownerNodeId, createRefreshWindow(index))
        }
        return
      }

      if (
        isHierarchicalMode(state.query) ||
        patchTouchesQueryShape(state.query, patch.changedFields)
      ) {
        const location = state.data.nodeStore.locationByNodeId.get(node.nodeId)
        const ownerNodeId = patch.parentNodeId ?? location?.ownerNodeId ?? null
        const index = location?.index ?? patch.position?.index ?? 0
        if (isHierarchicalMode(state.query)) {
          refreshHierarchyPath(ownerNodeId, index)
        } else {
          markContainerStaleAndRefresh(ownerNodeId, createRefreshWindow(index))
        }
        return
      }

      const nextNodeStore = updateStoredNode(
        state.data.nodeStore,
        node.nodeId,
        {
          ...node,
          row: patch.row,
          revision: patch.revision ?? getRowRevision?.(patch.row),
        },
      )
      const nextData = updateProjectionState(
        nextNodeStore,
        state.data.rowCount,
        state.data.hasNextPage,
        state.data.cacheState,
        state.data.pageInfo,
      )
      const nextDrafts = { ...state.editing.drafts }
      const nextPending = { ...state.editing.pending }
      if (isAcknowledgedMutation) {
        delete nextDrafts[draftKey]
        delete nextPending[draftKey]
      }

      setState((current) => ({
        ...current,
        data: {
          ...current.data,
          ...nextData,
        },
        editing: {
          ...current.editing,
          drafts: nextDrafts,
          pending: nextPending,
          activeCell:
            isAcknowledgedMutation &&
            current.editing.activeCell?.rowId === rowId
              ? null
              : current.editing.activeCell,
        },
      }))
      return
    }

    if (!node) {
      return
    }

    const location = state.data.nodeStore.locationByNodeId.get(node.nodeId)
    const nextNodeStore = removeStoredNode(state.data.nodeStore, node.nodeId)
    const nextData = updateProjectionState(
      nextNodeStore,
      state.data.rowCount === null
        ? null
        : Math.max(0, state.data.rowCount - 1),
      state.data.hasNextPage,
      state.data.cacheState,
      state.data.pageInfo,
    )
    const nextExpandedNodeIds = pruneExpandedNodeIds(nextNodeStore)
    const didPruneExpandedNodes =
      nextExpandedNodeIds.length !== state.hierarchy.expandedNodeIds.length
    const draftKey = getDraftKey(rowId)
    const nextDrafts = { ...state.editing.drafts }
    const nextPending = { ...state.editing.pending }
    delete nextDrafts[draftKey]
    delete nextPending[draftKey]

    setState((current) => ({
      ...current,
      hierarchy: didPruneExpandedNodes
        ? {
            ...current.hierarchy,
            expandedNodeIds: nextExpandedNodeIds,
          }
        : current.hierarchy,
      data: {
        ...current.data,
        ...nextData,
      },
      editing: {
        ...current.editing,
        activeCell:
          current.editing.activeCell?.rowId === rowId
            ? null
            : current.editing.activeCell,
        drafts: nextDrafts,
        pending: nextPending,
      },
    }))
    if (didPruneExpandedNodes) {
      resubscribeLive()
    }

    const ownerNodeId = patch.parentNodeId ?? location?.ownerNodeId ?? null
    const index = location?.index ?? patch.position?.index ?? 0
    if (isHierarchicalMode(state.query)) {
      refreshHierarchyPath(ownerNodeId, index)
    } else {
      markContainerStaleAndRefresh(ownerNodeId, createRefreshWindow(index))
    }
  }

  const isCellEditable = (row: TData, columnId: string): boolean => {
    if (
      !editingOptions ||
      !('save' in (dataSource as GridEditableDataSource<TData>))
    ) {
      return false
    }

    return editingOptions.isCellEditable?.(row, columnId) ?? true
  }

  const startCellEdit = (rowId: GridRowId, columnId: string) => {
    if (!editingOptions) {
      return
    }

    const node = getRecordNode(rowId)
    if (!node || (node.kind !== 'leaf' && node.kind !== 'tree')) {
      return
    }

    if (!isCellEditable(node.row, columnId)) {
      return
    }

    const draftKey = getDraftKey(rowId)
    const existingDraft = state.editing.drafts[draftKey]
    const baseValue =
      editingOptions.getCellValue?.(node.row, columnId) ??
      (node.row as Record<string, unknown>)[columnId]

    setState((current) => ({
      ...current,
      editing: {
        ...current.editing,
        activeCell: { rowId, columnId },
        drafts: {
          ...current.editing.drafts,
          [draftKey]: existingDraft ?? {
            rowId,
            baseRow: node.row,
            remoteRow: node.row,
            phase: 'editing',
            cells: {
              [columnId]: {
                columnId,
                value: baseValue,
                dirty: false,
                error: null,
              },
            },
          },
        },
      },
    }))
  }

  const updateCellDraft = (
    rowId: GridRowId,
    columnId: string,
    value: unknown,
  ) => {
    if (!editingOptions) {
      return
    }

    const draftKey = getDraftKey(rowId)
    const draft = state.editing.drafts[draftKey]
    const node = getRecordNode(rowId)
    if (!draft && (!node || (node.kind !== 'leaf' && node.kind !== 'tree'))) {
      return
    }

    const baseRow = draft?.baseRow ?? (node as { row: TData }).row
    const remoteRow = draft?.remoteRow ?? (node as { row: TData }).row

    setState((current) => ({
      ...current,
      editing: {
        ...current.editing,
        activeCell: { rowId, columnId },
        drafts: {
          ...current.editing.drafts,
          [draftKey]: {
            rowId,
            baseRow,
            remoteRow,
            phase: 'editing',
            clientMutationId: draft?.clientMutationId,
            cells: {
              ...draft?.cells,
              [columnId]: {
                columnId,
                value,
                dirty: true,
                error: null,
              },
            },
          },
        },
      },
    }))
  }

  const cancelCellEdit = (rowId: GridRowId, columnId: string) => {
    const draftKey = getDraftKey(rowId)
    const draft = state.editing.drafts[draftKey]
    if (!draft) {
      return
    }

    const nextCells = { ...draft.cells }
    delete nextCells[columnId]
    const nextDrafts = { ...state.editing.drafts }
    if (Object.keys(nextCells).length === 0) {
      delete nextDrafts[draftKey]
    } else {
      nextDrafts[draftKey] = {
        ...draft,
        phase: 'editing',
        cells: nextCells,
      }
    }

    setState((current) => ({
      ...current,
      editing: {
        ...current.editing,
        activeCell:
          current.editing.activeCell?.rowId === rowId &&
          current.editing.activeCell.columnId === columnId
            ? null
            : current.editing.activeCell,
        drafts: nextDrafts,
      },
    }))
  }

  const commitCellEdit = async (rowId: GridRowId, columnId: string) => {
    if (!editingOptions) {
      return
    }

    const editableSource = dataSource as GridEditableDataSource<TData>
    if (!editableSource.save) {
      return
    }

    const draftKey = getDraftKey(rowId)
    const draft = state.editing.drafts[draftKey]
    const cell = draft?.cells[columnId]
    const node = getRecordNode(rowId)
    if (!draft || !cell) {
      return
    }

    if (!node || (node.kind !== 'leaf' && node.kind !== 'tree')) {
      setState((current) => {
        const currentDraft = current.editing.drafts[draftKey]
        const currentCell = currentDraft?.cells[columnId]
        if (!currentDraft || !currentCell) {
          return current
        }

        return {
          ...current,
          editing: {
            ...current.editing,
            drafts: {
              ...current.editing.drafts,
              [draftKey]: {
                ...currentDraft,
                phase: 'error',
                cells: {
                  ...currentDraft.cells,
                  [columnId]: {
                    ...currentCell,
                    error: 'Row is no longer available.',
                  },
                },
              },
            },
          },
        }
      })
      return
    }

    if (draft.phase === 'saving' || state.editing.pending[draftKey]) {
      return
    }

    const validationError = editingOptions.validateCell?.(
      draft.remoteRow,
      columnId,
      cell.value,
    )
    if (validationError) {
      setState((current) => ({
        ...current,
        editing: {
          ...current.editing,
          drafts: {
            ...current.editing.drafts,
            [draftKey]: {
              ...draft,
              phase: 'error',
              cells: {
                ...draft.cells,
                [columnId]: {
                  ...cell,
                  error: validationError,
                },
              },
            },
          },
        },
      }))
      return
    }

    mutationSequence += 1
    const clientMutationId = `mutation-${mutationSequence}`
    const patch = Object.fromEntries(
      Object.values(draft.cells)
        .filter((entry) => entry.dirty)
        .map((entry) => [entry.columnId, entry.value]),
    )
    const resolvedDraftRow = resolveDraftRow(draft)
    const saveMode = state.editing.saveMode
    const baseRevision = state.data.nodeStore.revisionsByRowId.get(rowId)
    const abortController = new AbortController()
    activeSaves.add(abortController)

    setState((current) => ({
      ...current,
      editing: {
        ...current.editing,
        drafts: {
          ...current.editing.drafts,
          [draftKey]: {
            ...draft,
            phase: 'saving',
            clientMutationId,
          },
        },
        pending:
          saveMode === 'optimistic'
            ? {
                ...current.editing.pending,
                [draftKey]: {
                  rowId,
                  columnId,
                  row: resolvedDraftRow,
                  patch,
                  clientMutationId,
                  startedAt: Date.now(),
                },
              }
            : current.editing.pending,
      },
    }))

    try {
      const result = await editableSource.save(
        {
          rowId,
          columnId,
          patch,
          baseRow: draft.baseRow,
          draftRow: resolvedDraftRow,
          baseRevision,
          clientMutationId,
        },
        { signal: abortController.signal },
      )

      setState((current) => {
        const currentDraft = current.editing.drafts[draftKey]
        const nextPending = { ...current.editing.pending }
        delete nextPending[draftKey]

        const latestNode = getNodeByRowId(current.data.nodeStore, rowId)
        const nextNodeStore =
          latestNode &&
          (latestNode.kind === 'leaf' || latestNode.kind === 'tree')
            ? updateStoredNode(current.data.nodeStore, latestNode.nodeId, {
                ...latestNode,
                row: result.row,
                revision: result.revision ?? getRowRevision?.(result.row),
              })
            : current.data.nodeStore
        const nextData = updateProjectionState(
          nextNodeStore,
          current.data.rowCount,
          current.data.hasNextPage,
          current.data.cacheState,
          current.data.pageInfo,
        )

        const shouldKeepConflictDraft =
          currentDraft?.clientMutationId === clientMutationId &&
          currentDraft.phase === 'conflict' &&
          !draftMatchesRow(currentDraft, result.row)

        if (!shouldKeepConflictDraft) {
          const nextDrafts = { ...current.editing.drafts }
          delete nextDrafts[draftKey]

          return {
            ...current,
            data: {
              ...current.data,
              ...nextData,
            },
            editing: {
              ...current.editing,
              activeCell:
                current.editing.activeCell?.rowId === rowId &&
                current.editing.activeCell.columnId === columnId
                  ? null
                  : current.editing.activeCell,
              drafts: nextDrafts,
              pending: nextPending,
            },
          }
        }

        return {
          ...current,
          data: {
            ...current.data,
            ...nextData,
          },
          editing: {
            ...current.editing,
            drafts: {
              ...current.editing.drafts,
              [draftKey]: {
                ...currentDraft,
                remoteRow: result.row,
              },
            },
            pending: nextPending,
          },
        }
      })
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }

      setState((current) => {
        const latestDraft = current.editing.drafts[draftKey]
        if (!latestDraft || latestDraft.clientMutationId !== clientMutationId) {
          return current
        }

        const nextPending = { ...current.editing.pending }
        delete nextPending[draftKey]

        return {
          ...current,
          editing: {
            ...current.editing,
            pending: nextPending,
            drafts: {
              ...current.editing.drafts,
              [draftKey]: {
                ...latestDraft,
                phase: 'error',
                cells: {
                  ...latestDraft.cells,
                  [columnId]: {
                    ...latestDraft.cells[columnId],
                    error: String(error),
                  },
                },
              },
            },
          },
        }
      })
    } finally {
      activeSaves.delete(abortController)
    }
  }

  const controller: GridController<TData> = {
    getState: () => state,
    getVisibleRows: () => getVisibleRowsSlice(),
    getVisibleNodes: () => getVisibleNodesSlice(),
    getNode(nodeId) {
      const node = getNodeById(state.data.nodeStore, nodeId)
      if (!node) {
        return null
      }

      const projection = getProjection()
      const visible = projection.rows.find((row) => row.nodeId === nodeId)
      return visible?.node ?? node
    },
    isNodeExpanded(nodeId) {
      return expandedNodeSet().has(nodeId)
    },
    getRowDraft(rowId) {
      return state.editing.drafts[getDraftKey(rowId)] ?? null
    },
    getCellDraft,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setQuery,
    patchQuery(updater, reason = 'query-change') {
      const nextQuery = updater(state.query)
      setQuery(nextQuery, reason)
    },
    setSelection(selection) {
      setSelectionState(selection)
    },
    patchSelection(updater) {
      setSelectionState(updater(state.selection))
    },
    toggleRowSelection(rowId) {
      if (isRowSelected(state.selection, rowId, state.data.matchKey)) {
        this.deselectRows([rowId])
        return
      }

      this.selectRows([rowId])
    },
    selectRows(rowIds) {
      if (rowIds.length === 0) {
        return
      }

      const nextIds = new Set(state.selection.includedIds)
      const nextExcluded = new Set(state.selection.excludedIds)

      for (const rowId of rowIds) {
        nextIds.add(rowId)
        nextExcluded.delete(rowId)
      }

      setSelectionState({
        ...state.selection,
        includedIds: [...nextIds],
        excludedIds: [...nextExcluded],
      })
    },
    deselectRows(rowIds) {
      if (rowIds.length === 0) {
        return
      }

      const nextIds = new Set(state.selection.includedIds)
      const nextExcluded = new Set(state.selection.excludedIds)

      for (const rowId of rowIds) {
        nextIds.delete(rowId)
        if (state.selection.mode === 'all-matching') {
          nextExcluded.add(rowId)
        }
      }

      setSelectionState({
        ...state.selection,
        includedIds: [...nextIds],
        excludedIds:
          state.selection.mode === 'all-matching' ? [...nextExcluded] : [],
      })
    },
    selectVisibleRows() {
      this.selectRows(
        getVisibleRowsSlice()
          .map((row) => row.rowId)
          .filter((rowId): rowId is GridRowId => rowId !== null),
      )
    },
    selectCurrentPage() {
      if (state.virtualization.enabled) {
        return
      }

      this.selectVisibleRows()
    },
    selectAllMatching() {
      setSelectionState(
        createAllMatchingSelection(
          {
            filters: state.query.filters,
            globalFilter: state.query.globalFilter ?? null,
          },
          state.data.matchKey,
          state.data.rowCount,
          [],
        ),
      )
    },
    clearSelection() {
      setSelectionState(createEmptySelectionState())
    },
    isRowSelected(rowId) {
      return isRowSelected(state.selection, rowId, state.data.matchKey)
    },
    getSelectionRequest() {
      return createSelectionRequest(state.selection)
    },
    getSelectionSummary() {
      const visibleRowIds = getVisibleRowsSlice()
        .map((row) => row.rowId)
        .filter((rowId): rowId is GridRowId => rowId !== null)
      const selectedVisibleCount = visibleRowIds.filter((rowId) =>
        isRowSelected(state.selection, rowId, state.data.matchKey),
      ).length
      const scopeStatus = getSelectionScopeStatus(
        state.selection,
        state.data.matchKey,
      )
      const baseCount =
        state.selection.mode === 'all-matching'
          ? scopeStatus === 'current'
            ? state.data.rowCount
            : (state.selection.scope?.capturedRowCount ?? null)
          : null

      return {
        mode: state.selection.mode,
        selectedCount:
          state.selection.mode === 'include'
            ? state.selection.includedIds.length
            : baseCount === null
              ? null
              : Math.max(
                  0,
                  baseCount +
                    state.selection.includedIds.length -
                    state.selection.excludedIds.length,
                ),
        scopeStatus,
        isAllVisibleSelected:
          visibleRowIds.length > 0 &&
          selectedVisibleCount === visibleRowIds.length,
        isSomeVisibleSelected:
          selectedVisibleCount > 0 &&
          selectedVisibleCount < visibleRowIds.length,
      }
    },
    setColumnsState(columns) {
      setColumnsState(columns)
    },
    patchColumnsState(updater) {
      setColumnsState(updater(state.columns))
    },
    toggleNode(nodeId) {
      if (this.isNodeExpanded(nodeId)) {
        this.collapseNode(nodeId)
        return
      }

      this.expandNode(nodeId)
    },
    expandNode(nodeId) {
      const node = getNodeById(state.data.nodeStore, nodeId)
      if (!node || !node.isExpandable) {
        return
      }

      if (this.isNodeExpanded(nodeId)) {
        return
      }

      setState((current) => ({
        ...current,
        hierarchy: {
          expandedNodeIds: [...current.hierarchy.expandedNodeIds, nodeId],
        },
      }))
      clearProjectionCache()
      const nextData = updateProjectionState(
        state.data.nodeStore,
        state.data.rowCount,
        state.data.hasNextPage,
        state.data.cacheState,
        state.data.pageInfo,
      )
      setState((current) => ({
        ...current,
        data: {
          ...current.data,
          ...nextData,
        },
      }))
      resubscribeLive()
      scheduleVisibleLoads('expand')
    },
    collapseNode(nodeId) {
      if (!this.isNodeExpanded(nodeId)) {
        return
      }

      setState((current) => ({
        ...current,
        hierarchy: {
          expandedNodeIds: current.hierarchy.expandedNodeIds.filter(
            (entry) => entry !== nodeId,
          ),
        },
      }))
      clearProjectionCache()
      const nextData = updateProjectionState(
        state.data.nodeStore,
        state.data.rowCount,
        state.data.hasNextPage,
        state.data.cacheState,
        state.data.pageInfo,
      )
      setState((current) => ({
        ...current,
        data: {
          ...current.data,
          ...nextData,
        },
      }))
      resubscribeLive()
    },
    setViewport(window) {
      if (!state.virtualization.enabled) {
        return
      }

      const viewport = normalizeQuery({
        ...state.query,
        slice: {
          kind: 'offset',
          offset: window.start,
          limit: Math.max(1, window.end - window.start),
        },
      }).slice

      if (viewport.kind !== 'offset') {
        return
      }

      const nextViewport = {
        start: viewport.offset,
        end: viewport.offset + viewport.limit,
      }

      if (
        state.virtualization.viewport.start === nextViewport.start &&
        state.virtualization.viewport.end === nextViewport.end
      ) {
        return
      }

      setState((current) => ({
        ...current,
        virtualization: {
          ...current.virtualization,
          viewport: nextViewport,
          requestedRange: current.virtualization.requestedRange,
        },
      }))

      clearViewportLoadTimeout()
      if (state.virtualization.viewportDebounceMs === 0) {
        scheduleVisibleLoads('viewport-change')
        return
      }

      viewportLoadTimeout = setTimeout(() => {
        viewportLoadTimeout = null
        scheduleVisibleLoads('viewport-change')
      }, state.virtualization.viewportDebounceMs)
    },
    refresh() {
      clearViewportLoadTimeout()
      scheduleVisibleLoads('refresh', true)
    },
    applyPatch,
    startCellEdit,
    updateCellDraft,
    commitCellEdit,
    cancelCellEdit,
    updateDataSource(nextDataSource: GridDataSource<TData>) {
      if (nextDataSource === dataSource) {
        return
      }

      dataSource = nextDataSource
      resubscribeLive()
      scheduleVisibleLoads('refresh', true)
    },
    updateGetRowId(nextGetRowId: (row: TData) => GridRowId) {
      getRowId = nextGetRowId
    },
    updateGetRowRevision(
      nextGetRowRevision: (row: TData) => GridRowRevision | undefined,
    ) {
      getRowRevision = nextGetRowRevision
    },
    destroy() {
      destroyed = true
      clearViewportLoadTimeout()
      liveUnsubscribe?.()
      for (const saveController of activeSaves) {
        saveController.abort()
      }
      activeSaves.clear()
      for (const request of activeRequests.values()) {
        request.controller.abort()
      }
      activeRequests.clear()
      for (const retryRequest of retryRequests.values()) {
        clearTimeout(retryRequest.timeoutId)
      }
      retryRequests.clear()
      listeners.clear()
    },
  }

  scheduleVisibleLoads('initial')
  resubscribeLive()

  return controller
}
