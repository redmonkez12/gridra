import type {
  GridAggregateRequest,
  GridColumnFilter,
  GridFilterValue,
  GridGlobalFilter,
  GridGroupingDescriptor,
  GridHierarchyQuery,
  GridQuery,
  GridScalar,
  GridSort,
  GridWindow,
} from './types'

export const DEFAULT_PAGE_SIZE = 50
export const DEFAULT_ROW_HEIGHT = 36
export const DEFAULT_OVERSCAN = 8
export const DEFAULT_VIEWPORT_DEBOUNCE_MS = 32

function isGridScalar(value: unknown): value is GridScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function normalizeFilterValue(value: unknown): GridFilterValue | null {
  if (Array.isArray(value)) {
    const normalized = value.filter(isGridScalar)
    return normalized
  }

  return isGridScalar(value) ? value : null
}

function normalizeGrouping(
  groupBy: readonly GridGroupingDescriptor[],
): GridGroupingDescriptor[] {
  return groupBy
    .filter((entry) => entry.columnId.length > 0)
    .map((entry) => ({
      columnId: entry.columnId,
      direction: entry.direction ?? 'asc',
    }))
}

function normalizeAggregates(
  aggregates: readonly GridAggregateRequest[] | undefined,
): GridAggregateRequest[] {
  if (!aggregates) {
    return []
  }

  return aggregates
    .filter((entry) => entry.columnId.length > 0 && entry.fn.length > 0)
    .map((entry) => ({
      columnId: entry.columnId,
      fn: entry.fn,
      alias: entry.alias ?? `${entry.columnId}:${entry.fn}`,
    }))
}

export function normalizeHierarchy(
  hierarchy: GridHierarchyQuery | null | undefined,
): GridHierarchyQuery {
  if (!hierarchy || hierarchy.mode === 'flat') {
    return { mode: 'flat' }
  }

  if (hierarchy.mode === 'group') {
    const groupBy = normalizeGrouping(hierarchy.groupBy)
    return {
      mode: 'group',
      groupBy,
      aggregates: normalizeAggregates(hierarchy.aggregates),
    }
  }

  return {
    mode: 'tree',
    aggregates: normalizeAggregates(hierarchy.aggregates),
  }
}

export function createDefaultQuery(limit = DEFAULT_PAGE_SIZE): GridQuery {
  return {
    slice: {
      kind: 'offset',
      offset: 0,
      limit,
    },
    sort: [],
    filters: [],
    globalFilter: null,
    hierarchy: null,
  }
}

export function normalizeSort(sort: readonly GridSort[]): GridSort[] {
  return sort.filter((entry) => entry.columnId.length > 0)
}

export function normalizeFilters(
  filters: readonly GridColumnFilter[],
): GridColumnFilter[] {
  return filters
    .map<GridColumnFilter | null>((entry) => {
      const value = normalizeFilterValue(entry.value)
      if (
        entry.columnId.length === 0 ||
        entry.operator.length === 0 ||
        value === null
      ) {
        return null
      }

      return {
        columnId: entry.columnId,
        operator: entry.operator,
        value,
      }
    })
    .filter((entry): entry is GridColumnFilter => entry !== null)
}

export function normalizeGlobalFilter(
  globalFilter: GridGlobalFilter | null | undefined,
): GridGlobalFilter | null {
  if (!globalFilter) {
    return null
  }

  const value = globalFilter.value.trim()
  if (value.length === 0) {
    return null
  }

  return {
    value,
    operator:
      globalFilter.operator && globalFilter.operator.length > 0
        ? globalFilter.operator
        : 'search',
  }
}

export function normalizeQuery(query: GridQuery): GridQuery {
  const hierarchy = query.hierarchy ? normalizeHierarchy(query.hierarchy) : null

  if (query.slice.kind === 'offset') {
    return {
      slice: {
        kind: 'offset',
        offset: Math.max(0, Math.floor(query.slice.offset)),
        limit: Math.max(1, Math.floor(query.slice.limit)),
      },
      sort: normalizeSort(query.sort),
      filters: normalizeFilters(query.filters),
      globalFilter: normalizeGlobalFilter(query.globalFilter),
      hierarchy,
    }
  }

  return {
    slice: {
      kind: 'cursor',
      cursor: query.slice.cursor,
      limit: Math.max(1, Math.floor(query.slice.limit)),
      direction: query.slice.direction,
    },
    sort: normalizeSort(query.sort),
    filters: normalizeFilters(query.filters),
    globalFilter: normalizeGlobalFilter(query.globalFilter),
    hierarchy,
  }
}

export function resetOffset(query: GridQuery): GridQuery {
  if (query.slice.kind !== 'offset') {
    return query
  }

  if (query.slice.offset === 0) {
    return query
  }

  return {
    ...query,
    slice: {
      ...query.slice,
      offset: 0,
    },
  }
}

export function areQueriesEqual(a: GridQuery, b: GridQuery): boolean {
  return JSON.stringify(normalizeQuery(a)) === JSON.stringify(normalizeQuery(b))
}

export function getMatchKey(query: GridQuery): string {
  return JSON.stringify({
    filters: normalizeFilters(query.filters),
    globalFilter: normalizeGlobalFilter(query.globalFilter),
  })
}

export function getViewKey(query: GridQuery): string {
  return JSON.stringify({
    sliceKind: query.slice.kind,
    sort: normalizeSort(query.sort),
    filters: normalizeFilters(query.filters),
    globalFilter: normalizeGlobalFilter(query.globalFilter),
    hierarchy: normalizeHierarchy(query.hierarchy),
  })
}

export const getDatasetKey = getViewKey

export function getPageWindow(query: GridQuery): GridWindow {
  if (query.slice.kind !== 'offset') {
    return {
      start: 0,
      end: query.slice.limit,
    }
  }

  return {
    start: query.slice.offset,
    end: query.slice.offset + query.slice.limit,
  }
}
