import type {
  GridPlaceholderNode,
  GridRowId,
  GridRowRevision,
  GridRowStore,
  GridStoredRow,
  GridVisibleRow,
  GridWindow,
} from './types'

export function createEmptyRowStore<TData>(): GridRowStore<TData> {
  return {
    rowsByIndex: new Map<number, GridStoredRow<TData>>(),
    indexByRowId: new Map<GridRowId, number>(),
    revisionsByRowId: new Map<GridRowId, GridRowRevision>(),
    loadedWindows: [],
    staleWindows: [],
  }
}

export function normalizeWindow(window: GridWindow): GridWindow {
  return {
    start: Math.max(0, Math.floor(window.start)),
    end: Math.max(Math.floor(window.start), Math.floor(window.end)),
  }
}

export function mergeWindows(windows: readonly GridWindow[]): GridWindow[] {
  if (windows.length === 0) {
    return []
  }

  const sorted = [...windows]
    .map(normalizeWindow)
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start)

  if (sorted.length === 0) {
    return []
  }

  const merged: GridWindow[] = [sorted[0]]
  for (const current of sorted.slice(1)) {
    const previous = merged[merged.length - 1]
    if (current.start <= previous.end) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, current.end),
      }
      continue
    }

    merged.push(current)
  }

  return merged
}

export function subtractWindows(
  requested: GridWindow,
  covered: readonly GridWindow[],
): GridWindow[] {
  const window = normalizeWindow(requested)
  if (window.end <= window.start) {
    return []
  }

  const mergedCovered = mergeWindows(covered)
  const missing: GridWindow[] = []
  let cursor = window.start

  for (const interval of mergedCovered) {
    if (interval.end <= cursor) {
      continue
    }

    if (interval.start >= window.end) {
      break
    }

    if (interval.start > cursor) {
      missing.push({ start: cursor, end: Math.min(interval.start, window.end) })
    }

    cursor = Math.max(cursor, interval.end)
    if (cursor >= window.end) {
      break
    }
  }

  if (cursor < window.end) {
    missing.push({ start: cursor, end: window.end })
  }

  return missing.filter((entry) => entry.end > entry.start)
}

function removeCoveredWindows(
  windows: readonly GridWindow[],
  covered: readonly GridWindow[],
): GridWindow[] {
  return windows.flatMap((window) => subtractWindows(window, covered))
}

function clearStoredIndex<TData>(
  rowsByIndex: Map<number, GridStoredRow<TData>>,
  indexByRowId: Map<GridRowId, number>,
  revisionsByRowId: Map<GridRowId, GridRowRevision>,
  index: number,
) {
  const previous = rowsByIndex.get(index)
  if (!previous) {
    return
  }

  rowsByIndex.delete(index)
  if (indexByRowId.get(previous.rowId) === index) {
    indexByRowId.delete(previous.rowId)
  }
  revisionsByRowId.delete(previous.rowId)
}

export function getMissingWindows(
  requested: GridWindow,
  loaded: readonly GridWindow[],
  pending: readonly GridWindow[],
  stale: readonly GridWindow[] = [],
): GridWindow[] {
  const effectiveLoaded = removeCoveredWindows(loaded, stale)
  return subtractWindows(requested, [...effectiveLoaded, ...pending])
}

export function insertWindowRows<TData>(
  store: GridRowStore<TData>,
  window: GridWindow,
  rows: readonly TData[],
  getRowId: (row: TData) => GridRowId,
  getRowRevision?: (row: TData) => GridRowRevision | undefined,
): GridRowStore<TData> {
  const nextRows = new Map(store.rowsByIndex)
  const nextIndexByRowId = new Map(store.indexByRowId)
  const nextRevisionsByRowId = new Map(store.revisionsByRowId)
  const normalizedWindow = normalizeWindow(window)
  const loadedWindow = {
    start: normalizedWindow.start,
    end: normalizedWindow.start + rows.length,
  }

  for (
    let index = normalizedWindow.start;
    index < normalizedWindow.end;
    index += 1
  ) {
    clearStoredIndex(nextRows, nextIndexByRowId, nextRevisionsByRowId, index)
  }

  rows.forEach((row, index) => {
    const rowId = getRowId(row)
    const targetIndex = normalizedWindow.start + index
    const previousIndex = nextIndexByRowId.get(rowId)
    if (previousIndex !== undefined && previousIndex !== targetIndex) {
      clearStoredIndex(
        nextRows,
        nextIndexByRowId,
        nextRevisionsByRowId,
        previousIndex,
      )
    }

    const revision = getRowRevision?.(row)
    nextRows.set(targetIndex, {
      row,
      rowId,
      revision,
    })
    nextIndexByRowId.set(rowId, targetIndex)
    if (revision !== undefined) {
      nextRevisionsByRowId.set(rowId, revision)
    } else {
      nextRevisionsByRowId.delete(rowId)
    }
  })

  return {
    rowsByIndex: nextRows,
    indexByRowId: nextIndexByRowId,
    revisionsByRowId: nextRevisionsByRowId,
    loadedWindows: mergeWindows([
      ...store.loadedWindows,
      { start: loadedWindow.start, end: loadedWindow.end },
    ]),
    staleWindows: removeCoveredWindows(store.staleWindows, [loadedWindow]),
  }
}

