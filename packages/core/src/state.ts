import type {
  GridColumnsState,
  GridQuery,
  GridRowId,
  GridSelectionRequest,
  GridSelectionScopeStatus,
  GridSelectionState,
} from './types'

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (value.length === 0 || seen.has(value)) {
      continue
    }

    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function uniqueRowIds(values: readonly GridRowId[]): GridRowId[] {
  const seen = new Set<GridRowId>()
  const normalized: GridRowId[] = []

  for (const value of values) {
    if (seen.has(value)) {
      continue
    }

    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

export function createEmptyColumnsState(): GridColumnsState {
  return {
    visibility: {},
    order: [],
  }
}

export function normalizeColumnsState(
  columns: GridColumnsState,
): GridColumnsState {
  const visibility = Object.fromEntries(
    Object.entries(columns.visibility).filter(
      (entry): entry is [string, boolean] => entry[0].length > 0,
    ),
  )

  return {
    visibility,
    order: uniqueStrings(columns.order),
  }
}

export function createEmptySelectionState(): GridSelectionState {
  return {
    mode: 'include',
    includedIds: [],
    excludedIds: [],
    scope: null,
  }
}

export function normalizeSelectionState(
  selection: GridSelectionState,
): GridSelectionState {
  return {
    mode: selection.mode,
    includedIds: uniqueRowIds(selection.includedIds),
    excludedIds: uniqueRowIds(selection.excludedIds),
    scope:
      selection.mode === 'all-matching' && selection.scope !== null
        ? {
            matchKey: selection.scope.matchKey,
            query: {
              filters: selection.scope.query.filters,
              globalFilter: selection.scope.query.globalFilter ?? null,
            },
            capturedRowCount: selection.scope.capturedRowCount ?? null,
          }
        : null,
  }
}

export function getSelectionScopeStatus(
  selection: GridSelectionState,
  currentMatchKey: string,
): GridSelectionScopeStatus {
  if (selection.mode !== 'all-matching' || selection.scope === null) {
    return 'none'
  }

  return selection.scope.matchKey === currentMatchKey ? 'current' : 'detached'
}

export function isRowSelected(
  selection: GridSelectionState,
  rowId: GridRowId,
  currentMatchKey: string,
): boolean {
  if (selection.includedIds.includes(rowId)) {
    return true
  }

  if (selection.mode !== 'all-matching') {
    return false
  }

  if (getSelectionScopeStatus(selection, currentMatchKey) !== 'current') {
    return false
  }

  return !selection.excludedIds.includes(rowId)
}

export function createSelectionRequest(
  selection: GridSelectionState,
): GridSelectionRequest {
  if (selection.mode === 'include' || selection.scope === null) {
    return {
      kind: 'ids',
      ids: selection.includedIds,
    }
  }

  return {
    kind: 'all-matching',
    query: selection.scope.query,
    includedIds: selection.includedIds,
    excludedIds: selection.excludedIds,
  }
}

export function createAllMatchingSelection(
  query: Pick<GridQuery, 'filters' | 'globalFilter'>,
  matchKey: string,
  capturedRowCount: number | null,
  includedIds: readonly GridRowId[],
): GridSelectionState {
  return normalizeSelectionState({
    mode: 'all-matching',
    includedIds,
    excludedIds: [],
    scope: {
      matchKey,
      query: {
        filters: query.filters,
        globalFilter: query.globalFilter ?? null,
      },
      capturedRowCount,
    },
  })
}
