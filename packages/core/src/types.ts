export type GridRowId = string | number

export type GridNodeId = string

export type GridRowRevision = string | number

export type GridSortDirection = 'asc' | 'desc'

export type GridSort = {
  columnId: string
  direction: GridSortDirection
}

export type GridBuiltinFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'

export type GridFilterOperator = GridBuiltinFilterOperator | (string & {})

export type GridScalar = string | number | boolean | null

export type GridFilterValue = GridScalar | readonly GridScalar[]

export type GridColumnFilter = {
  columnId: string
  operator: GridFilterOperator
  value: GridFilterValue
}

export type GridFilter = GridColumnFilter

export type GridGlobalFilter = {
  value: string
  operator?: 'search' | (string & {})
}

export type GridOffsetSlice = {
  kind: 'offset'
  offset: number
  limit: number
}

export type GridCursorSlice = {
  kind: 'cursor'
  cursor?: string
  limit: number
  direction: 'forward' | 'backward'
}

export type GridSlice = GridOffsetSlice | GridCursorSlice

export type GridGroupingDescriptor = {
  columnId: string
  direction?: GridSortDirection
}

export type GridAggregateRequest = {
  columnId: string
  fn: string
  alias?: string
}

export type GridHierarchyQuery =
  | { mode: 'flat' }
  | {
      mode: 'group'
      groupBy: readonly GridGroupingDescriptor[]
      aggregates?: readonly GridAggregateRequest[]
    }
  | {
      mode: 'tree'
      aggregates?: readonly GridAggregateRequest[]
    }

export type GridQuery = {
  slice: GridSlice
  sort: GridSort[]
  filters: GridColumnFilter[]
  globalFilter?: GridGlobalFilter | null
  hierarchy?: GridHierarchyQuery | null
}

export type GridLoadReason =
  | 'initial'
  | 'query-change'
  | 'viewport-change'
  | 'refresh'
  | 'expand'

export type GridLoadContext = {
  signal: AbortSignal
  requestId: number
  reason: GridLoadReason
}

export type GridOffsetPageInfo = {
  kind: 'offset'
  totalRowCount?: number
  hasNextPage?: boolean
}

export type GridCursorPageInfo = {
  kind: 'cursor'
  nextCursor?: string
  prevCursor?: string
  hasNextPage?: boolean
}

export type GridPageInfo = GridOffsetPageInfo | GridCursorPageInfo

export type GridCacheState = 'miss' | 'fresh' | 'stale'

export type GridLoadResult<TData> = {
  rows: TData[]
  pageInfo: GridPageInfo
  cacheState?: GridCacheState
}

export type GridAggregateValue = {
  columnId: string
  fn: string
  alias: string
  value: unknown
  isPartial?: boolean
}

export type GridAggregateBag = Readonly<Record<string, GridAggregateValue>>

export type GridNodeBase = {
  nodeId: GridNodeId
  parentNodeId: GridNodeId | null
  depth: number
  isExpanded: boolean
  isExpandable: boolean
  childCount: number | null
  aggregates?: GridAggregateBag
}

export type GridLeafNode<TData> = GridNodeBase & {
  kind: 'leaf'
  rowId: GridRowId
  row: TData
  revision?: GridRowRevision
}

export type GridTreeNode<TData> = GridNodeBase & {
  kind: 'tree'
  rowId: GridRowId
  row: TData
  revision?: GridRowRevision
}

export type GridGroupNode = GridNodeBase & {
  kind: 'group'
  groupColumnId: string
  groupKey: GridScalar
  groupPath: readonly {
    columnId: string
    value: GridScalar
  }[]
  descendantRowCount: number | null
}

export type GridAggregateNode = GridNodeBase & {
  kind: 'aggregate'
  ownerNodeId: GridNodeId | null
  placement: 'inline' | 'footer'
}

export type GridPlaceholderNode = GridNodeBase & {
  kind: 'placeholder'
  placeholder: 'loading' | 'unloaded' | 'error'
  ownerNodeId: GridNodeId | null
  childIndex: number | null
}

export type GridNode<TData> =
  | GridLeafNode<TData>
  | GridTreeNode<TData>
  | GridGroupNode
  | GridAggregateNode
  | GridPlaceholderNode

export type GridLoadTarget =
  | { kind: 'root-window'; window: GridWindow }
  | { kind: 'children-window'; parentNodeId: GridNodeId; window: GridWindow }