export function updateStoredRow<TData>(
  store: GridRowStore<TData>,
  rowId: GridRowId,
  row: TData,
  revision?: GridRowRevision,
): GridRowStore<TData> {
  const index = store.indexByRowId.get(rowId)
  if (index === undefined) {
    return store
  }

  const nextRows = new Map(store.rowsByIndex)
  const nextRevisionsByRowId = new Map(store.revisionsByRowId)
  nextRows.set(index, {
    row,
    rowId,
    revision,
  })

  if (revision !== undefined) {
    nextRevisionsByRowId.set(rowId, revision)
  } else {
    nextRevisionsByRowId.delete(rowId)
  }

  return {
    ...store,
    rowsByIndex: nextRows,
    revisionsByRowId: nextRevisionsByRowId,
  }
}

export function removeStoredRow<TData>(
  store: GridRowStore<TData>,
  rowId: GridRowId,
): GridRowStore<TData> {
  const index = store.indexByRowId.get(rowId)
  if (index === undefined) {
    return store
  }

  const nextRows = new Map(store.rowsByIndex)
  const nextIndexByRowId = new Map(store.indexByRowId)
  const nextRevisionsByRowId = new Map(store.revisionsByRowId)
  clearStoredIndex(nextRows, nextIndexByRowId, nextRevisionsByRowId, index)

  return {
    ...store,
    rowsByIndex: nextRows,
    indexByRowId: nextIndexByRowId,
    revisionsByRowId: nextRevisionsByRowId,
  }
}

export function getStoredRowById<TData>(
  store: GridRowStore<TData>,
  rowId: GridRowId,
): GridStoredRow<TData> | null {
  const index = store.indexByRowId.get(rowId)
  return index === undefined ? null : (store.rowsByIndex.get(index) ?? null)
}

export function markRowStoreStale<TData>(
  store: GridRowStore<TData>,
  windows: readonly GridWindow[],
): GridRowStore<TData> {
  return {
    ...store,
    staleWindows: mergeWindows([...store.staleWindows, ...windows]),
  }
}

export function clearRowStore<TData>(): GridRowStore<TData> {
  return createEmptyRowStore<TData>()
}

export function hasAnyRows<TData>(store: GridRowStore<TData>): boolean {
  return store.rowsByIndex.size > 0
}

export function readVisibleRows<TData>(
  store: GridRowStore<TData>,
  window: GridWindow,
  rowCount: number | null,
): GridVisibleRow<TData>[] {
  const normalized = normalizeWindow(window)
  const end =
    rowCount === null ? normalized.end : Math.min(normalized.end, rowCount)
  const visibleRows: GridVisibleRow<TData>[] = []

  for (let index = normalized.start; index < end; index += 1) {
    const row = store.rowsByIndex.get(index)
    const placeholderNode: GridPlaceholderNode = {
      kind: 'placeholder',
      nodeId: `legacy-placeholder:${index}`,
      parentNodeId: null,
      depth: 0,
      isExpanded: false,
      isExpandable: false,
      childCount: null,
      ownerNodeId: null,
      childIndex: index,
      placeholder: 'loading',
    }
    const node =
      row === undefined
        ? placeholderNode
        : {
            kind: 'leaf' as const,
            nodeId: `legacy-row:${String(row.rowId)}`,
            parentNodeId: null,
            depth: 0,
            isExpanded: false,
            isExpandable: false,
            childCount: null,
            rowId: row.rowId,
            row: row.row,
            revision: row.revision,
          }
    visibleRows.push({
      index,
      isLoaded: row !== undefined,
      row: row?.row ?? null,
      canonicalRow: row?.row ?? null,
      rowId: row?.rowId ?? null,
      nodeId: node.nodeId,
      node,
      kind: node.kind,
      depth: node.depth,
      isExpandable: node.isExpandable,
      isExpanded: node.isExpanded,
    })
  }

  return visibleRows
}
