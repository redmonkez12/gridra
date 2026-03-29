import {
  areQueriesEqual,
  createAllMatchingSelection,
  createDefaultQuery,
  createEmptyColumnsState,
  createEmptySelectionState,
  createGridController,
  createSelectionRequest,
  getMatchKey,
  getSelectionScopeStatus,
  isRowSelected as isSelectionRowSelected,
  normalizeColumnsState,
  normalizeQuery,
  normalizeSelectionState,
  resetOffset,
} from '@gridra/core'
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type {
  GridColumnsState,
  GridNodeId,
  GridQuery,
  GridRowId,
  GridSelectionState,
  GridState,
  GridVisibleNode,
  GridVisibleRow,
  GridWindow,
} from '@gridra/core'
import type {
  DataGridInstance,
  GridColumnDef,
  GridColumnsApi,
  GridEditingApi,
  GridFiltersApi,
  GridHierarchyApi,
  GridLiveApi,
  GridQueryChangeMeta,
  GridResolvedColumn,
  GridSelectionApi,
  GridSelector,
  GridStateChangeMeta,
  GridVirtualRowsSnapshot,
  UseDataGridOptions,
} from './types'

function useLatestRef<TValue>(value: TValue) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

function areSelectionsEqual(
  previous: GridSelectionState,
  next: GridSelectionState,
): boolean {
  return (
    JSON.stringify(normalizeSelectionState(previous)) ===
    JSON.stringify(normalizeSelectionState(next))
  )
}

function areColumnsStateEqual(
  previous: GridColumnsState,
  next: GridColumnsState,
): boolean {
  return (
    JSON.stringify(normalizeColumnsState(previous)) ===
    JSON.stringify(normalizeColumnsState(next))
  )
}

function sanitizeColumnsStateForDefs<TData>(
  columns: readonly GridColumnDef<TData>[],
  state: GridColumnsState,
): GridColumnsState {
  const normalized = normalizeColumnsState(state)
  const visibility = { ...normalized.visibility }

  for (const column of columns) {
    if (column.hideable === false) {
      delete visibility[column.id]
    }
  }

  return normalizeColumnsState({
    visibility,
    order: normalized.order,
  })
}

function getColumnById<TData>(
  columns: readonly GridColumnDef<TData>[],
  columnId: string,
): GridColumnDef<TData> | undefined {
  return columns.find((column) => column.id === columnId)
}

export function resolveGridColumns<TData>(
  columns: readonly GridColumnDef<TData>[],
  state: GridColumnsState,
): readonly GridResolvedColumn<TData>[] {
  const normalizedState = sanitizeColumnsStateForDefs(columns, state)
  const columnsById = new Map(
    columns.map((column) => [column.id, column] as const),
  )
  const ordered: GridColumnDef<TData>[] = []
  const seen = new Set<string>()

  for (const columnId of normalizedState.order) {
    const column = columnsById.get(columnId)
    if (!column || seen.has(column.id)) {
      continue
    }

    seen.add(column.id)
    ordered.push(column)
  }

  for (const column of columns) {
    if (seen.has(column.id)) {
      continue
    }

    seen.add(column.id)
    ordered.push(column)
  }

  return ordered.map((column) => {
    const canHide = column.hideable !== false
    return {
      ...column,
      canHide,
      canReorder: column.reorderable !== false,
      isVisible: canHide
        ? (normalizedState.visibility[column.id] ??
          column.defaultVisible ??
          true)
        : true,
    }
  })
}

function moveColumnOrder(
  order: readonly string[],
  columnId: string,
  target:
    | number
    | {
        before?: string
        after?: string
      },
): string[] {
  const nextOrder = [...order.filter((entry) => entry !== columnId)]
  let targetIndex = nextOrder.length

  if (typeof target === 'number') {
    targetIndex = Math.max(0, Math.min(target, nextOrder.length))
  } else if (target.before) {
    const beforeIndex = nextOrder.indexOf(target.before)
    targetIndex = beforeIndex === -1 ? nextOrder.length : beforeIndex
  } else if (target.after) {
    const afterIndex = nextOrder.indexOf(target.after)
    targetIndex = afterIndex === -1 ? nextOrder.length : afterIndex + 1
  }

  nextOrder.splice(targetIndex, 0, columnId)
  return nextOrder
}

