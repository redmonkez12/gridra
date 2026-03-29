import type { ReactNode } from 'react'
import type {
  GridCellDraft,
  GridColumnsState,
  GridColumnFilter,
  GridController,
  GridDataSource,
  GridEditingState,
  GridFilterValue,
  GridGlobalFilter,
  GridLiveState,
  GridLoadReason,
  GridNode,
  GridNodeId,
  GridPageInfo,
  GridQuery,
  GridRequestState,
  GridRetryOptions,
  GridRowId,
  GridSelectionRequest,
  GridSelectionState,
  GridSelectionSummary,
  GridState,
  GridVirtualizationOptions,
  GridVisibleNode,
  GridVisibleRow,
  GridWindow,
} from '@gridra/core'

export type GridAccessor<TData, TValue> = keyof TData | ((row: TData) => TValue)

export type GridColumnFilterSpec = {
  operators?: readonly string[]
  parse?: (raw: string) => GridFilterValue
  format?: (value: GridFilterValue) => string
}

export type GridColumnDef<TData, TValue = unknown> = {
  id: string
  header: ReactNode
  accessor?: GridAccessor<TData, TValue>
  sortable?: boolean
  filter?: GridColumnFilterSpec | false
  defaultVisible?: boolean
  hideable?: boolean
  reorderable?: boolean
  edit?: {
    editable?: boolean
    parse?: (raw: string, row: TData) => unknown
    format?: (value: unknown, row: TData) => string
    validate?: (value: unknown, row: TData) => string | null
    setValue?: (row: TData, value: unknown) => TData
    commitOnBlur?: boolean
  }
  renderCell?: (ctx: {
    row: TData
    rowId: GridRowId
    value: TValue
    column: GridColumnDef<TData, TValue>
  }) => ReactNode
}

export type GridQueryChangeMeta = {
  reason: Exclude<GridLoadReason, 'initial'> | 'url-sync'
  source: 'internal' | 'external' | 'url'
}

export type GridStateChangeMeta = {
  source: 'internal' | 'external' | 'url'
}

export type UseDataGridOptions<TData> = {
  columns: readonly GridColumnDef<TData>[]
  dataSource: GridDataSource<TData>
  getRowId: (row: TData) => GridRowId
  query?: GridQuery
  defaultQuery?: GridQuery
  onQueryChange?: (query: GridQuery, meta: GridQueryChangeMeta) => void
  selection?: GridSelectionState
  defaultSelection?: GridSelectionState
  onSelectionChange?: (
    selection: GridSelectionState,
    meta: GridStateChangeMeta,
  ) => void
  columnsState?: GridColumnsState
  defaultColumns?: GridColumnsState
  onColumnsChange?: (
    columns: GridColumnsState,
    meta: GridStateChangeMeta,
  ) => void
  virtualization?: Partial<GridVirtualizationOptions>
  retry?: Partial<GridRetryOptions>
}

export type UseDataSourceResult<TData> = {
  rows: TData[]
  pageInfo: GridPageInfo | null
  status: GridRequestState['status']
  error: unknown
  refresh: () => void
}

export type UseGridUrlSyncOptions = {
  mode?: 'replace' | 'push'
  sync?: Array<'query' | 'columns'>
}

export type GridResolvedColumn<TData, TValue = unknown> = GridColumnDef<
  TData,
  TValue
> & {
  isVisible: boolean
  canHide: boolean
  canReorder: boolean
}

export type GridColumnsApi<TData> = {
  allColumns: readonly GridResolvedColumn<TData>[]
  orderedColumns: readonly GridResolvedColumn<TData>[]
  visibleColumns: readonly GridResolvedColumn<TData>[]
  visibility: GridColumnsState['visibility']
  order: GridColumnsState['order']
  setColumnsState: (
    updater:
      | GridColumnsState
      | ((columns: GridColumnsState) => GridColumnsState),
    meta?: Partial<GridStateChangeMeta>,
  ) => void
  setColumnVisibility: (
    visibility:
      | GridColumnsState['visibility']
      | ((
          visibility: GridColumnsState['visibility'],
        ) => GridColumnsState['visibility']),
    meta?: Partial<GridStateChangeMeta>,
  ) => void
  toggleColumnVisibility: (columnId: string) => void
  showAllColumns: () => void
  setColumnOrder: (order: readonly string[]) => void
  moveColumn: (
    columnId: string,
    target:
      | number
      | {
          before?: string
          after?: string
        },
  ) => void
}

export type GridFiltersApi = {
  filters: readonly GridColumnFilter[]
  globalFilter: GridGlobalFilter | null
  setFilters: (filters: GridQuery['filters']) => void
  setColumnFilters: (filters: GridQuery['filters']) => void
  upsertColumnFilter: (
    columnId: string,
    operator: string,
    value: GridFilterValue,
  ) => void
  removeColumnFilter: (columnId: string, operator?: string) => void
  setGlobalFilter: (
    value: string | null,
    operator?: GridGlobalFilter['operator'],
  ) => void
  clearFilters: () => void
}

export type GridSelectionApi = {
  selection: GridSelectionState
  summary: GridSelectionSummary
  request: GridSelectionRequest
  setSelection: (
    updater:
      | GridSelectionState
      | ((selection: GridSelectionState) => GridSelectionState),
    meta?: Partial<GridStateChangeMeta>,
  ) => void
  toggleRow: (rowId: GridRowId) => void
  selectRows: (rowIds: readonly GridRowId[]) => void
  deselectRows: (rowIds: readonly GridRowId[]) => void
  selectVisibleRows: () => void
  selectCurrentPage: () => void
  selectAllMatching: () => void
  clearSelection: () => void
  isRowSelected: (rowId: GridRowId) => boolean
}