export type GridExecutionRequest = {
  query: GridQuery
  expansion: ReadonlySet<GridNodeId>
  target: GridLoadTarget
}

export type GridNodeLoadResult<TData> = {
  target: GridLoadTarget
  nodes: readonly GridNode<TData>[]
  totalChildren: number | null
  totalRowCount?: number | null
  hasNextPage?: boolean
  cacheState?: GridCacheState
}

export interface GridDataSource<TData> {
  load(
    query: GridQuery,
    context: GridLoadContext,
  ): Promise<GridLoadResult<TData>>
}

export interface GridHierarchicalDataSource<
  TData,
> extends GridDataSource<TData> {
  loadNodes(
    request: GridExecutionRequest,
    context: GridLoadContext,
  ): Promise<GridNodeLoadResult<TData>>
}

export type GridPatch<TData> =
  | {
      type: 'row-upsert'
      row: TData
      changedFields?: readonly string[]
      revision?: GridRowRevision
      position?: { index: number }
      parentNodeId?: GridNodeId | null
      acknowledgedMutationId?: string
    }
  | {
      type: 'row-delete'
      rowId: GridRowId
      revision?: GridRowRevision
      position?: { index: number }
      parentNodeId?: GridNodeId | null
      acknowledgedMutationId?: string
    }
  | {
      type: 'invalidate'
      scope: 'query' | 'dataset'
      reason?: 'refresh-requested' | 'rank-uncertain' | 'schema-changed'
      rowIds?: readonly GridRowId[]
      nodeIds?: readonly GridNodeId[]
    }
  | {
      type: 'children-invalidate'
      parentNodeId: GridNodeId | null
      reason?: 'refresh-requested' | 'rank-uncertain' | 'aggregate-changed'
    }

export interface GridLiveDataSource<TData> extends GridDataSource<TData> {
  subscribe?(
    query: GridQuery,
    sink: (patch: GridPatch<TData>) => void,
  ): () => void
}

export interface GridHierarchicalLiveDataSource<
  TData,
> extends GridHierarchicalDataSource<TData> {
  subscribeNodes?(
    query: GridQuery,
    expansion: ReadonlySet<GridNodeId>,
    sink: (patch: GridPatch<TData>) => void,
  ): () => void
}

export type GridSaveMode = 'pessimistic' | 'optimistic'

export type GridEditPhase =
  | 'idle'
  | 'editing'
  | 'validating'
  | 'saving'
  | 'error'
  | 'conflict'

export type GridCellDraft = {
  columnId: string
  value: unknown
  error?: string | null
  dirty: boolean
}

export type GridRowDraft<TData> = {
  rowId: GridRowId
  baseRow: TData
  remoteRow: TData
  cells: Readonly<Record<string, GridCellDraft>>
  phase: GridEditPhase
  clientMutationId?: string
}

export type GridSaveRequest<TData> = {
  rowId: GridRowId
  columnId: string
  patch: Record<string, unknown>
  baseRow: TData
  draftRow: TData
  baseRevision?: GridRowRevision
  clientMutationId: string
}

export type GridSaveResult<TData> = {
  row: TData
  revision?: GridRowRevision
  acknowledgedMutationId?: string
}

export interface GridEditableDataSource<TData> extends GridDataSource<TData> {
  save?(
    request: GridSaveRequest<TData>,
    context: { signal: AbortSignal },
  ): Promise<GridSaveResult<TData>>
}

export type GridStatus = 'idle' | 'loading' | 'ready' | 'error'

export type GridWindow = {
  start: number
  end: number
}

export type GridStoredRow<TData> = {
  row: TData
  rowId: GridRowId
  revision?: GridRowRevision
}

export type GridRowStore<TData> = {
  rowsByIndex: ReadonlyMap<number, GridStoredRow<TData>>
  indexByRowId: ReadonlyMap<GridRowId, number>
  revisionsByRowId: ReadonlyMap<GridRowId, GridRowRevision>
  loadedWindows: readonly GridWindow[]
  staleWindows: readonly GridWindow[]
}

export type GridContainerState = {
  ownerNodeId: GridNodeId | null
  nodesByIndex: ReadonlyMap<number, GridNodeId>
  loadedWindows: readonly GridWindow[]
  staleWindows: readonly GridWindow[]
  childCount: number | null
  hasNextPage: boolean | null
}

