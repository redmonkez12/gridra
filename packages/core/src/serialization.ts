import { createEmptyColumnsState, normalizeColumnsState } from './state'
import {
  createDefaultQuery,
  normalizeGlobalFilter,
  normalizeHierarchy,
  normalizeQuery,
} from './query'
import type {
  GridAggregateRequest,
  GridColumnsState,
  GridColumnFilter,
  GridCursorSlice,
  GridGlobalFilter,
  GridGroupingDescriptor,
  GridHierarchyQuery,
  GridQuery,
  GridSort,
} from './types'

const SORT_SEPARATOR = ','
const PART_SEPARATOR = ':'

function encodeList(values: readonly string[]): string {
  return values.map((value) => encodeURIComponent(value)).join(SORT_SEPARATOR)
}

function decodeList(raw: string | null): string[] {
  if (!raw) {
    return []
  }

  return raw
    .split(SORT_SEPARATOR)
    .map((value) => decodeURIComponent(value))
    .filter((value) => value.length > 0)
}

function encodeSort(sort: readonly GridSort[]): string {
  return sort
    .map(
      (entry) =>
        `${encodeURIComponent(entry.columnId)}${PART_SEPARATOR}${entry.direction}`,
    )
    .join(SORT_SEPARATOR)
}

function decodeSort(raw: string | null): GridSort[] {
  if (!raw) {
    return []
  }

  return raw
    .split(SORT_SEPARATOR)
    .map((part) => part.split(PART_SEPARATOR))
    .filter(
      (entry): entry is [string, 'asc' | 'desc'] =>
        entry.length === 2 && (entry[1] === 'asc' || entry[1] === 'desc'),
    )
    .map(([columnId, direction]) => ({
      columnId: decodeURIComponent(columnId),
      direction,
    }))
}

function encodeFilter(filter: GridColumnFilter): string {
  return [
    encodeURIComponent(filter.columnId),
    encodeURIComponent(filter.operator),
    encodeURIComponent(JSON.stringify(filter.value)),
  ].join(PART_SEPARATOR)
}

function decodeFilters(raw: string[]): GridColumnFilter[] {
  return raw
    .map((value) => value.split(PART_SEPARATOR))
    .filter((entry) => entry.length === 3)
    .map(([columnId, operator, encodedValue]) => {
      try {
        return {
          columnId: decodeURIComponent(columnId),
          operator: decodeURIComponent(
            operator,
          ) as GridColumnFilter['operator'],
          value: JSON.parse(decodeURIComponent(encodedValue)),
        }
      } catch {
        return null
      }
    })
    .filter((value): value is GridColumnFilter => value !== null)
}

function encodeGlobalFilter(globalFilter: GridGlobalFilter): string {
  return encodeURIComponent(JSON.stringify(globalFilter))
}

function decodeGlobalFilter(raw: string | null): GridGlobalFilter | null {
  if (!raw) {
    return null
  }

  try {
    return normalizeGlobalFilter(
      JSON.parse(decodeURIComponent(raw)) as GridGlobalFilter,
    )
  } catch {
    return null
  }
}

function encodeGroupBy(groupBy: readonly GridGroupingDescriptor[]): string {
  return groupBy
    .map(
      (entry) =>
        `${encodeURIComponent(entry.columnId)}${PART_SEPARATOR}${entry.direction ?? 'asc'}`,
    )
    .join(SORT_SEPARATOR)
}

function decodeGroupBy(raw: string | null): GridGroupingDescriptor[] {
  if (!raw) {
    return []
  }

  return raw
    .split(SORT_SEPARATOR)
    .map((part) => part.split(PART_SEPARATOR))
    .filter(
      (entry): entry is [string, 'asc' | 'desc'] =>
        entry.length === 2 && (entry[1] === 'asc' || entry[1] === 'desc'),
    )
    .map(([columnId, direction]) => ({
      columnId: decodeURIComponent(columnId),
      direction,
    }))
}

function encodeAggregates(aggregates: readonly GridAggregateRequest[]): string {
  return aggregates
    .map((entry) =>
      [
        encodeURIComponent(entry.columnId),
        encodeURIComponent(entry.fn),
        encodeURIComponent(entry.alias ?? ''),
      ].join(PART_SEPARATOR),
    )
    .join(SORT_SEPARATOR)
}

function decodeAggregates(raw: string | null): GridAggregateRequest[] {
  if (!raw) {
    return []
  }

  return raw
    .split(SORT_SEPARATOR)
    .map((value) => value.split(PART_SEPARATOR))
    .filter((entry) => entry.length >= 2)
    .map(([columnId, fn, alias]) => ({
      columnId: decodeURIComponent(columnId),
      fn: decodeURIComponent(fn),
      alias: alias ? decodeURIComponent(alias) : undefined,
    }))
}

function encodeHierarchy(hierarchy: GridHierarchyQuery) {
  const normalized = normalizeHierarchy(hierarchy)
  return {
    mode: normalized.mode,
    groupBy:
      normalized.mode === 'group' && normalized.groupBy.length > 0
        ? encodeGroupBy(normalized.groupBy)
        : null,
    aggregates:
      normalized.mode !== 'flat' && (normalized.aggregates?.length ?? 0) > 0
        ? encodeAggregates(normalized.aggregates ?? [])
        : null,
  }
}

