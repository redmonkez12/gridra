import {
  createCachedDataSource,
  createDefaultQuery,
  parseQuery,
  type GridExecutionRequest,
  type GridHierarchicalDataSource,
  type GridHierarchicalLiveDataSource,
  type GridHierarchyQuery,
  type GridLiveDataSource,
  type GridNode,
  type GridNodeLoadResult,
  type GridPatch,
} from '@gridra/core'
import {
  type GridColumnDef,
  useDataGrid,
  useGridSelection,
  useGridState,
  useGridUrlSync,
} from '@gridra/react'
import { DataGridTable } from '@gridra/table-reference'
import { useEffect, useMemo, useState } from 'react'

type AccountRecord = {
  id: string
  parentAccountId: string | null
  account: string
  owner: string
  region: 'Americas' | 'EMEA' | 'APAC'
  segment: 'enterprise' | 'mid-market' | 'smb'
  status: 'stable' | 'watch' | 'escalated' | 'new'
  alertCount: number
  riskScore: number
  arr: number
  lastActivity: string
}

type DemoDebugEvent = {
  id: string
  category: 'request' | 'patch'
  title: string
  detail: string
  payload: Record<string, unknown>
  timestamp: number
}

const REGIONS: AccountRecord['region'][] = ['Americas', 'EMEA', 'APAC']
const SEGMENTS: AccountRecord['segment'][] = ['enterprise', 'mid-market', 'smb']
const STATUSES: AccountRecord['status'][] = [
  'stable',
  'watch',
  'escalated',
  'new',
]
const OWNERS = [
  'Avery Chen',
  'Marta Silva',
  'Nina Patel',
  'Jonah Kim',
  'Eli Romero',
  'Sana Ibrahim',
  'Leah Park',
  'Marco Costa',
]
const ACCOUNT_PREFIXES = [
  'Atlas',
  'Beacon',
  'Cinder',
  'Delta',
  'Evergreen',
  'Foundry',
  'Harbor',
  'Jasper',
  'Northstar',
  'Summit',
]
const ACCOUNT_SUFFIXES = [
  'Logistics',
  'Systems',
  'Capital',
  'Health',
  'Retail',
  'Mobility',
  'Cloud',
  'Foods',
  'Energy',
  'Works',
]
const ROW_LIMIT = 150
const TOTAL_ACCOUNTS = 120_000
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const integerFormatter = new Intl.NumberFormat('en-US')

const accounts: AccountRecord[] = Array.from(
  { length: TOTAL_ACCOUNTS },
  (_, index) => {
    const ordinal = index + 1
    const rootIndex = Math.floor(index / 12) * 12 + 1
    const isParent = index % 12 === 0
    const prefix = ACCOUNT_PREFIXES[index % ACCOUNT_PREFIXES.length]
    const suffix =
      ACCOUNT_SUFFIXES[
        Math.floor(index / ACCOUNT_PREFIXES.length) % ACCOUNT_SUFFIXES.length
      ]
    const region = REGIONS[index % REGIONS.length]
    const segment = SEGMENTS[Math.floor(index / 3) % SEGMENTS.length]
    const baseStatus =
      STATUSES[(Math.floor(index / 7) + index) % STATUSES.length]
    const riskScore = 460 + ((index * 29) % 540)
    const lastActivity = new Date(
      Date.UTC(2024, 0, 1 + (index % 420), (index * 7) % 24, (index * 13) % 60),
    )

    return {
      id: `acct-${ordinal}`,
      parentAccountId: isParent ? null : `acct-${rootIndex}`,
      account: `${prefix} ${suffix} ${Math.floor(ordinal / 13) + 1}`,
      owner: OWNERS[(index * 5) % OWNERS.length],
      region,
      segment,
      status:
        riskScore > 930 ? 'escalated' : riskScore > 820 ? 'watch' : baseStatus,
      alertCount: (index * 11) % 18,
      riskScore,
      arr: 18_000 + ((index * 1_379) % 610_000),
      lastActivity: lastActivity.toISOString().slice(0, 10),
    }
  },
)