export type GridNodeStore<TData> = {
  nodesById: ReadonlyMap<GridNodeId, GridNode<TData>>
  nodeIdByRowId: ReadonlyMap<GridRowId, GridNodeId>
  locationByNodeId: ReadonlyMap<
    GridNodeId,
    {
      ownerNodeId: GridNodeId | null
      index: number
    }
  >
  revisionsByRowId: ReadonlyMap<GridRowId, GridRowRevision>
  containers: ReadonlyMap<string, GridContainerState>
}

export type GridVisibleNode<TData> = {
  visibleIndex: number
  node: GridNode<TData>
  row: TData | null
  canonicalRow: TData | null
  rowId: GridRowId | null
}

export type GridVisibleRow<TData> = {
  index: number
  isLoaded: boolean
  row: TData | null
  canonicalRow: TData | null
  rowId: GridRowId | null
  nodeId: GridNodeId
  node: GridNode<TData>
  kind: GridNode<TData>['kind']
  depth: number
  isExpandable: boolean
  isExpanded: boolean
  aggregates?: GridAggregateBag
}

export type GridVirtualizationOptions = {
  enabled?: boolean
  rowHeight: number
  overscan: number
  viewportDebounceMs: number
}

export type GridVirtualizationState = {
  enabled: boolean
  rowHeight: number
  overscan: number
  viewportDebounceMs: number
  viewport: GridWindow
  requestedRange: GridWindow | null
}

export type GridRetryOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

export type GridColumnsState = {
  visibility: Readonly<Record<string, boolean>>
  order: readonly string[]
}

export type GridSelectionMode = 'include' | 'all-matching'

export type GridSelectionScope = {
  matchKey: string
  query: Pick<GridQuery, 'filters' | 'globalFilter'>
  capturedRowCount?: number | null
}

export type GridSelectionState = {
  mode: GridSelectionMode
  includedIds: readonly GridRowId[]
  excludedIds: readonly GridRowId[]
  scope: GridSelectionScope | null
}

export type GridSelectionScopeStatus = 'none' | 'current' | 'detached'

export type GridSelectionRequest =
  | { kind: 'ids'; ids: readonly GridRowId[] }
  | {
      kind: 'all-matching'
      query: GridSelectionScope['query']
      includedIds: readonly GridRowId[]
      excludedIds: readonly GridRowId[]
    }

export type GridSelectionSummary = {
  mode: GridSelectionMode
  selectedCount: number | null
  scopeStatus: GridSelectionScopeStatus
  isAllVisibleSelected: boolean
  isSomeVisibleSelected: boolean
}

export type GridRequestState = {
  status: GridStatus
  error: unknown
  inFlightCount: number
  lastRequestId: number
  isInitialLoading: boolean
  isReloading: boolean
}

export type GridLiveStatus = 'idle' | 'subscribing' | 'ready' | 'error'

export type GridLiveState = {
  status: GridLiveStatus
  error: unknown
  subscriptionKey: string | null
  lastPatchAt: number | null
  hasPendingInvalidation: boolean
}

export type GridPendingMutation<TData> = {
  rowId: GridRowId
  columnId: string
  row: TData
  patch: Record<string, unknown>
  clientMutationId: string
  startedAt: number
}

export type GridEditingState<TData> = {
  saveMode: GridSaveMode
  activeCell: {
    rowId: GridRowId
    columnId: string
  } | null
  drafts: Readonly<Record<string, GridRowDraft<TData>>>
  pending: Readonly<Record<string, GridPendingMutation<TData>>>
}

export type GridHierarchyState = {
  expandedNodeIds: readonly GridNodeId[]
}

export type GridDataState<TData> = {
  viewKey: string
  matchKey: string
  rowStore: GridRowStore<TData>
  nodeStore: GridNodeStore<TData>
  rowCount: number | null
  visibleRowCount: number
  hasNextPage: boolean | null
  pageInfo: GridPageInfo | null
  hasData: boolean
  cacheState: GridCacheState
}

export type GridState<TData> = {
  query: GridQuery
  columns: GridColumnsState
  selection: GridSelectionState
  hierarchy: GridHierarchyState
  data: GridDataState<TData>
  request: GridRequestState
  virtualization: GridVirtualizationState
  live: GridLiveState
  editing: GridEditingState<TData>
}

export type GridEditingOptions<TData> = {
  saveMode?: GridSaveMode
  isCellEditable?: (row: TData, columnId: string) => boolean
  getCellValue?: (row: TData, columnId: string) => unknown
  applyCellValue: (row: TData, columnId: string, value: unknown) => TData
  validateCell?: (row: TData, columnId: string, value: unknown) => string | null
}