function applySelectRows(
  selection: GridSelectionState,
  rowIds: readonly GridRowId[],
): GridSelectionState {
  const includedIds = new Set(selection.includedIds)
  const excludedIds = new Set(selection.excludedIds)

  for (const rowId of rowIds) {
    includedIds.add(rowId)
    excludedIds.delete(rowId)
  }

  return normalizeSelectionState({
    ...selection,
    includedIds: [...includedIds],
    excludedIds: selection.mode === 'all-matching' ? [...excludedIds] : [],
  })
}

function applyDeselectRows(
  selection: GridSelectionState,
  rowIds: readonly GridRowId[],
): GridSelectionState {
  const includedIds = new Set(selection.includedIds)
  const excludedIds = new Set(selection.excludedIds)

  for (const rowId of rowIds) {
    includedIds.delete(rowId)
    if (selection.mode === 'all-matching') {
      excludedIds.add(rowId)
    }
  }

  return normalizeSelectionState({
    ...selection,
    includedIds: [...includedIds],
    excludedIds: selection.mode === 'all-matching' ? [...excludedIds] : [],
  })
}

export function getColumnValue<TData, TValue>(
  row: TData,
  column: GridColumnDef<TData, TValue>,
): TValue | unknown {
  if (typeof column.accessor === 'function') {
    return column.accessor(row)
  }

  if (typeof column.accessor === 'string') {
    return row[column.accessor]
  }

  return undefined
}

export function useGridSelector<TData, TResult>(
  grid: DataGridInstance<TData>,
  selector: GridSelector<TData, TResult>,
  isEqual?: (previous: TResult, next: TResult) => boolean,
): TResult {
  const cacheRef = useRef<{
    result: TResult
    state: GridState<TData>
  } | null>(null)

  return useSyncExternalStore(
    grid.controller.subscribe,
    () => {
      const state = grid.controller.getState()
      const cached = cacheRef.current
      if (cached !== null && cached.state === state) {
        return cached.result
      }

      const result = selector(grid.controller)
      if (cached !== null && isEqual?.(cached.result, result)) {
        cacheRef.current = { result: cached.result, state }
        return cached.result
      }

      cacheRef.current = { result, state }
      return result
    },
    () => {
      const state = grid.controller.getState()
      const cached = cacheRef.current
      if (cached !== null && cached.state === state) {
        return cached.result
      }

      const result = selector(grid.controller)
      if (cached !== null && isEqual?.(cached.result, result)) {
        cacheRef.current = { result: cached.result, state }
        return cached.result
      }

      cacheRef.current = { result, state }
      return result
    },
  )
}

export function useGridQuery<TData>(grid: DataGridInstance<TData>): GridQuery {
  return useGridSelector(grid, (controller) => controller.getState().query)
}

export function useGridState<TData>(
  grid: DataGridInstance<TData>,
): GridState<TData> {
  return useGridSelector(grid, (controller) => controller.getState())
}

export function useGridRows<TData>(
  grid: DataGridInstance<TData>,
): readonly GridVisibleRow<TData>[] {
  return useGridSelector(grid, (controller) => controller.getVisibleRows())
}

export function useGridNodes<TData>(
  grid: DataGridInstance<TData>,
): readonly GridVisibleNode<TData>[] {
  return useGridSelector(grid, (controller) => controller.getVisibleNodes())
}

export function useGridStatus<TData>(
  grid: DataGridInstance<TData>,
): GridState<TData>['request']['status'] {
  return useGridSelector(
    grid,
    (controller) => controller.getState().request.status,
  )
}

export function useGridVirtualRows<TData>(
  grid: DataGridInstance<TData>,
): GridVirtualRowsSnapshot<TData> {
  return useGridSelector(
    grid,
    (controller) => {
      const state = controller.getState()
      return {
        rows: controller.getVisibleRows(),
        rowCount: state.data.visibleRowCount,
        totalRowCount: state.data.rowCount,
        visibleNodes: controller.getVisibleNodes(),
        rowHeight: state.virtualization.rowHeight,
        overscan: state.virtualization.overscan,
        viewport: state.virtualization.viewport,
      }
    },
    (previous, next) =>
      previous.rows === next.rows &&
      previous.rowCount === next.rowCount &&
      previous.totalRowCount === next.totalRowCount &&
      previous.visibleNodes === next.visibleNodes &&
      previous.rowHeight === next.rowHeight &&
      previous.overscan === next.overscan &&
      previous.viewport.start === next.viewport.start &&
      previous.viewport.end === next.viewport.end,
  )
}

