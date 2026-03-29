import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  getColumnValue,
  useDataGrid,
  useGridCellDraft,
  useGridColumns,
  useGridEditing,
  useGridFilters,
  useGridHierarchy,
  useGridLiveStatus,
  useGridQuery,
  useGridRows,
  useGridSelection,
  useGridSelector,
  useGridState,
  useGridVirtualRows,
} from '@gridra/react'
import type {
  DataGridInstance,
  GridColumnDef,
  GridResolvedColumn,
  UseDataGridOptions,
} from '@gridra/react'
import type { GridNode, GridRowId, GridVisibleRow } from '@gridra/core'

type DataGridTableProps<TData> = {
  grid: DataGridInstance<TData>
  height?: number
  loadingMessage?: string
  emptyMessage?: string
}

type DataGridProps<TData> = UseDataGridOptions<TData> & {
  height?: number
  loadingMessage?: string
  emptyMessage?: string
}

function renderCellValue<TData>(
  row: TData,
  rowId: string | number,
  column: GridColumnDef<TData>,
) {
  const value = getColumnValue(row, column)
  if (column.renderCell) {
    return column.renderCell({
      row,
      rowId,
      value,
      column,
    })
  }

  return value == null ? '' : String(value)
}

function SortIndicator(props: { direction?: 'asc' | 'desc' }) {
  if (!props.direction) {
    return null
  }

  return (
    <span aria-hidden="true">{props.direction === 'asc' ? ' ↑' : ' ↓'}</span>
  )
}

function SelectionCheckbox(props: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  disabled?: boolean
  ariaLabel: string
}) {
  const ref = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!ref.current) {
      return
    }

    ref.current.indeterminate = props.indeterminate ?? false
  }, [props.indeterminate])

  return (
    <input
      ref={ref}
      aria-label={props.ariaLabel}
      checked={props.checked}
      disabled={props.disabled}
      type="checkbox"
      onChange={props.onChange}
    />
  )
}

function getFilterOperator<TData>(column: GridResolvedColumn<TData>) {
  const filter = column.filter === false ? null : (column.filter ?? null)
  return filter?.operators?.length ? filter.operators[0] : 'contains'
}

function getColumnFilterValue<TData>(
  column: GridResolvedColumn<TData>,
  query: ReturnType<DataGridInstance<TData>['getQuery']>,
) {
  const filter = query.filters.find((entry) => entry.columnId === column.id)
  if (!filter) {
    return ''
  }

  const columnFilter = column.filter === false ? null : (column.filter ?? null)
  const formatter = columnFilter?.format
  if (formatter) {
    return formatter(filter.value)
  }

  return Array.isArray(filter.value)
    ? filter.value.join(',')
    : String(filter.value ?? '')
}

function isEditableColumn<TData>(column: GridResolvedColumn<TData>) {
  return Boolean(
    column.edit &&
    (typeof column.accessor === 'string' || column.edit.setValue),
  )
}

function formatEditableValue<TData>(
  column: GridResolvedColumn<TData>,
  row: TData,
  value: unknown,
) {
  if (column.edit?.format) {
    return column.edit.format(value, row)
  }

  return value == null ? '' : String(value)
}

function getNodeLabel<TData>(row: GridVisibleRow<TData>) {
  const node = row.node
  switch (node.kind) {
    case 'group':
      return `${node.groupColumnId}: ${String(node.groupKey)}`
    case 'aggregate':
      return node.placement === 'footer' ? 'Subtotal' : 'Aggregate'
    case 'placeholder':
      return node.placeholder === 'error' ? 'Failed to load' : 'Loading…'
    case 'tree':
    case 'leaf':
      return null
  }
}

function getAggregateDisplay<TData>(
  node: GridNode<TData>,
  columnId: string,
): string | null {
  if (!node.aggregates) {
    return null
  }

  const direct = node.aggregates[columnId]
  if (direct) {
    return String(direct.value ?? '')
  }

  const aggregate = Object.values(node.aggregates).find(
    (entry) => entry.columnId === columnId,
  )
  return aggregate ? String(aggregate.value ?? '') : null
}