type AccountsDataSource = GridLiveDataSource<AccountRecord> &
  GridHierarchicalDataSource<AccountRecord> &
  GridHierarchicalLiveDataSource<AccountRecord> & {
    createLiveDelete: () => void
    createLiveInsert: () => void
    createLiveUpdate: () => void
    requestRefresh: () => void
    subscribeDebug: (listener: (event: DemoDebugEvent) => void) => () => void
  }

function delay(signal: AbortSignal, duration: number) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, duration)

    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId)
        reject(new DOMException('The request was aborted.', 'AbortError'))
      },
      { once: true },
    )
  })
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }

  return String(left).localeCompare(String(right))
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function formatInteger(value: number) {
  return integerFormatter.format(value)
}

function formatTimestamp(value: number | null) {
  if (value === null) {
    return 'Awaiting feed'
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value)
}

function getRiskTone(score: number) {
  if (score >= 930) {
    return 'high'
  }

  if (score >= 820) {
    return 'medium'
  }

  return 'low'
}

function createDebugEvent(
  input: Omit<DemoDebugEvent, 'id' | 'timestamp'>,
): DemoDebugEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...input,
  }
}

function getHierarchyLabel(query: ReturnType<typeof createDefaultQuery>) {
  const hierarchy = query.hierarchy

  if (!hierarchy || hierarchy.mode === 'flat') {
    return 'flat queue'
  }

  if (hierarchy.mode === 'group') {
    return `grouped by ${hierarchy.groupBy.map((entry) => entry.columnId).join(' / ')}`
  }

  return 'parent-child accounts'
}

function applyQuery(
  records: readonly AccountRecord[],
  query: ReturnType<typeof createDefaultQuery>,
) {
  let filteredRecords = [...records]

  if (query.globalFilter?.value) {
    const globalNeedle = query.globalFilter.value.toLowerCase()
    filteredRecords = filteredRecords.filter((row) =>
      [
        row.account,
        row.owner,
        row.region,
        row.segment,
        row.status,
        row.id,
      ].some((value) => String(value).toLowerCase().includes(globalNeedle)),
    )
  }

  for (const filter of query.filters) {
    filteredRecords = filteredRecords.filter((row) => {
      const value = row[filter.columnId as keyof AccountRecord]
      switch (filter.operator) {
        case 'contains':
          return String(value)
            .toLowerCase()
            .includes(String(filter.value).toLowerCase())
        case 'eq':
          return String(value) === String(filter.value)
        case 'startsWith':
          return String(value).startsWith(String(filter.value))
        case 'endsWith':
          return String(value).endsWith(String(filter.value))
        case 'lt':
          return compareValues(value, filter.value) < 0
        case 'lte':
          return compareValues(value, filter.value) <= 0
        case 'gt':
          return compareValues(value, filter.value) > 0
        case 'gte':
          return compareValues(value, filter.value) >= 0
        case 'neq':
          return String(value) !== String(filter.value)
        case 'in':
          return Array.isArray(filter.value)
            ? filter.value.map(String).includes(String(value))
            : false
        default:
          return true
      }
    })
  }

  filteredRecords.sort((left, right) => {
    for (const entry of query.sort) {
      const order = compareValues(
        left[entry.columnId as keyof AccountRecord],
        right[entry.columnId as keyof AccountRecord],
      )

      if (order === 0) {
        continue
      }

      return entry.direction === 'asc' ? order : -order
    }

    return 0
  })

  return filteredRecords
}

function makeLeafNode(row: AccountRecord, depth = 0): GridNode<AccountRecord> {
  return {
    kind: 'leaf',
    nodeId: `leaf:${row.id}`,
    parentNodeId: row.parentAccountId ? `tree:${row.parentAccountId}` : null,
    depth,
    isExpanded: false,
    isExpandable: false,
    childCount: null,
    rowId: row.id,
    row,
  }
}