export function useGridHierarchy<TData>(
  grid: DataGridInstance<TData>,
): GridHierarchyApi<TData> {
  const visibleNodes = useGridNodes(grid)

  return useMemo(
    () => ({
      visibleNodes,
      getNode: grid.getNode,
      isNodeExpanded: grid.isNodeExpanded,
      toggleNode: grid.toggleNode,
      expandNode: grid.expandNode,
      collapseNode: grid.collapseNode,
    }),
    [grid, visibleNodes],
  )
}

export function useGridFilters<TData>(
  grid: DataGridInstance<TData>,
): GridFiltersApi {
  const query = useGridQuery(grid)

  return useMemo(
    () => ({
      filters: query.filters,
      globalFilter: query.globalFilter ?? null,
      setFilters: grid.setFilters,
      setColumnFilters: grid.setColumnFilters,
      upsertColumnFilter: grid.upsertColumnFilter,
      removeColumnFilter: grid.removeColumnFilter,
      setGlobalFilter: grid.setGlobalFilter,
      clearFilters: grid.clearFilters,
    }),
    [grid, query.filters, query.globalFilter],
  )
}

export function useGridSelection<TData>(
  grid: DataGridInstance<TData>,
): GridSelectionApi {
  const selection = useGridSelector(
    grid,
    (controller) => controller.getState().selection,
  )
  const summary = useGridSelector(grid, (controller) =>
    controller.getSelectionSummary(),
  )
  const request = useGridSelector(grid, (controller) =>
    controller.getSelectionRequest(),
  )

  return useMemo(
    () => ({
      selection,
      summary,
      request,
      setSelection: grid.setSelection,
      toggleRow: grid.toggleRowSelection,
      selectRows: grid.selectRows,
      deselectRows: grid.deselectRows,
      selectVisibleRows: grid.selectVisibleRows,
      selectCurrentPage: grid.selectCurrentPage,
      selectAllMatching: grid.selectAllMatching,
      clearSelection: grid.clearSelection,
      isRowSelected: grid.isRowSelected,
    }),
    [grid, request, selection, summary],
  )
}

export function useGridEditing<TData>(
  grid: DataGridInstance<TData>,
): GridEditingApi<TData> {
  const editingState = useGridSelector(
    grid,
    (controller) => controller.getState().editing,
  )

  return useMemo(
    () => ({
      state: editingState,
      startCellEdit: grid.startCellEdit,
      updateCellDraft: grid.updateCellDraft,
      commitCellEdit: grid.commitCellEdit,
      cancelCellEdit: grid.cancelCellEdit,
      getRowDraft: grid.getRowDraft,
      getCellDraft: grid.getCellDraft,
    }),
    [editingState, grid],
  )
}

export function useGridCellDraft<TData>(
  grid: DataGridInstance<TData>,
  rowId: GridRowId | null,
  columnId: string,
) {
  return useGridSelector(grid, (controller) =>
    rowId === null ? null : controller.getCellDraft(rowId, columnId),
  )
}

export function useGridLiveStatus<TData>(
  grid: DataGridInstance<TData>,
): GridLiveApi {
  const live = useGridSelector(grid, (controller) => controller.getState().live)

  return useMemo(
    () => ({
      live,
    }),
    [live],
  )
}

export function useGridColumns<TData>(
  grid: DataGridInstance<TData>,
): GridColumnsApi<TData> {
  const columnsState = useGridSelector(
    grid,
    (controller) => controller.getState().columns,
  )
  const resolvedColumns = useMemo(
    () => resolveGridColumns(grid.columns, columnsState),
    [columnsState, grid.columns],
  )

  return useMemo(
    () => ({
      allColumns: resolvedColumns,
      orderedColumns: resolvedColumns,
      visibleColumns: resolvedColumns.filter((column) => column.isVisible),
      visibility: columnsState.visibility,
      order: columnsState.order,
      setColumnsState: grid.setColumnsState,
      setColumnVisibility: grid.setColumnVisibility,
      toggleColumnVisibility: grid.toggleColumnVisibility,
      showAllColumns: grid.showAllColumns,
      setColumnOrder: grid.setColumnOrder,
      moveColumn: grid.moveColumn,
    }),
    [columnsState.order, columnsState.visibility, grid, resolvedColumns],
  )
}