function EditableCell<TData>(props: {
  column: GridResolvedColumn<TData>
  grid: DataGridInstance<TData>
  row: TData
  rowId: GridRowId
}) {
  const { column, grid, row, rowId } = props
  const draft = useGridCellDraft(grid, rowId, column.id)
  const editing = useGridEditing(grid)
  const editState = useGridSelector(
    grid,
    (controller) => {
      const state = controller.getState().editing
      const rowDraft = controller.getRowDraft(rowId)
      const pending = state.pending[String(rowId)] ?? null
      return {
        isActive:
          state.activeCell?.rowId === rowId &&
          state.activeCell?.columnId === column.id,
        phase: rowDraft?.phase ?? 'idle',
        isPending: pending?.columnId === column.id,
        error: draft?.error ?? null,
      }
    },
    (previous, next) =>
      previous.isActive === next.isActive &&
      previous.phase === next.phase &&
      previous.isPending === next.isPending &&
      previous.error === next.error,
  )

  const value = draft?.value ?? getColumnValue(row, column)
  const displayValue = formatEditableValue(column, row, value)

  if (!isEditableColumn(column)) {
    return <>{renderCellValue(row, rowId, column)}</>
  }

  if (editState.isActive) {
    return (
      <div>
        <input
          aria-label={`Edit ${column.id} for row ${rowId}`}
          autoFocus
          disabled={editState.isPending}
          value={displayValue}
          onBlur={() => {
            if (column.edit?.commitOnBlur === false) {
              return
            }

            void editing.commitCellEdit(rowId, column.id)
          }}
          onChange={(event) => {
            const nextValue = column.edit?.parse
              ? column.edit.parse(event.target.value, row)
              : event.target.value
            editing.updateCellDraft(rowId, column.id, nextValue)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void editing.commitCellEdit(rowId, column.id)
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              editing.cancelCellEdit(rowId, column.id)
            }
          }}
        />
        {editState.isPending ? <small>Saving…</small> : null}
        {editState.phase === 'conflict' ? <small>Conflict</small> : null}
        {editState.error ? <small role="alert">{editState.error}</small> : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => editing.startCellEdit(rowId, column.id)}
      onDoubleClick={() => editing.startCellEdit(rowId, column.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          editing.startCellEdit(rowId, column.id)
        }
      }}
    >
      {displayValue}
      {editState.isPending ? ' (saving)' : ''}
      {editState.phase === 'conflict' ? ' (conflict)' : ''}
      {editState.error ? ' (error)' : ''}
    </button>
  )
}