function makeTreeNode(
  row: AccountRecord,
  childCount: number,
  depth: number,
): GridNode<AccountRecord> {
  return {
    kind: 'tree',
    nodeId: `tree:${row.id}`,
    parentNodeId: row.parentAccountId ? `tree:${row.parentAccountId}` : null,
    depth,
    isExpanded: false,
    isExpandable: childCount > 0,
    childCount,
    rowId: row.id,
    row,
  }
}

function getGroupNodeId(
  path: readonly {
    columnId: string
    value: string | number | boolean | null
  }[],
) {
  return `group:${encodeURIComponent(JSON.stringify(path))}`
}

function parseGroupNodeId(nodeId: string) {
  if (!nodeId.startsWith('group:')) {
    return []
  }

  try {
    return JSON.parse(
      decodeURIComponent(nodeId.slice('group:'.length)),
    ) as Array<{
      columnId: string
      value: string | number | boolean | null
    }>
  } catch {
    return []
  }
}

function buildGroupNodes(
  records: readonly AccountRecord[],
  groupBy: NonNullable<
    Extract<GridHierarchyQuery, { mode: 'group' }>['groupBy']
  >,
  path: readonly {
    columnId: string
    value: string | number | boolean | null
  }[],
): GridNode<AccountRecord>[] {
  if (path.length >= groupBy.length) {
    return records.map((row) => makeLeafNode(row, path.length))
  }

  const descriptor = groupBy[path.length]
  const groups = new Map<string, AccountRecord[]>()

  for (const row of records) {
    const value = row[descriptor.columnId as keyof AccountRecord] as
      | string
      | number
      | boolean
      | null
    const key = JSON.stringify(value)
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  return Array.from(groups.entries()).map(([encodedValue, bucket]) => {
    const value = JSON.parse(encodedValue) as string | number | boolean | null
    const nextPath = [...path, { columnId: descriptor.columnId, value }]
    const nextDepth = nextPath.length - 1
    const childCount =
      nextPath.length < groupBy.length
        ? new Set(
            bucket.map((row) =>
              JSON.stringify(
                row[groupBy[nextPath.length].columnId as keyof AccountRecord],
              ),
            ),
          ).size
        : bucket.length

    return {
      kind: 'group',
      nodeId: getGroupNodeId(nextPath),
      parentNodeId: path.length > 0 ? getGroupNodeId(path) : null,
      depth: nextDepth,
      isExpanded: false,
      isExpandable: childCount > 0,
      childCount,
      groupColumnId: descriptor.columnId,
      groupKey: value,
      groupPath: nextPath,
      descendantRowCount: bucket.length,
      aggregates: {
        arr: {
          columnId: 'arr',
          fn: 'sum',
          alias: 'arr',
          value: bucket.reduce((total, row) => total + row.arr, 0),
        },
      },
    }
  })
}

function sliceNodes<TData>(
  nodes: readonly GridNode<TData>[],
  target: GridExecutionRequest['target'],
) {
  return nodes.slice(target.window.start, target.window.end)
}

function createEscalatedQueueQuery() {
  const base = createDefaultQuery(ROW_LIMIT)
  return {
    ...base,
    hierarchy: { mode: 'flat' as const },
    filters: [{ columnId: 'status', operator: 'eq', value: 'escalated' }],
    sort: [
      { columnId: 'riskScore', direction: 'desc' as const },
      { columnId: 'arr', direction: 'desc' as const },
    ],
  }
}

function createEmeaRiskQuery() {
  const base = createDefaultQuery(ROW_LIMIT)
  return {
    ...base,
    hierarchy: { mode: 'flat' as const },
    filters: [
      { columnId: 'region', operator: 'eq', value: 'EMEA' },
      { columnId: 'segment', operator: 'eq', value: 'enterprise' },
      { columnId: 'riskScore', operator: 'gte', value: 880 },
    ],
    sort: [{ columnId: 'riskScore', direction: 'desc' as const }],
  }
}

function createFreshAccountsQuery() {
  const base = createDefaultQuery(ROW_LIMIT)
  return {
    ...base,
    hierarchy: { mode: 'flat' as const },
    filters: [{ columnId: 'status', operator: 'eq', value: 'new' }],
    sort: [
      { columnId: 'arr', direction: 'desc' as const },
      { columnId: 'lastActivity', direction: 'desc' as const },
    ],
  }
}

function createAccountsDataSource(): AccountsDataSource {
  const listeners = new Set<(patch: GridPatch<AccountRecord>) => void>()
  const debugListeners = new Set<(event: DemoDebugEvent) => void>()
  const records = [...accounts]

  const emitPatch = (patch: GridPatch<AccountRecord>) => {
    for (const listener of listeners) {
      listener(patch)
    }
  }

  const emitDebug = (event: DemoDebugEvent) => {
    for (const listener of debugListeners) {
      listener(event)
    }
  }

  const getChildren = (
    parentAccountId: string | null,
    query: ReturnType<typeof createDefaultQuery>,
  ) =>
    applyQuery(records, query).filter(
      (row) => row.parentAccountId === parentAccountId,
    )

  return {
    async load(query, context) {
      const filteredRecords = applyQuery(records, query)
      const offset = query.slice.kind === 'offset' ? query.slice.offset : 0
      const limit = query.slice.limit
      const page = filteredRecords.slice(offset, offset + limit)

      emitDebug(
        createDebugEvent({
          category: 'request',
          title: 'POST /api/account-risk/search',
          detail: `Rows ${offset + 1}-${Math.min(offset + limit, filteredRecords.length)} of ${formatInteger(filteredRecords.length)} in ${getHierarchyLabel(query)}`,
          payload: {
            query: {
              hierarchy: query.hierarchy ?? { mode: 'flat' },
              slice: query.slice,
              sort: query.sort,
              filters: query.filters,
              globalFilter: query.globalFilter,
            },
            response: {
              totalRowCount: filteredRecords.length,
              returnedRows: page.length,
              hasNextPage: offset + limit < filteredRecords.length,
            },
          },
        }),
      )

      await delay(context.signal, 100 + Math.random() * 120)

      return {
        rows: page,
        pageInfo: {
          kind: 'offset' as const,
          totalRowCount: filteredRecords.length,
          hasNextPage: offset + limit < filteredRecords.length,
        },
      }
    },
    async loadNodes(request, context) {
      const hierarchy = request.query.hierarchy
      const filteredRecords = applyQuery(records, request.query)

      emitDebug(
        createDebugEvent({
          category: 'request',
          title: 'POST /api/account-risk/nodes',
          detail: `Window ${request.target.window.start}-${request.target.window.end} in ${getHierarchyLabel(request.query)}`,
          payload: {
            target: request.target,
            query: {
              hierarchy: request.query.hierarchy ?? { mode: 'flat' },
              slice: request.query.slice,
              sort: request.query.sort,
              filters: request.query.filters,
              globalFilter: request.query.globalFilter,
            },
            response: {
              filteredRowCount: filteredRecords.length,
            },
          },
        }),
      )

      await delay(context.signal, 120 + Math.random() * 140)

      if (!hierarchy || hierarchy.mode === 'flat') {
        const nodes = sliceNodes(
          filteredRecords.map((row) => makeLeafNode(row)),
          request.target,
        )

        return {
          target: request.target,
          nodes,
          totalChildren: filteredRecords.length,
          totalRowCount: filteredRecords.length,
          hasNextPage: request.target.window.end < filteredRecords.length,
        }
      }

      if (hierarchy.mode === 'group') {
        const path =
          request.target.kind === 'children-window'
            ? parseGroupNodeId(request.target.parentNodeId)
            : []
        const scopedRecords = filteredRecords.filter((row) =>
          path.every(
            (entry) =>
              row[entry.columnId as keyof AccountRecord] === entry.value,
          ),
        )
        const nodes = buildGroupNodes(scopedRecords, hierarchy.groupBy, path)
        const slicedNodes = sliceNodes(nodes, request.target)

        return {
          target: request.target,
          nodes: slicedNodes,
          totalChildren: nodes.length,
          totalRowCount: scopedRecords.length,
          hasNextPage: request.target.window.end < nodes.length,
        } satisfies GridNodeLoadResult<AccountRecord>
      }

      const parentAccountId =
        request.target.kind === 'children-window'
          ? request.target.parentNodeId.replace(/^tree:/, '')
          : null
      const children = getChildren(parentAccountId, request.query)
      const depth = parentAccountId === null ? 0 : 1
      const nodes = children.map((row) =>
        makeTreeNode(row, getChildren(row.id, request.query).length, depth),
      )

      return {
        target: request.target,
        nodes: sliceNodes(nodes, request.target),
        totalChildren: nodes.length,
        totalRowCount: filteredRecords.length,
        hasNextPage: request.target.window.end < nodes.length,
      }
    },
    subscribe(_query, sink) {
      listeners.add(sink)
      return () => {
        listeners.delete(sink)
      }
    },
    subscribeNodes(_query, _expansion, sink) {
      listeners.add(sink)
      return () => {
        listeners.delete(sink)
      }
    },
    createLiveInsert() {
      const nextIndex = records.length + 1
      const row: AccountRecord = {
        id: `acct-live-${nextIndex}`,
        parentAccountId: null,
        account: `Hot Lead Systems ${nextIndex}`,
        owner: OWNERS[nextIndex % OWNERS.length],
        region: REGIONS[nextIndex % REGIONS.length],
        segment: 'enterprise',
        status: 'new',
        alertCount: 1 + (nextIndex % 4),
        riskScore: 905 + (nextIndex % 70),
        arr: 140_000 + (nextIndex % 9) * 12_000,
        lastActivity: new Date().toISOString().slice(0, 10),
      }

      records.unshift(row)
      emitPatch({
        type: 'row-upsert',
        row,
        changedFields: [
          'account',
          'owner',
          'region',
          'status',
          'alertCount',
          'riskScore',
          'arr',
          'lastActivity',
        ],
        position: { index: 0 },
      })
      emitDebug(
        createDebugEvent({
          category: 'patch',
          title: 'live row-upsert',
          detail: `Inserted ${row.account} at the top of the risk queue`,
          payload: {
            patch: {
              type: 'row-upsert',
              rowId: row.id,
              changedFields: ['status', 'riskScore', 'arr'],
              position: { index: 0 },
            },
          },
        }),
      )
    },
    createLiveUpdate() {
      const index = Math.floor(Math.random() * Math.min(records.length, 4_000))
      const current = records[index]
      if (!current) {
        return
      }

      const nextRiskScore = Math.min(999, current.riskScore + 14 + (index % 23))
      const nextStatus =
        nextRiskScore >= 950
          ? 'escalated'
          : nextRiskScore >= 840
            ? 'watch'
            : current.status
      const nextRow: AccountRecord = {
        ...current,
        status: nextStatus,
        alertCount: Math.min(99, current.alertCount + 1 + (index % 3)),
        riskScore: nextRiskScore,
        lastActivity: new Date().toISOString().slice(0, 10),
      }

      records[index] = nextRow
      emitPatch({
        type: 'row-upsert',
        row: nextRow,
        changedFields: ['status', 'alertCount', 'riskScore', 'lastActivity'],
      })
      emitDebug(
        createDebugEvent({
          category: 'patch',
          title: 'live row-upsert',
          detail: `${nextRow.account} moved to ${nextRow.status} with risk ${nextRow.riskScore}`,
          payload: {
            patch: {
              type: 'row-upsert',
              rowId: nextRow.id,
              changedFields: [
                'status',
                'alertCount',
                'riskScore',
                'lastActivity',
              ],
            },
          },
        }),
      )
    },
    createLiveDelete() {
      const removed = records.splice(12, 1)[0]
      if (!removed) {
        return
      }

      emitPatch({
        type: 'row-delete',
        rowId: removed.id,
      })
      emitDebug(
        createDebugEvent({
          category: 'patch',
          title: 'live row-delete',
          detail: `${removed.account} left the current result set`,
          payload: {
            patch: {
              type: 'row-delete',
              rowId: removed.id,
            },
          },
        }),
      )
    },
    requestRefresh() {
      emitPatch({
        type: 'invalidate',
        scope: 'query',
        reason: 'refresh-requested',
      })
      emitDebug(
        createDebugEvent({
          category: 'patch',
          title: 'query invalidate',
          detail: 'Backend signaled that ranking should be rechecked',
          payload: {
            patch: {
              type: 'invalidate',
              scope: 'query',
              reason: 'refresh-requested',
            },
          },
        }),
      )
    },
    subscribeDebug(listener) {
      debugListeners.add(listener)
      return () => {
        debugListeners.delete(listener)
      }
    },
  }
}

function Dashboard() {
  const initialQuery = useMemo(
    () => parseQuery(window.location.search, createEscalatedQueueQuery()),
    [],
  )
  const columns = useMemo<readonly GridColumnDef<AccountRecord>[]>(
    () => [
      {
        id: 'account',
        header: 'Account',
        accessor: 'account',
        sortable: true,
        filter: { operators: ['contains'] },
        renderCell: ({ row }) => (
          <div className="account-cell">
            <strong>{row.account}</strong>
            <small>{row.id}</small>
          </div>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        accessor: 'owner',
        sortable: true,
        filter: { operators: ['contains'] },
      },
      {
        id: 'region',
        header: 'Region',
        accessor: 'region',
        sortable: true,
        filter: { operators: ['eq'] },
      },
      {
        id: 'segment',
        header: 'Segment',
        accessor: 'segment',
        sortable: true,
        filter: { operators: ['eq'] },
      },
      {
        id: 'status',
        header: 'Status',
        accessor: 'status',
        sortable: true,
        filter: { operators: ['eq'] },
        renderCell: ({ value }) => (
          <span className={`badge badge-${String(value)}`}>
            {String(value)}
          </span>
        ),
      },
      {
        id: 'alertCount',
        header: 'Alerts',
        accessor: 'alertCount',
        sortable: true,
      },
      {
        id: 'riskScore',
        header: 'Risk',
        accessor: 'riskScore',
        sortable: true,
        filter: {
          operators: ['gte'],
          parse: (raw) => Number(raw),
        },
        renderCell: ({ value }) => {
          const score = Number(value)
          return (
            <span className={`score-pill score-${getRiskTone(score)}`}>
              {score}
            </span>
          )
        },
      },
      {
        id: 'arr',
        header: 'ARR',
        accessor: 'arr',
        sortable: true,
        renderCell: ({ value }) => formatCurrency(Number(value)),
      },
      {
        id: 'lastActivity',
        header: 'Last Activity',
        accessor: 'lastActivity',
        sortable: true,
      },
    ],
    [],
  )
  const liveDataSource = useMemo(() => createAccountsDataSource(), [])
  const dataSource = useMemo(
    () =>
      createCachedDataSource(liveDataSource, undefined, {
        getRowId: (row) => row.id,
        staleTimeMs: 1_500,
        maxDatasets: 30,
        maxWindowsPerDataset: 40,
      }),
    [liveDataSource],
  )
  const [debugEvents, setDebugEvents] = useState<DemoDebugEvent[]>([])
  const [isLiveFeedEnabled, setIsLiveFeedEnabled] = useState(true)

  const grid = useDataGrid<AccountRecord>({
    columns,
    dataSource,
    getRowId: (row) => row.id,
    defaultColumns: {
      visibility: { owner: true },
      order: [
        'account',
        'status',
        'riskScore',
        'alertCount',
        'arr',
        'owner',
        'region',
        'segment',
        'lastActivity',
      ],
    },
    defaultQuery: initialQuery,
    virtualization: {
      enabled: true,
      rowHeight: 48,
      overscan: 10,
    },
  })

  useGridUrlSync(grid)

  const state = useGridState(grid)
  const selection = useGridSelection(grid)
  const requestEvents = debugEvents
    .filter((event) => event.category === 'request')
    .slice(0, 3)
  const patchEvents = debugEvents
    .filter((event) => event.category === 'patch')
    .slice(0, 4)
  const currentQuery = state.query
  const hierarchyMode = currentQuery.hierarchy?.mode ?? 'flat'
  const viewportLabel = `${state.virtualization.viewport.start + 1}-${state.virtualization.viewport.end}`
  const selectedCountLabel =
    selection.summary.selectedCount === null
      ? 'unknown'
      : formatInteger(selection.summary.selectedCount)
  const selectionScopeCount =
    selection.selection.scope?.capturedRowCount ?? null
  const selectionRequest = JSON.stringify(selection.request, null, 2)

  useEffect(() => {
    return liveDataSource.subscribeDebug((event) => {
      setDebugEvents((current) => [event, ...current].slice(0, 14))
    })
  }, [liveDataSource])

  useEffect(() => {
    if (!isLiveFeedEnabled) {
      return
    }

    const intervalId = window.setInterval(() => {
      const roll = Math.random()
      if (roll < 0.15) {
        liveDataSource.createLiveInsert()
        return
      }

      if (roll < 0.25) {
        liveDataSource.requestRefresh()
        return
      }

      if (roll < 0.3) {
        liveDataSource.createLiveDelete()
        return
      }

      liveDataSource.createLiveUpdate()
    }, 2_400)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isLiveFeedEnabled, liveDataSource])

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Flagship Example</p>
          <h1>Account risk queue for 120,000 live rows.</h1>
          <p className="lede">
            This demo is intentionally opinionated: a server-first risk queue
            with virtualized windows, backend-owned sorting and filtering,
            select-all-matching bulk actions, and live patches that can reorder
            the result set while the UI keeps scrolling.
          </p>
          <div className="proof-strip">
            <span className="proof-pill">Virtualized viewport</span>
            <span className="proof-pill">Server-side query log</span>
            <span className="proof-pill">All-matching selection</span>
            <span className="proof-pill">Grouped and tree views</span>
          </div>
        </div>

        <aside className="hero-proof panel">
          <p className="panel-kicker">Why this matters</p>
          <h2>Not another client-side table</h2>
          <p>
            The grid is only rendering a window. Filtering, ordering, hierarchy,
            and bulk selection stay expressed as server query state, not as a
            fully materialized client cache.
          </p>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Dataset</span>
              <strong>{formatInteger(TOTAL_ACCOUNTS)} accounts</strong>
            </div>
            <div className="metric-card">
              <span>Viewport</span>
              <strong>{viewportLabel}</strong>
            </div>
            <div className="metric-card">
              <span>Filtered rows</span>
              <strong>{formatInteger(state.data.rowCount ?? 0)}</strong>
            </div>
            <div className="metric-card">
              <span>Last live patch</span>
              <strong>{formatTimestamp(state.live.lastPatchAt)}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="control-band panel">
        <div className="control-group">
          <p className="panel-kicker">Queue presets</p>
          <div className="button-row">
            <button
              type="button"
              onClick={() => grid.setQuery(() => createEscalatedQueueQuery())}
            >
              Escalated pipeline
            </button>
            <button
              type="button"
              onClick={() => grid.setQuery(() => createEmeaRiskQuery())}
            >
              EMEA enterprise risk
            </button>
            <button
              type="button"
              onClick={() => grid.setQuery(() => createFreshAccountsQuery())}
            >
              New high-value accounts
            </button>
            <button
              type="button"
              onClick={() =>
                grid.setQuery((current) => ({
                  ...current,
                  hierarchy: {
                    mode: 'group',
                    groupBy: [
                      { columnId: 'region', direction: 'asc' },
                      { columnId: 'status', direction: 'asc' },
                    ],
                    aggregates: [{ columnId: 'arr', fn: 'sum', alias: 'arr' }],
                  },
                }))
              }
            >
              Group by region / status
            </button>
            <button
              type="button"
              onClick={() =>
                grid.setQuery((current) => ({
                  ...current,
                  hierarchy: { mode: 'tree' },
                }))
              }
            >
              Parent / child accounts
            </button>
            <button
              type="button"
              onClick={() =>
                grid.setQuery((current) => ({
                  ...current,
                  hierarchy: { mode: 'flat' },
                }))
              }
            >
              Flat queue
            </button>
          </div>
        </div>

        <div className="control-group">
          <p className="panel-kicker">Bulk and live actions</p>
          <div className="button-row">
            <button type="button" onClick={() => selection.selectAllMatching()}>
              Select all matching
            </button>
            <button type="button" onClick={() => selection.clearSelection()}>
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => liveDataSource.createLiveUpdate()}
            >
              Inject live update
            </button>
            <button
              type="button"
              onClick={() => liveDataSource.createLiveInsert()}
            >
              Inject live insert
            </button>
            <button
              type="button"
              onClick={() => liveDataSource.requestRefresh()}
            >
              Invalidate query
            </button>
            <button
              type="button"
              onClick={() => setIsLiveFeedEnabled((value) => !value)}
            >
              {isLiveFeedEnabled ? 'Pause live feed' : 'Resume live feed'}
            </button>
          </div>
        </div>

        <div className="meta-strip">
          <span>Status: {state.request.status}</span>
          <span>In flight: {state.request.inFlightCount}</span>
          <span>Cache: {state.data.cacheState}</span>
          <span>Live: {state.live.status}</span>
          <span>Mode: {hierarchyMode}</span>
          <span>Selected: {selectedCountLabel}</span>
          <span>Selection scope: {selection.summary.scopeStatus}</span>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="table-column">
          <div className="panel table-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Primary surface</p>
                <h2>Server-driven queue</h2>
              </div>
              <p className="panel-note">
                Scroll the table, change filters, or switch hierarchy modes and
                inspect the request log on the right. The demo shows the API
                contract, not just the pixels.
              </p>
            </div>
            <DataGridTable grid={grid} height={620} />
          </div>
        </div>

        <aside className="side-column">
          <section className="panel code-panel">
            <div className="panel-header compact">
              <div>
                <p className="panel-kicker">Backend view</p>
                <h2>Recent request payloads</h2>
              </div>
            </div>
            <p className="panel-note">
              These are the queries the demo data source receives. Windowing,
              filters, sorting, and hierarchy all stay explicit.
            </p>
            <div className="event-stack">
              {requestEvents.length > 0 ? (
                requestEvents.map((event) => (
                  <article key={event.id} className="event-card">
                    <header>
                      <strong>{event.title}</strong>
                      <span>{formatTimestamp(event.timestamp)}</span>
                    </header>
                    <p>{event.detail}</p>
                    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                  </article>
                ))
              ) : (
                <p className="empty-state">
                  Waiting for the first server request.
                </p>
              )}
            </div>
          </section>

          <section className="panel code-panel">
            <div className="panel-header compact">
              <div>
                <p className="panel-kicker">Bulk action contract</p>
                <h2>Select-all-matching payload</h2>
              </div>
            </div>
            <p className="panel-note">
              {selection.request.kind === 'all-matching'
                ? `The client is sending the matching query plus exclusions. Captured scope: ${selectionScopeCount === null ? 'unknown' : formatInteger(selectionScopeCount)} rows.`
                : 'Until you switch to all-matching mode, the payload is explicit row ids only.'}
            </p>
            <pre>{selectionRequest}</pre>
          </section>

          <section className="panel code-panel">
            <div className="panel-header compact">
              <div>
                <p className="panel-kicker">Live stream</p>
                <h2>Recent patches</h2>
              </div>
            </div>
            <p className="panel-note">
              Patches can upsert, delete, or invalidate without pretending the
              browser owns the full dataset.
            </p>
            <div className="event-stack">
              {patchEvents.length > 0 ? (
                patchEvents.map((event) => (
                  <article key={event.id} className="event-card">
                    <header>
                      <strong>{event.title}</strong>
                      <span>{formatTimestamp(event.timestamp)}</span>
                    </header>
                    <p>{event.detail}</p>
                    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                  </article>
                ))
              ) : (
                <p className="empty-state">Waiting for the first live patch.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}

export default function App() {
  return <Dashboard />
}