function decodeHierarchy(params: URLSearchParams): GridHierarchyQuery | null {
  const mode = params.get('hierarchyMode')
  if (mode === 'group') {
    return normalizeHierarchy({
      mode: 'group',
      groupBy: decodeGroupBy(params.get('groupBy')),
      aggregates: decodeAggregates(params.get('aggregate')),
    })
  }

  if (mode === 'tree') {
    return normalizeHierarchy({
      mode: 'tree',
      aggregates: decodeAggregates(params.get('aggregate')),
    })
  }

  return null
}

export function serializeQuery(query: GridQuery): string {
  const normalized = normalizeQuery(query)
  const params = new URLSearchParams()

  params.set('sliceKind', normalized.slice.kind)
  params.set('limit', String(normalized.slice.limit))

  if (normalized.slice.kind === 'offset') {
    params.set('offset', String(normalized.slice.offset))
  } else {
    if (normalized.slice.cursor) {
      params.set('cursor', normalized.slice.cursor)
    }

    params.set('direction', normalized.slice.direction)
  }

  if (normalized.sort.length > 0) {
    params.set('sort', encodeSort(normalized.sort))
  }

  for (const filter of normalized.filters) {
    params.append('filter', encodeFilter(filter))
  }

  if (normalized.globalFilter) {
    params.set('search', encodeGlobalFilter(normalized.globalFilter))
  }

  const hierarchy = encodeHierarchy(normalized.hierarchy ?? { mode: 'flat' })
  if (hierarchy.mode !== 'flat') {
    params.set('hierarchyMode', hierarchy.mode)
  }
  if (hierarchy.groupBy) {
    params.set('groupBy', hierarchy.groupBy)
  }
  if (hierarchy.aggregates) {
    params.set('aggregate', hierarchy.aggregates)
  }

  return params.toString()
}

export function parseQuery(
  input: URLSearchParams | string,
  fallback: GridQuery = createDefaultQuery(),
): GridQuery {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const base = normalizeQuery(fallback)
  const limit = Number(params.get('limit') ?? base.slice.limit)
  const sliceKind = params.get('sliceKind') ?? base.slice.kind

  let slice: GridQuery['slice'] = base.slice
  if (sliceKind === 'cursor') {
    slice = {
      kind: 'cursor',
      limit: Number.isFinite(limit) ? limit : base.slice.limit,
      cursor: params.get('cursor') ?? undefined,
      direction:
        (params.get('direction') as GridCursorSlice['direction']) ?? 'forward',
    }
  } else {
    slice = {
      kind: 'offset',
      limit: Number.isFinite(limit) ? limit : base.slice.limit,
      offset: Number(
        params.get('offset') ??
          ('offset' in base.slice ? base.slice.offset : 0),
      ),
    }
  }

  const normalized = normalizeQuery({
    slice,
    sort: decodeSort(params.get('sort')),
    filters: decodeFilters(params.getAll('filter')),
    globalFilter: decodeGlobalFilter(params.get('search')),
    hierarchy: decodeHierarchy(params),
  })

  if (normalized.hierarchy === null) {
    const query = { ...normalized }
    delete query.hierarchy
    return query
  }

  return normalized
}

export function serializeColumnsState(columns: GridColumnsState): string {
  const normalized = normalizeColumnsState(columns)
  const params = new URLSearchParams()
  const hidden = Object.entries(normalized.visibility)
    .filter((entry) => entry[1] === false)
    .map((entry) => entry[0])

  if (hidden.length > 0) {
    params.set('hidden', encodeList(hidden))
  }

  if (normalized.order.length > 0) {
    params.set('order', encodeList(normalized.order))
  }

  return params.toString()
}

export function parseColumnsState(
  input: URLSearchParams | string,
  fallback: GridColumnsState = createEmptyColumnsState(),
): GridColumnsState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const base = normalizeColumnsState(fallback)
  const visibility = { ...base.visibility }

  for (const columnId of decodeList(params.get('hidden'))) {
    visibility[columnId] = false
  }

  return normalizeColumnsState({
    visibility,
    order: params.has('order') ? decodeList(params.get('order')) : base.order,
  })
}

export function serializeGridUrlState(input: {
  query: GridQuery
  columns: GridColumnsState
}): string {
  const params = new URLSearchParams(serializeQuery(input.query))
  const columnParams = new URLSearchParams(serializeColumnsState(input.columns))

  for (const [key, value] of columnParams) {
    params.set(key, value)
  }

  return params.toString()
}

export function parseGridUrlState(
  input: URLSearchParams | string,
  fallback: {
    query?: GridQuery
    columns?: GridColumnsState
  } = {},
): {
  query: GridQuery
  columns: GridColumnsState
} {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input

  return {
    query: parseQuery(params, fallback.query),
    columns: parseColumnsState(params, fallback.columns),
  }
}