export function useDataGrid<TData>(
  options: UseDataGridOptions<TData>,
): DataGridInstance<TData> {
  const {
    columns,
    columnsState,
    dataSource,
    defaultColumns = createEmptyColumnsState(),
    defaultQuery = createDefaultQuery(),
    defaultSelection = createEmptySelectionState(),
    getRowId,
    onColumnsChange,
    onQueryChange,
    onSelectionChange,
    query,
    retry,
    selection,
    virtualization,
  } = options

  const columnsRef = useLatestRef(columns)
  const onColumnsChangeRef = useLatestRef(onColumnsChange)
  const onQueryChangeRef = useLatestRef(onQueryChange)
  const onSelectionChangeRef = useLatestRef(onSelectionChange)
  const queryRef = useLatestRef(query)
  const selectionRef = useLatestRef(selection)
  const columnsStateRef = useLatestRef(columnsState)
  const isQueryControlled = query !== undefined
  const isSelectionControlled = selection !== undefined
  const isColumnsControlled = columnsState !== undefined

  const controllerRef = useRef(
    createGridController<TData>({
      dataSource,
      getRowId,
      initialQuery: normalizeQuery(query ?? defaultQuery),
      initialSelection: normalizeSelectionState(selection ?? defaultSelection),
      initialColumns: sanitizeColumnsStateForDefs(
        columns,
        columnsState ?? defaultColumns,
      ),
      retry,
      virtualization,
      editing: {
        isCellEditable: (_row, columnId) => {
          const column = getColumnById(columnsRef.current, columnId)
          if (!column?.edit) {
            return false
          }

          if (column.edit.editable === false) {
            return false
          }

          return typeof column.accessor === 'string' || !!column.edit.setValue
        },
        getCellValue: (row, columnId) => {
          const column = getColumnById(columnsRef.current, columnId)
          return column ? getColumnValue(row, column) : undefined
        },
        applyCellValue: (row, columnId, value) => {
          const column = getColumnById(columnsRef.current, columnId)
          if (!column?.edit) {
            return row
          }

          if (column.edit.setValue) {
            return column.edit.setValue(row, value)
          }

          if (typeof column.accessor === 'string') {
            return {
              ...(row as Record<string, unknown>),
              [column.accessor]: value,
            } as TData
          }

          return row
        },
        validateCell: (row, columnId, value) => {
          const column = getColumnById(columnsRef.current, columnId)
          return column?.edit?.validate?.(value, row) ?? null
        },
      },
    }),
  )

  const controller = controllerRef.current

  useEffect(() => {
    controller.updateDataSource(dataSource)
  }, [controller, dataSource])

  useEffect(() => {
    controller.updateGetRowId(getRowId)
  }, [controller, getRowId])

  useEffect(() => {
    if (!isQueryControlled || query === undefined) {
      return
    }

    const controllerQuery = controller.getState().query
    if (!areQueriesEqual(controllerQuery, query)) {
      controller.setQuery(normalizeQuery(query), 'query-change')
    }
  }, [controller, isQueryControlled, query])

  useEffect(() => {
    if (!isSelectionControlled || selection === undefined) {
      return
    }

    const controllerSelection = controller.getState().selection
    if (!areSelectionsEqual(controllerSelection, selection)) {
      controller.setSelection(normalizeSelectionState(selection))
    }
  }, [controller, isSelectionControlled, selection])

  useEffect(() => {
    if (!isColumnsControlled || columnsState === undefined) {
      return
    }

    const nextColumnsState = sanitizeColumnsStateForDefs(columns, columnsState)
    const controllerColumns = controller.getState().columns
    if (!areColumnsStateEqual(controllerColumns, nextColumnsState)) {
      controller.setColumnsState(nextColumnsState)
    }
  }, [columns, columnsState, controller, isColumnsControlled])

  useEffect(
    () => () => {
      controller.destroy()
    },
    [controller],
  )

  const emitQueryChange = useEffectEvent(
    (nextQuery: GridQuery, meta: GridQueryChangeMeta) => {
      if (isQueryControlled) {
        onQueryChangeRef.current?.(nextQuery, meta)
        return
      }

      controller.setQuery(
        nextQuery,
        meta.reason === 'url-sync' ? 'query-change' : meta.reason,
      )
      onQueryChangeRef.current?.(nextQuery, meta)
    },
  )

  const emitSelectionChange = useEffectEvent(
    (nextSelection: GridSelectionState, meta: GridStateChangeMeta) => {
      if (isSelectionControlled) {
        onSelectionChangeRef.current?.(nextSelection, meta)
        return
      }

      controller.setSelection(nextSelection)
      onSelectionChangeRef.current?.(nextSelection, meta)
    },
  )

  const emitColumnsChange = useEffectEvent(
    (nextColumns: GridColumnsState, meta: GridStateChangeMeta) => {
      if (isColumnsControlled) {
        onColumnsChangeRef.current?.(nextColumns, meta)
        return
      }

      controller.setColumnsState(nextColumns)
      onColumnsChangeRef.current?.(nextColumns, meta)
    },
  )

  return useMemo<DataGridInstance<TData>>(() => {
    const setQuery: DataGridInstance<TData>['setQuery'] = (updater, meta) => {
      const baseQuery = normalizeQuery(
        queryRef.current ?? controller.getState().query,
      )
      const nextQuery =
        typeof updater === 'function' ? updater(baseQuery) : updater

      emitQueryChange(normalizeQuery(nextQuery), {
        reason: meta?.reason ?? 'query-change',
        source: meta?.source ?? 'internal',
      })
    }

    const setSelection: DataGridInstance<TData>['setSelection'] = (
      updater,
      meta,
    ) => {
      const baseSelection = normalizeSelectionState(
        selectionRef.current ?? controller.getState().selection,
      )
      const nextSelection =
        typeof updater === 'function' ? updater(baseSelection) : updater

      emitSelectionChange(normalizeSelectionState(nextSelection), {
        source: meta?.source ?? 'internal',
      })
    }

    const setColumnsState: DataGridInstance<TData>['setColumnsState'] = (
      updater,
      meta,
    ) => {
      const baseColumns = sanitizeColumnsStateForDefs(
        columnsRef.current,
        columnsStateRef.current ?? controller.getState().columns,
      )
      const nextColumns =
        typeof updater === 'function' ? updater(baseColumns) : updater

      emitColumnsChange(
        sanitizeColumnsStateForDefs(columnsRef.current, nextColumns),
        {
          source: meta?.source ?? 'internal',
        },
      )
    }

    const setSort = (sort: GridQuery['sort']) => {
      setQuery((current) => ({
        ...resetOffset(current),
        sort,
      }))
    }

    const setFilters = (filters: GridQuery['filters']) => {
      setQuery((current) => ({
        ...resetOffset(current),
        filters,
      }))
    }

    const getVisibleLoadedRowIds = (): GridRowId[] =>
      controller
        .getVisibleRows()
        .map((row) => row.rowId)
        .filter((rowId): rowId is GridRowId => rowId !== null)

    return {
      controller,
      get columns() {
        return columnsRef.current
      },
      getQuery: () =>
        normalizeQuery(queryRef.current ?? controller.getState().query),
      getState: () => controller.getState(),
      getSelection: () =>
        normalizeSelectionState(
          selectionRef.current ?? controller.getState().selection,
        ),
      getColumnsState: () =>
        sanitizeColumnsStateForDefs(
          columnsRef.current,
          columnsStateRef.current ?? controller.getState().columns,
        ),
      getSelectionRequest: () =>
        createSelectionRequest(
          selectionRef.current ?? controller.getState().selection,
        ),
      getSelectionSummary: () => {
        const currentSelection =
          selectionRef.current ?? controller.getState().selection
        const currentQuery = queryRef.current ?? controller.getState().query
        const currentState = controller.getState()
        const currentMatchKey = getMatchKey(currentQuery)
        const visibleRowIds = getVisibleLoadedRowIds()
        const selectedVisibleCount = visibleRowIds.filter((rowId) =>
          isSelectionRowSelected(currentSelection, rowId, currentMatchKey),
        ).length
        const scopeStatus = getSelectionScopeStatus(
          currentSelection,
          currentMatchKey,
        )
        const baseCount =
          currentSelection.mode === 'all-matching'
            ? scopeStatus === 'current'
              ? currentState.data.rowCount
              : (currentSelection.scope?.capturedRowCount ?? null)
            : null

        return {
          mode: currentSelection.mode,
          selectedCount:
            currentSelection.mode === 'include'
              ? currentSelection.includedIds.length
              : baseCount === null
                ? null
                : Math.max(
                    0,
                    baseCount +
                      currentSelection.includedIds.length -
                      currentSelection.excludedIds.length,
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
      getRowDraft(rowId) {
        return controller.getRowDraft(rowId)
      },
      getCellDraft(rowId, columnId) {
        return controller.getCellDraft(rowId, columnId)
      },
      isRowSelected(rowId) {
        const currentSelection =
          selectionRef.current ?? controller.getState().selection
        const currentQuery = queryRef.current ?? controller.getState().query
        return isSelectionRowSelected(
          currentSelection,
          rowId,
          getMatchKey(currentQuery),
        )
      },
      getColumnValue,
      setQuery,
      setSort,
      toggleSort(columnId, options) {
        setQuery((current) => {
          const existingIndex = current.sort.findIndex(
            (entry) => entry.columnId === columnId,
          )
          const nextSort = options?.multi ? [...current.sort] : []

          if (existingIndex === -1) {
            nextSort.push({
              columnId,
              direction: 'asc',
            })
          } else {
            const existing = current.sort[existingIndex]
            if (options?.multi) {
              nextSort.splice(existingIndex, 1)
            }

            if (existing.direction === 'asc') {
              nextSort.push({
                columnId,
                direction: 'desc',
              })
            }
          }

          return {
            ...resetOffset(current),
            sort: nextSort,
          }
        })
      },
      setFilters,
      setColumnFilters: setFilters,
      upsertColumnFilter(columnId, operator, value) {
        setQuery((current) => {
          const nextFilters = current.filters.filter(
            (entry) =>
              !(entry.columnId === columnId && entry.operator === operator),
          )
          nextFilters.push({
            columnId,
            operator,
            value,
          })

          return {
            ...resetOffset(current),
            filters: nextFilters,
          }
        })
      },
      removeColumnFilter(columnId, operator) {
        setQuery((current) => ({
          ...resetOffset(current),
          filters: current.filters.filter(
            (entry) =>
              entry.columnId !== columnId ||
              (operator !== undefined && entry.operator !== operator),
          ),
        }))
      },
      setGlobalFilter(value, operator = 'search') {
        setQuery((current) => ({
          ...resetOffset(current),
          globalFilter: value && value.length > 0 ? { value, operator } : null,
        }))
      },
      clearFilters() {
        setQuery((current) => ({
          ...resetOffset(current),
          filters: [],
          globalFilter: null,
        }))
      },
      setSelection,
      toggleRowSelection(rowId) {
        setSelection((currentSelection) => {
          const currentQuery = queryRef.current ?? controller.getState().query
          const currentMatchKey = getMatchKey(currentQuery)

          return isSelectionRowSelected(
            currentSelection,
            rowId,
            currentMatchKey,
          )
            ? applyDeselectRows(currentSelection, [rowId])
            : applySelectRows(currentSelection, [rowId])
        })
      },
      selectRows(rowIds) {
        setSelection((currentSelection) =>
          applySelectRows(currentSelection, rowIds),
        )
      },
      deselectRows(rowIds) {
        setSelection((currentSelection) =>
          applyDeselectRows(currentSelection, rowIds),
        )
      },
      selectVisibleRows() {
        const visibleIds = getVisibleLoadedRowIds()
        setSelection((currentSelection) =>
          applySelectRows(currentSelection, visibleIds),
        )
      },
      selectCurrentPage() {
        if (controller.getState().virtualization.enabled) {
          return
        }

        const visibleIds = getVisibleLoadedRowIds()
        setSelection((currentSelection) =>
          applySelectRows(currentSelection, visibleIds),
        )
      },
      selectAllMatching() {
        setSelection(() => {
          const currentQuery = queryRef.current ?? controller.getState().query
          const currentState = controller.getState()
          return createAllMatchingSelection(
            {
              filters: currentQuery.filters,
              globalFilter: currentQuery.globalFilter ?? null,
            },
            getMatchKey(currentQuery),
            currentState.data.rowCount,
            [],
          )
        })
      },
      clearSelection() {
        setSelection(createEmptySelectionState())
      },
      startCellEdit(rowId, columnId) {
        controller.startCellEdit(rowId, columnId)
      },
      updateCellDraft(rowId, columnId, value) {
        controller.updateCellDraft(rowId, columnId, value)
      },
      commitCellEdit(rowId, columnId) {
        return controller.commitCellEdit(rowId, columnId)
      },
      cancelCellEdit(rowId, columnId) {
        controller.cancelCellEdit(rowId, columnId)
      },
      setColumnsState,
      setColumnVisibility(visibility, meta) {
        setColumnsState(
          (currentColumns) => ({
            ...currentColumns,
            visibility:
              typeof visibility === 'function'
                ? visibility(currentColumns.visibility)
                : visibility,
          }),
          meta,
        )
      },
      toggleColumnVisibility(columnId) {
        setColumnsState((currentColumns) => {
          const column = columnsRef.current.find(
            (entry) => entry.id === columnId,
          )
          if (!column || column.hideable === false) {
            return currentColumns
          }

          return {
            ...currentColumns,
            visibility: {
              ...currentColumns.visibility,
              [columnId]: !(
                currentColumns.visibility[columnId] ??
                column.defaultVisible ??
                true
              ),
            },
          }
        })
      },
      showAllColumns() {
        setColumnsState((currentColumns) => {
          const visibility = { ...currentColumns.visibility }
          for (const column of columnsRef.current) {
            delete visibility[column.id]
          }

          return {
            ...currentColumns,
            visibility,
          }
        })
      },
      setColumnOrder(order) {
        setColumnsState((currentColumns) => ({
          ...currentColumns,
          order: [...order],
        }))
      },
      moveColumn(columnId, target) {
        setColumnsState((currentColumns) => ({
          ...currentColumns,
          order: moveColumnOrder(currentColumns.order, columnId, target),
        }))
      },
      setPage(offset) {
        setQuery((current) => {
          if (current.slice.kind !== 'offset') {
            return current
          }

          return {
            ...current,
            slice: {
              ...current.slice,
              offset: Math.max(0, offset),
            },
          }
        })
      },
      setPageSize(limit) {
        setQuery((current) => {
          if (current.slice.kind !== 'offset') {
            return current
          }

          return {
            ...current,
            slice: {
              ...current.slice,
              limit: Math.max(1, limit),
            },
          }
        })
      },
      nextPage() {
        setQuery((current) => {
          if (current.slice.kind !== 'offset') {
            return current
          }

          return {
            ...current,
            slice: {
              ...current.slice,
              offset: current.slice.offset + current.slice.limit,
            },
          }
        })
      },
      prevPage() {
        setQuery((current) => {
          if (current.slice.kind !== 'offset') {
            return current
          }

          return {
            ...current,
            slice: {
              ...current.slice,
              offset: Math.max(0, current.slice.offset - current.slice.limit),
            },
          }
        })
      },
      getNode(nodeId: GridNodeId) {
        return controller.getNode(nodeId)
      },
      isNodeExpanded(nodeId: GridNodeId) {
        return controller.isNodeExpanded(nodeId)
      },
      toggleNode(nodeId: GridNodeId) {
        controller.toggleNode(nodeId)
      },
      expandNode(nodeId: GridNodeId) {
        controller.expandNode(nodeId)
      },
      collapseNode(nodeId: GridNodeId) {
        controller.collapseNode(nodeId)
      },
      setViewport(window: GridWindow) {
        controller.setViewport(window)
      },
      refresh() {
        controller.refresh()
      },
    }
  }, [
    columnsRef,
    columnsStateRef,
    controller,
    emitColumnsChange,
    emitQueryChange,
    emitSelectionChange,
    queryRef,
    selectionRef,
  ])
}