export type GridControllerOptions<TData> = {
  dataSource: GridDataSource<TData>
  getRowId: (row: TData) => GridRowId
  getRowRevision?: (row: TData) => GridRowRevision | undefined
  initialQuery: GridQuery
  initialColumns?: GridColumnsState
  initialSelection?: GridSelectionState
  virtualization?: Partial<GridVirtualizationOptions>
  retry?: Partial<GridRetryOptions>
  editing?: GridEditingOptions<TData>
}

export type GridQueryUpdater = GridQuery | ((query: GridQuery) => GridQuery)

export type GridCachedWindow<TData> = {
  rows: readonly TData[]
  pageInfo: GridPageInfo
  rowCount: number | null
  rowIds: readonly GridRowId[]
  cachedAt: number
  staleAt: number | null
}

export type GridCachedNodeWindow<TData> = {
  nodes: readonly GridNode<TData>[]
  totalChildren: number | null
  totalRowCount: number | null
  cachedAt: number
  staleAt: number | null
}

export interface GridQueryCache<TData> {
  get(datasetKey: string, window: GridWindow): GridCachedWindow<TData> | null
  set(
    datasetKey: string,
    window: GridWindow,
    value: GridCachedWindow<TData>,
  ): void
  getNodes?(
    datasetKey: string,
    target: GridLoadTarget,
  ): GridCachedNodeWindow<TData> | null
  setNodes?(
    datasetKey: string,
    target: GridLoadTarget,
    value: GridCachedNodeWindow<TData>,
  ): void
  markWindowStale(datasetKey: string, window: GridWindow): void
  markNodesStale?(datasetKey: string, target: GridLoadTarget): void
  markDatasetStale(datasetKey: string): void
  clear(datasetKey?: string): void
}

export type GridQueryCacheOptions = {
  staleTimeMs?: number
  maxDatasets?: number
  maxWindowsPerDataset?: number
}

export type GridCachedDataSourceOptions<TData> = GridQueryCacheOptions & {
  getRowId: (row: TData) => GridRowId
}

export interface GridController<TData> {
  getState(): GridState<TData>
  getVisibleRows(): readonly GridVisibleRow<TData>[]
  getVisibleNodes(): readonly GridVisibleNode<TData>[]
  getNode(nodeId: GridNodeId): GridNode<TData> | null
  isNodeExpanded(nodeId: GridNodeId): boolean
  getRowDraft(rowId: GridRowId): GridRowDraft<TData> | null
  getCellDraft(rowId: GridRowId, columnId: string): GridCellDraft | null
  subscribe(listener: () => void): () => void
  setQuery(query: GridQuery, reason?: Exclude<GridLoadReason, 'initial'>): void
  patchQuery(
    updater: (query: GridQuery) => GridQuery,
    reason?: Exclude<GridLoadReason, 'initial'>,
  ): void
  setSelection(selection: GridSelectionState): void
  patchSelection(
    updater: (selection: GridSelectionState) => GridSelectionState,
  ): void
  toggleRowSelection(rowId: GridRowId): void
  selectRows(rowIds: readonly GridRowId[]): void
  deselectRows(rowIds: readonly GridRowId[]): void
  selectVisibleRows(): void
  selectCurrentPage(): void
  selectAllMatching(): void
  clearSelection(): void
  isRowSelected(rowId: GridRowId): boolean
  getSelectionRequest(): GridSelectionRequest
  getSelectionSummary(): GridSelectionSummary
  setColumnsState(columns: GridColumnsState): void
  patchColumnsState(
    updater: (columns: GridColumnsState) => GridColumnsState,
  ): void
  toggleNode(nodeId: GridNodeId): void
  expandNode(nodeId: GridNodeId): void
  collapseNode(nodeId: GridNodeId): void
  setViewport(window: GridWindow): void
  refresh(): void
  applyPatch(patch: GridPatch<TData>): void
  startCellEdit(rowId: GridRowId, columnId: string): void
  updateCellDraft(rowId: GridRowId, columnId: string, value: unknown): void
  commitCellEdit(rowId: GridRowId, columnId: string): Promise<void>
  cancelCellEdit(rowId: GridRowId, columnId: string): void
  updateDataSource(dataSource: GridDataSource<TData>): void
  updateGetRowId(getRowId: (row: TData) => GridRowId): void
  updateGetRowRevision?(
    getRowRevision: (row: TData) => GridRowRevision | undefined,
  ): void
  destroy(): void
}