export type GridEditingApi<TData> = {
  state: GridEditingState<TData>
  startCellEdit: (rowId: GridRowId, columnId: string) => void
  updateCellDraft: (rowId: GridRowId, columnId: string, value: unknown) => void
  commitCellEdit: (rowId: GridRowId, columnId: string) => Promise<void>
  cancelCellEdit: (rowId: GridRowId, columnId: string) => void
  getRowDraft: (
    rowId: GridRowId,
  ) => GridEditingState<TData>['drafts'][string] | null
  getCellDraft: (rowId: GridRowId, columnId: string) => GridCellDraft | null
}

export type GridLiveApi = {
  live: GridLiveState
}

export type GridHierarchyApi<TData> = {
  visibleNodes: readonly GridVisibleNode<TData>[]
  getNode: (nodeId: GridNodeId) => GridNode<TData> | null
  isNodeExpanded: (nodeId: GridNodeId) => boolean
  toggleNode: (nodeId: GridNodeId) => void
  expandNode: (nodeId: GridNodeId) => void
  collapseNode: (nodeId: GridNodeId) => void
}

export type DataGridInstance<TData> = {
  controller: GridController<TData>
  columns: readonly GridColumnDef<TData>[]
  getQuery: () => GridQuery
  getState: () => GridState<TData>
  getSelection: () => GridSelectionState
  getColumnsState: () => GridColumnsState
  getSelectionRequest: () => GridSelectionRequest
  getSelectionSummary: () => GridSelectionSummary
  getRowDraft: (
    rowId: GridRowId,
  ) => GridEditingState<TData>['drafts'][string] | null
  getCellDraft: (rowId: GridRowId, columnId: string) => GridCellDraft | null
  isRowSelected: (rowId: GridRowId) => boolean
  getColumnValue: <TValue>(
    row: TData,
    column: GridColumnDef<TData, TValue>,
  ) => TValue | unknown
  setQuery: (
    updater: GridQuery | ((query: GridQuery) => GridQuery),
    meta?: Partial<GridQueryChangeMeta>,
  ) => void
  setSort: (sort: GridQuery['sort']) => void
  toggleSort: (columnId: string, options?: { multi?: boolean }) => void
  setFilters: (filters: GridQuery['filters']) => void
  setColumnFilters: (filters: GridQuery['filters']) => void
  upsertColumnFilter: (
    columnId: string,
    operator: string,
    value: GridFilterValue,
  ) => void
  removeColumnFilter: (columnId: string, operator?: string) => void
  setGlobalFilter: (
    value: string | null,
    operator?: GridGlobalFilter['operator'],
  ) => void
  clearFilters: () => void
  setSelection: (
    updater:
      | GridSelectionState
      | ((selection: GridSelectionState) => GridSelectionState),
    meta?: Partial<GridStateChangeMeta>,
  ) => void
  toggleRowSelection: (rowId: GridRowId) => void
  selectRows: (rowIds: readonly GridRowId[]) => void
  deselectRows: (rowIds: readonly GridRowId[]) => void
  selectVisibleRows: () => void
  selectCurrentPage: () => void
  selectAllMatching: () => void
  clearSelection: () => void
  startCellEdit: (rowId: GridRowId, columnId: string) => void
  updateCellDraft: (rowId: GridRowId, columnId: string, value: unknown) => void
  commitCellEdit: (rowId: GridRowId, columnId: string) => Promise<void>
  cancelCellEdit: (rowId: GridRowId, columnId: string) => void
  setColumnsState: (
    updater:
      | GridColumnsState
      | ((columns: GridColumnsState) => GridColumnsState),
    meta?: Partial<GridStateChangeMeta>,
  ) => void
  setColumnVisibility: (
    visibility:
      | GridColumnsState['visibility']
      | ((
          visibility: GridColumnsState['visibility'],
        ) => GridColumnsState['visibility']),
    meta?: Partial<GridStateChangeMeta>,
  ) => void
  toggleColumnVisibility: (columnId: string) => void
  showAllColumns: () => void
  setColumnOrder: (order: readonly string[]) => void
  moveColumn: (
    columnId: string,
    target:
      | number
      | {
          before?: string
          after?: string
        },
  ) => void
  setPage: (offset: number) => void
  setPageSize: (limit: number) => void
  nextPage: () => void
  prevPage: () => void
  getNode: (nodeId: GridNodeId) => GridNode<TData> | null
  isNodeExpanded: (nodeId: GridNodeId) => boolean
  toggleNode: (nodeId: GridNodeId) => void
  expandNode: (nodeId: GridNodeId) => void
  collapseNode: (nodeId: GridNodeId) => void
  setViewport: (window: GridWindow) => void
  refresh: () => void
}

export type GridSelector<TData, TResult> = (
  controller: GridController<TData>,
) => TResult

export type GridVirtualRowsSnapshot<TData> = {
  rows: readonly GridVisibleRow<TData>[]
  rowCount: number | null
  totalRowCount: number | null
  visibleNodes: readonly GridVisibleNode<TData>[]
  rowHeight: number
  overscan: number
  viewport: GridWindow
}