function DataGridToolbar<TData>({ grid }: { grid: DataGridInstance<TData> }) {
  const query = useGridQuery(grid)
  const columns = useGridColumns(grid)
  const filters = useGridFilters(grid)
  const selection = useGridSelection(grid)
  const live = useGridLiveStatus(grid)

  const filterableColumns = columns.allColumns.filter(
    (column) => column.filter !== false && column.filter !== undefined,
  )

  return (
    <div>
      <div>
        <label>
          <span>Search</span>
          <input
            value={query.globalFilter?.value ?? ''}
            onChange={(event) =>
              filters.setGlobalFilter(event.target.value || null)
            }
          />
        </label>
        <button type="button" onClick={() => filters.clearFilters()}>
          Clear filters
        </button>
        <button type="button" onClick={() => selection.selectAllMatching()}>
          Select all matching
        </button>
        <button type="button" onClick={() => selection.clearSelection()}>
          Clear selection
        </button>
        <span>Live: {live.live.status}</span>
        <span>
          Sync: {live.live.hasPendingInvalidation ? 'stale' : 'ready'}
        </span>
        <span>
          Selected:{' '}
          {selection.summary.selectedCount === null
            ? 'unknown'
            : selection.summary.selectedCount}
        </span>
        {selection.summary.scopeStatus === 'detached' ? (
          <span>Selection scope no longer matches the current filters.</span>
        ) : null}
      </div>

      {filterableColumns.length > 0 ? (
        <div>
          {filterableColumns.map((column) => (
            <label key={column.id}>
              <span>{column.header}</span>
              <input
                value={getColumnFilterValue(column, query)}
                onChange={(event) => {
                  const nextValue = event.target.value
                  const operator = getFilterOperator(column)
                  if (nextValue.length === 0) {
                    filters.removeColumnFilter(column.id)
                    return
                  }

                  const columnFilter =
                    column.filter === false ? null : (column.filter ?? null)
                  const parsedValue = columnFilter?.parse
                    ? columnFilter.parse(nextValue)
                    : nextValue

                  filters.upsertColumnFilter(column.id, operator, parsedValue)
                }}
              />
            </label>
          ))}
        </div>
      ) : null}

      <details>
        <summary>Columns</summary>
        <div>
          {columns.allColumns.map((column, index) => (
            <div key={column.id}>
              <label>
                <input
                  checked={column.isVisible}
                  disabled={!column.canHide}
                  type="checkbox"
                  onChange={() => columns.toggleColumnVisibility(column.id)}
                />
                <span>{column.header}</span>
              </label>
              <button
                disabled={!column.canReorder || index === 0}
                type="button"
                onClick={() => columns.moveColumn(column.id, index - 1)}
              >
                Up
              </button>
              <button
                disabled={
                  !column.canReorder || index === columns.allColumns.length - 1
                }
                type="button"
                onClick={() => columns.moveColumn(column.id, index + 1)}
              >
                Down
              </button>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

export function DataGridHeader<TData>({
  grid,
}: {
  grid: DataGridInstance<TData>
}) {
  const query = useGridQuery(grid)
  const { summary, deselectRows, selectVisibleRows } = useGridSelection(grid)
  const { visibleColumns } = useGridColumns(grid)
  const visibleRowIds = useGridRows(grid)
    .map((row) => row.rowId)
    .filter((rowId): rowId is string | number => rowId !== null)
  const activeSorts = useMemo(
    () =>
      new Map(
        query.sort.map((entry) => [entry.columnId, entry.direction] as const),
      ),
    [query.sort],
  )

  return (
    <thead>
      <tr>
        <th scope="col">
          <SelectionCheckbox
            ariaLabel="Select visible rows"
            checked={summary.isAllVisibleSelected}
            indeterminate={summary.isSomeVisibleSelected}
            onChange={() => {
              if (
                summary.isAllVisibleSelected ||
                summary.isSomeVisibleSelected
              ) {
                deselectRows(visibleRowIds)
                return
              }

              selectVisibleRows()
            }}
          />
        </th>
        {visibleColumns.map((column) => {
          const direction = activeSorts.get(column.id)
          return (
            <th key={column.id} scope="col">
              {column.sortable ? (
                <button
                  type="button"
                  onClick={(event) =>
                    grid.toggleSort(column.id, {
                      multi: event.shiftKey,
                    })
                  }
                >
                  {column.header}
                  <SortIndicator direction={direction} />
                </button>
              ) : (
                column.header
              )}
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

export function DataGridBody<TData>({
  emptyMessage = 'No rows',
  grid,
  loadingMessage = 'Loading…',
}: Omit<DataGridTableProps<TData>, 'height'>) {
  const rows = useGridRows(grid)
  const hierarchy = useGridHierarchy(grid)
  const state = useGridState(grid)
  const { visibleColumns } = useGridColumns(grid)

  if (state.data.visibleRowCount === 0 && state.request.status !== 'loading') {
    return (
      <tbody>
        <tr>
          <td colSpan={visibleColumns.length + 1}>{emptyMessage}</td>
        </tr>
      </tbody>
    )
  }

  return (
    <tbody>
      {rows.map((visibleRow) => {
        const row = visibleRow.row
        const rowId = visibleRow.rowId
        const nodeLabel = getNodeLabel(visibleRow)
        const canExpand = visibleRow.isExpandable
        const isSelectable = rowId !== null

        if (visibleRow.node.kind === 'placeholder') {
          return (
            <tr key={`placeholder-${visibleRow.nodeId}`}>
              <td colSpan={visibleColumns.length + 1}>{loadingMessage}</td>
            </tr>
          )
        }

        return (
          <tr key={visibleRow.nodeId}>
            <td>
              {isSelectable ? (
                <SelectionCheckbox
                  ariaLabel={`Select row ${rowId}`}
                  checked={grid.isRowSelected(rowId)}
                  onChange={() => grid.toggleRowSelection(rowId)}
                />
              ) : null}
            </td>
            {visibleColumns.map((column, columnIndex) => {
              const aggregateDisplay = getAggregateDisplay(
                visibleRow.node,
                column.id,
              )
              const paddingLeft = visibleRow.depth * 16
              if (row !== null && rowId !== null) {
                return (
                  <td key={column.id}>
                    <div
                      style={{
                        paddingLeft: columnIndex === 0 ? paddingLeft : 0,
                      }}
                    >
                      {columnIndex === 0 && canExpand ? (
                        <button
                          type="button"
                          onClick={() =>
                            hierarchy.toggleNode(visibleRow.nodeId)
                          }
                        >
                          {hierarchy.isNodeExpanded(visibleRow.nodeId)
                            ? '▾'
                            : '▸'}
                        </button>
                      ) : null}
                      <EditableCell
                        column={column as GridResolvedColumn<TData>}
                        grid={grid}
                        row={row as TData}
                        rowId={rowId}
                      />
                    </div>
                  </td>
                )
              }

              return (
                <td key={column.id}>
                  <div
                    style={{ paddingLeft: columnIndex === 0 ? paddingLeft : 0 }}
                  >
                    {columnIndex === 0 && canExpand ? (
                      <button
                        type="button"
                        onClick={() => hierarchy.toggleNode(visibleRow.nodeId)}
                      >
                        {hierarchy.isNodeExpanded(visibleRow.nodeId)
                          ? '▾'
                          : '▸'}
                      </button>
                    ) : null}
                    {columnIndex === 0 ? nodeLabel : (aggregateDisplay ?? '')}
                  </div>
                </td>
              )
            })}
          </tr>
        )
      })}
    </tbody>
  )
}

export function DataGridVirtualBody<TData>({
  emptyMessage = 'No rows',
  grid,
  height = 480,
  loadingMessage = 'Loading…',
}: DataGridTableProps<TData>) {
  const virtualRows = useGridVirtualRows(grid)
  const hierarchy = useGridHierarchy(grid)
  const { visibleColumns } = useGridColumns(grid)
  const status = useGridSelector(
    grid,
    (controller) => controller.getState().request.status,
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rowMap = useMemo(
    () => new Map(virtualRows.rows.map((row) => [row.index, row] as const)),
    [virtualRows.rows],
  )
  const rowCount =
    virtualRows.rowCount ?? Math.max(1, virtualRows.viewport.end + 1)

  const virtualizer = useVirtualizer({
    count: rowCount,
    estimateSize: () => virtualRows.rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan: virtualRows.overscan,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (virtualItems.length === 0) {
      return
    }

    const first = virtualItems[0]
    const last = virtualItems[virtualItems.length - 1]
    grid.setViewport({
      start: first.index,
      end: last.index + 1,
    })
  }, [grid, virtualItems])

  if ((virtualRows.rowCount ?? 0) === 0 && status !== 'loading') {
    return (
      <div ref={scrollRef} style={{ height, overflow: 'auto' }}>
        <table>
          <tbody>
            <tr>
              <td colSpan={visibleColumns.length + 1}>{emptyMessage}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? Math.max(
          0,
          virtualizer.getTotalSize() -
            virtualItems[virtualItems.length - 1].end,
        )
      : 0

  return (
    <div ref={scrollRef} style={{ height, overflow: 'auto' }}>
      <table>
        <tbody>
          {paddingTop > 0 ? (
            <tr aria-hidden="true">
              <td
                colSpan={visibleColumns.length + 1}
                style={{ height: paddingTop, padding: 0 }}
              />
            </tr>
          ) : null}
          {virtualItems.map((item) => {
            const visibleRow = rowMap.get(item.index)
            const row = visibleRow?.row ?? null
            const rowId = visibleRow?.rowId ?? null
            const nodeLabel = visibleRow ? getNodeLabel(visibleRow) : null

            if (!visibleRow || visibleRow.node.kind === 'placeholder') {
              return (
                <tr
                  key={`virtual-placeholder-${item.index}`}
                  style={{ height: item.size }}
                >
                  <td colSpan={visibleColumns.length + 1}>{loadingMessage}</td>
                </tr>
              )
            }

            return (
              <tr key={visibleRow.nodeId} style={{ height: item.size }}>
                <td>
                  {rowId !== null ? (
                    <SelectionCheckbox
                      ariaLabel={`Select row ${rowId}`}
                      checked={grid.isRowSelected(rowId)}
                      onChange={() => grid.toggleRowSelection(rowId)}
                    />
                  ) : null}
                </td>
                {visibleColumns.map((column, columnIndex) => {
                  const aggregateDisplay = getAggregateDisplay(
                    visibleRow.node,
                    column.id,
                  )
                  const paddingLeft = visibleRow.depth * 16
                  if (row !== null && rowId !== null) {
                    return (
                      <td key={column.id}>
                        <div
                          style={{
                            paddingLeft: columnIndex === 0 ? paddingLeft : 0,
                          }}
                        >
                          {columnIndex === 0 && visibleRow.isExpandable ? (
                            <button
                              type="button"
                              onClick={() =>
                                hierarchy.toggleNode(visibleRow.nodeId)
                              }
                            >
                              {hierarchy.isNodeExpanded(visibleRow.nodeId)
                                ? '▾'
                                : '▸'}
                            </button>
                          ) : null}
                          <EditableCell
                            column={column as GridResolvedColumn<TData>}
                            grid={grid}
                            row={row as TData}
                            rowId={rowId}
                          />
                        </div>
                      </td>
                    )
                  }

                  return (
                    <td key={column.id}>
                      <div
                        style={{
                          paddingLeft: columnIndex === 0 ? paddingLeft : 0,
                        }}
                      >
                        {columnIndex === 0 && visibleRow.isExpandable ? (
                          <button
                            type="button"
                            onClick={() =>
                              hierarchy.toggleNode(visibleRow.nodeId)
                            }
                          >
                            {hierarchy.isNodeExpanded(visibleRow.nodeId)
                              ? '▾'
                              : '▸'}
                          </button>
                        ) : null}
                        {columnIndex === 0
                          ? nodeLabel
                          : (aggregateDisplay ?? '')}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {paddingBottom > 0 ? (
            <tr aria-hidden="true">
              <td
                colSpan={visibleColumns.length + 1}
                style={{ height: paddingBottom, padding: 0 }}
              />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

export function DataGridTable<TData>({
  emptyMessage,
  grid,
  height,
  loadingMessage,
}: DataGridTableProps<TData>) {
  const state = useGridState(grid)
  const query = useGridQuery(grid)

  return (
    <section>
      {state.request.error ? (
        <p role="alert">{String(state.request.error)}</p>
      ) : null}
      <DataGridToolbar grid={grid} />
      <table>
        <DataGridHeader grid={grid} />
      </table>
      {state.virtualization.enabled ? (
        <DataGridVirtualBody
          emptyMessage={emptyMessage}
          grid={grid}
          height={height}
          loadingMessage={loadingMessage}
        />
      ) : (
        <table>
          <DataGridBody
            emptyMessage={emptyMessage}
            grid={grid}
            loadingMessage={loadingMessage}
          />
        </table>
      )}
      {!state.virtualization.enabled && query.slice.kind === 'offset' ? (
        <nav aria-label="Pagination">
          <button
            type="button"
            disabled={query.slice.offset === 0}
            onClick={() => grid.prevPage()}
          >
            Previous
          </button>
          <span>
            {query.slice.offset + 1}
            {' - '}
            {Math.min(
              query.slice.offset + query.slice.limit,
              state.data.rowCount ?? query.slice.offset + query.slice.limit,
            )}
          </span>
          <button
            type="button"
            disabled={
              state.data.hasNextPage === false ||
              (state.data.rowCount !== null &&
                query.slice.offset + query.slice.limit >= state.data.rowCount)
            }
            onClick={() => grid.nextPage()}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  )
}

export function DataGrid<TData>({
  emptyMessage,
  height,
  loadingMessage,
  ...options
}: DataGridProps<TData>) {
  const grid = useDataGrid(options)
  return (
    <DataGridTable
      emptyMessage={emptyMessage}
      grid={grid}
      height={height}
      loadingMessage={loadingMessage}
    />
  )
}

export type { DataGridProps, DataGridTableProps }
