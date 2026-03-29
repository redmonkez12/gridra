import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import {
  createDefaultQuery,
  createGridController,
  parseColumnsState,
  parseQuery,
  serializeColumnsState,
  serializeQuery,
} from './index'
import type {
  GridDataSource,
  GridHierarchicalDataSource,
  GridLoadContext,
  GridLoadResult,
  GridQuery,
} from './index'

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void
  let reject!: (error?: unknown) => void

  const promise = new Promise<TValue>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('@gridra/core controller', () => {
  it('aborts superseded requests and ignores late responses', async () => {
    const loads: Array<{
      context: GridLoadContext
      deferred: ReturnType<
        typeof createDeferred<GridLoadResult<{ id: string; name: string }>>
      >
      query: GridQuery
    }> = []

    const dataSource: GridDataSource<{ id: string; name: string }> = {
      load(query, context) {
        const deferred =
          createDeferred<GridLoadResult<{ id: string; name: string }>>()
        context.signal.addEventListener('abort', () => {
          deferred.reject(new DOMException('Request aborted', 'AbortError'))
        })
        loads.push({ query, context, deferred })
        return deferred.promise
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(5),
    })

    await waitFor(() => expect(loads).toHaveLength(1))

    controller.setQuery({
      ...createDefaultQuery(5),
      sort: [{ columnId: 'name', direction: 'asc' }],
      filters: [],
    })

    await waitFor(() => expect(loads).toHaveLength(2))
    expect(loads[0].context.signal.aborted).toBe(true)
    await waitFor(() =>
      expect(controller.getState().request.inFlightCount).toBe(1),
    )

    loads[0].deferred.resolve({
      rows: [{ id: 'stale', name: 'Stale' }],
      pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
    })
    loads[1].deferred.resolve({
      rows: [{ id: 'fresh', name: 'Fresh' }],
      pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Fresh'),
    )

    expect(controller.getVisibleRows()[0]?.row?.name).not.toBe('Stale')
    expect(controller.getState().request.inFlightCount).toBe(0)
  })

  it('requests only missing windows while scrolling in virtual mode', async () => {
    const loads: Array<{
      query: GridQuery
      deferred: ReturnType<
        typeof createDeferred<GridLoadResult<{ id: string }>>
      >
    }> = []

    const dataSource: GridDataSource<{ id: string }> = {
      load(query) {
        const deferred = createDeferred<GridLoadResult<{ id: string }>>()
        loads.push({ query, deferred })
        return deferred.promise
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      virtualization: {
        enabled: true,
        rowHeight: 30,
        overscan: 2,
        viewportDebounceMs: 0,
      },
    })

    await waitFor(() => expect(loads).toHaveLength(1))
    expect(loads[0].query.slice).toEqual({
      kind: 'offset',
      offset: 0,
      limit: 12,
    })

    loads[0].deferred.resolve({
      rows: Array.from({ length: 12 }, (_, index) => ({ id: `row-${index}` })),
      pageInfo: { kind: 'offset', totalRowCount: 100, hasNextPage: true },
    })

    await waitFor(() => expect(controller.getState().data.rowCount).toBe(100))

    controller.setViewport({ start: 5, end: 10 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loads).toHaveLength(1)

    controller.setViewport({ start: 12, end: 16 })
    await waitFor(() => expect(loads).toHaveLength(2))
    expect(loads[1].query.slice).toEqual({
      kind: 'offset',
      offset: 12,
      limit: 6,
    })
  })

  it('throws when cursor pagination is used', () => {
    const dataSource: GridDataSource<{ id: string }> = {
      async load() {
        return {
          rows: [],
          pageInfo: { kind: 'offset', totalRowCount: 0, hasNextPage: false },
        }
      },
    }

    expect(() =>
      createGridController({
        dataSource,
        getRowId: (row) => row.id,
        initialQuery: {
          slice: {
            kind: 'cursor',
            cursor: 'next',
            limit: 10,
            direction: 'forward',
          },
          sort: [],
          filters: [],
          globalFilter: null,
        },
      }),
    ).toThrow(/Cursor pagination is not supported yet/)

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
    })

    expect(() =>
      controller.setQuery({
        slice: {
          kind: 'cursor',
          cursor: 'next',
          limit: 10,
          direction: 'forward',
        },
        sort: [],
        filters: [],
        globalFilter: null,
      }),
    ).toThrow(/Cursor pagination is not supported yet/)

    controller.destroy()
  })

  it('debounces viewport-driven loads', async () => {
    vi.useFakeTimers()

    const loads: GridQuery[] = []
    const dataSource: GridDataSource<{ id: string }> = {
      async load(query) {
        loads.push(query)
        const rowCount = query.slice.kind === 'offset' ? query.slice.limit : 0
        return {
          rows: Array.from({ length: rowCount }, (_, index) => ({
            id: `row-${index + (query.slice.kind === 'offset' ? query.slice.offset : 0)}`,
          })),
          pageInfo: { kind: 'offset', totalRowCount: 100, hasNextPage: true },
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      virtualization: {
        enabled: true,
        rowHeight: 30,
        overscan: 0,
        viewportDebounceMs: 32,
      },
    })

    await flushPromises()
    expect(loads).toHaveLength(1)
    expect(controller.getState().data.rowCount).toBe(100)

    controller.setViewport({ start: 10, end: 20 })
    controller.setViewport({ start: 11, end: 21 })
    controller.setViewport({ start: 12, end: 22 })

    expect(loads).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(31)
    expect(loads).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(loads).toHaveLength(2)
    expect(loads[1]?.slice).toEqual({
      kind: 'offset',
      offset: 12,
      limit: 10,
    })

    controller.destroy()
    vi.useRealTimers()
  })

  it('does not notify listeners when the viewport is unchanged', async () => {
    const dataSource: GridDataSource<{ id: string }> = {
      async load(query) {
        return {
          rows:
            query.slice.kind === 'offset'
              ? Array.from({ length: query.slice.limit }, (_, index) => ({
                  id: `row-${query.slice.offset + index}`,
                }))
              : [],
          pageInfo: { kind: 'offset', totalRowCount: 100, hasNextPage: true },
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      virtualization: {
        enabled: true,
        rowHeight: 30,
        overscan: 0,
        viewportDebounceMs: 0,
      },
    })

    await flushPromises()

    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.setViewport({ start: 0, end: 10 })

    expect(listener).not.toHaveBeenCalled()

    unsubscribe()
    controller.destroy()
  })

  it('creates query-scoped selection without loading every row', async () => {
    const dataSource: GridDataSource<{ id: string }> = {
      async load(query) {
        return {
          rows:
            query.slice.kind === 'offset'
              ? Array.from({ length: query.slice.limit }, (_, index) => ({
                  id: `row-${query.slice.offset + index}`,
                }))
              : [],
          pageInfo: { kind: 'offset', totalRowCount: 100, hasNextPage: true },
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
      },
    })

    await flushPromises()
    controller.selectAllMatching()

    expect(controller.getSelectionRequest()).toEqual({
      kind: 'all-matching',
      query: {
        filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
        globalFilter: null,
      },
      includedIds: [],
      excludedIds: [],
    })

    controller.deselectRows(['row-1'])
    expect(controller.isRowSelected('row-1')).toBe(false)
    expect(controller.getSelectionRequest()).toEqual({
      kind: 'all-matching',
      query: {
        filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
        globalFilter: null,
      },
      includedIds: [],
      excludedIds: ['row-1'],
    })

    controller.setQuery({
      ...controller.getState().query,
      filters: [{ columnId: 'status', operator: 'eq', value: 'paused' }],
    })

    expect(controller.getSelectionSummary().scopeStatus).toBe('detached')
  })

  it('resets explicit ids when switching to all-matching selection', async () => {
    const dataSource: GridDataSource<{ id: string }> = {
      async load(query) {
        return {
          rows:
            query.slice.kind === 'offset'
              ? Array.from({ length: query.slice.limit }, (_, index) => ({
                  id: `row-${query.slice.offset + index}`,
                }))
              : [],
          pageInfo: { kind: 'offset', totalRowCount: 100, hasNextPage: true },
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
      },
    })

    await flushPromises()

    controller.selectRows(['row-1'])
    expect(controller.getSelectionSummary().selectedCount).toBe(1)

    controller.selectAllMatching()

    expect(controller.getSelectionRequest()).toEqual({
      kind: 'all-matching',
      query: {
        filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
        globalFilter: null,
      },
      includedIds: [],
      excludedIds: [],
    })
    expect(controller.getSelectionSummary().selectedCount).toBe(100)
  })

  it('loads grouped root nodes and lazily expands group children', async () => {
    const loadTargets: string[] = []
    const dataSource: GridHierarchicalDataSource<{
      id: string
      company: string
      name: string
    }> = {
      async load() {
        return {
          rows: [],
          pageInfo: { kind: 'offset', totalRowCount: 0, hasNextPage: false },
        }
      },
      async loadNodes(request) {
        if (request.target.kind === 'root-window') {
          loadTargets.push('root')
          return {
            target: request.target,
            nodes: [
              {
                kind: 'group',
                nodeId: 'group:orbit',
                parentNodeId: null,
                depth: 0,
                isExpanded: false,
                isExpandable: true,
                childCount: 2,
                groupColumnId: 'company',
                groupKey: 'Orbit',
                groupPath: [{ columnId: 'company', value: 'Orbit' }],
                descendantRowCount: 2,
              },
            ],
            totalChildren: 1,
            totalRowCount: 2,
            hasNextPage: false,
          }
        }

        loadTargets.push(`children:${request.target.parentNodeId}`)
        return {
          target: request.target,
          nodes: [
            {
              kind: 'leaf',
              nodeId: 'leaf:1',
              parentNodeId: request.target.parentNodeId,
              depth: 1,
              isExpanded: false,
              isExpandable: false,
              childCount: null,
              rowId: '1',
              row: { id: '1', company: 'Orbit', name: 'Ada' },
            },
            {
              kind: 'leaf',
              nodeId: 'leaf:2',
              parentNodeId: request.target.parentNodeId,
              depth: 1,
              isExpanded: false,
              isExpandable: false,
              childCount: null,
              rowId: '2',
              row: { id: '2', company: 'Orbit', name: 'Grace' },
            },
          ],
          totalChildren: 2,
          totalRowCount: 2,
          hasNextPage: false,
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        hierarchy: {
          mode: 'group',
          groupBy: [{ columnId: 'company', direction: 'asc' }],
        },
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.kind).toBe('group'),
    )
    expect(loadTargets).toEqual(['root'])

    controller.expandNode('group:orbit')

    await waitFor(() =>
      expect(controller.getVisibleRows().map((row) => row.rowId)).toContain(
        '1',
      ),
    )
    expect(loadTargets).toContain('children:group:orbit')
  })

  it('preserves selected tree children after collapsing the parent branch', async () => {
    const dataSource: GridHierarchicalDataSource<{ id: string; name: string }> =
      {
        async load() {
          return {
            rows: [],
            pageInfo: { kind: 'offset', totalRowCount: 0, hasNextPage: false },
          }
        },
        async loadNodes(request) {
          if (request.target.kind === 'root-window') {
            return {
              target: request.target,
              nodes: [
                {
                  kind: 'tree',
                  nodeId: 'tree:parent',
                  parentNodeId: null,
                  depth: 0,
                  isExpanded: false,
                  isExpandable: true,
                  childCount: 1,
                  rowId: 'parent',
                  row: { id: 'parent', name: 'Parent' },
                },
              ],
              totalChildren: 1,
              totalRowCount: 2,
              hasNextPage: false,
            }
          }

          return {
            target: request.target,
            nodes: [
              {
                kind: 'tree',
                nodeId: 'tree:child',
                parentNodeId: request.target.parentNodeId,
                depth: 1,
                isExpanded: false,
                isExpandable: false,
                childCount: 0,
                rowId: 'child',
                row: { id: 'child', name: 'Child' },
              },
            ],
            totalChildren: 1,
            totalRowCount: 2,
            hasNextPage: false,
          }
        },
      }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        hierarchy: { mode: 'tree' },
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.rowId).toBe('parent'),
    )
    controller.expandNode('tree:parent')
    await waitFor(() =>
      expect(controller.getVisibleRows().map((row) => row.rowId)).toContain(
        'child',
      ),
    )

    controller.selectRows(['child'])
    controller.collapseNode('tree:parent')

    expect(controller.isRowSelected('child')).toBe(true)
    expect(controller.getVisibleRows().map((row) => row.rowId)).not.toContain(
      'child',
    )
  })

  it('refreshes ancestor group nodes when a hierarchical child patch changes aggregates', async () => {
    const loadTargets: string[] = []
    let score = 10

    const dataSource: GridHierarchicalDataSource<{
      id: string
      company: string
      name: string
      score: number
    }> = {
      async load() {
        return {
          rows: [],
          pageInfo: { kind: 'offset', totalRowCount: 0, hasNextPage: false },
        }
      },
      async loadNodes(request) {
        if (request.target.kind === 'root-window') {
          loadTargets.push('root')
          return {
            target: request.target,
            nodes: [
              {
                kind: 'group',
                nodeId: 'group:orbit',
                parentNodeId: null,
                depth: 0,
                isExpanded: false,
                isExpandable: true,
                childCount: 1,
                groupColumnId: 'company',
                groupKey: 'Orbit',
                groupPath: [{ columnId: 'company', value: 'Orbit' }],
                descendantRowCount: 1,
                aggregates: {
                  score: {
                    columnId: 'score',
                    fn: 'sum',
                    alias: 'score',
                    value: score,
                  },
                },
              },
            ],
            totalChildren: 1,
            totalRowCount: 1,
            hasNextPage: false,
          }
        }

        loadTargets.push(`children:${request.target.parentNodeId}`)
        return {
          target: request.target,
          nodes: [
            {
              kind: 'leaf',
              nodeId: 'leaf:1',
              parentNodeId: request.target.parentNodeId,
              depth: 1,
              isExpanded: false,
              isExpandable: false,
              childCount: null,
              rowId: '1',
              row: { id: '1', company: 'Orbit', name: 'Ada', score },
            },
          ],
          totalChildren: 1,
          totalRowCount: 1,
          hasNextPage: false,
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        hierarchy: {
          mode: 'group',
          groupBy: [{ columnId: 'company', direction: 'asc' }],
          aggregates: [{ columnId: 'score', fn: 'sum', alias: 'score' }],
        },
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.aggregates?.score?.value).toBe(10),
    )

    controller.expandNode('group:orbit')
    await waitFor(() =>
      expect(controller.getVisibleRows().map((row) => row.rowId)).toContain(
        '1',
      ),
    )

    score = 20
    controller.applyPatch({
      type: 'row-upsert',
      row: { id: '1', company: 'Orbit', name: 'Ada', score },
      changedFields: ['score'],
      parentNodeId: 'group:orbit',
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.aggregates?.score?.value).toBe(20),
    )
    expect(
      loadTargets.filter((target) => target === 'root').length,
    ).toBeGreaterThan(1)
    expect(
      loadTargets.filter((target) => target === 'children:group:orbit').length,
    ).toBeGreaterThan(1)
  })

  it('keeps the visible rows slice stable while invalidated hierarchy windows are reloading', async () => {
    const childReload =
      createDeferred<
        ReturnType<
          GridHierarchicalDataSource<{ id: string; name: string }>['loadNodes']
        > extends Promise<infer TValue>
          ? TValue
          : never
      >()
    let childLoadCount = 0

    const dataSource: GridHierarchicalDataSource<{ id: string; name: string }> =
      {
        async load() {
          return {
            rows: [],
            pageInfo: { kind: 'offset', totalRowCount: 0, hasNextPage: false },
          }
        },
        loadNodes(request) {
          if (request.target.kind === 'root-window') {
            return Promise.resolve({
              target: request.target,
              nodes: [
                {
                  kind: 'group',
                  nodeId: 'group:orbit',
                  parentNodeId: null,
                  depth: 0,
                  isExpanded: false,
                  isExpandable: true,
                  childCount: 1,
                  groupColumnId: 'company',
                  groupKey: 'Orbit',
                  groupPath: [{ columnId: 'company', value: 'Orbit' }],
                  descendantRowCount: 1,
                },
              ],
              totalChildren: 1,
              totalRowCount: 1,
              hasNextPage: false,
            })
          }

          childLoadCount += 1
          if (childLoadCount === 1) {
            return Promise.resolve({
              target: request.target,
              nodes: [
                {
                  kind: 'leaf',
                  nodeId: 'leaf:1',
                  parentNodeId: request.target.parentNodeId,
                  depth: 1,
                  isExpanded: false,
                  isExpandable: false,
                  childCount: null,
                  rowId: '1',
                  row: { id: '1', name: 'Ada' },
                },
              ],
              totalChildren: 1,
              totalRowCount: 1,
              hasNextPage: false,
            })
          }

          return childReload.promise
        },
      }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        hierarchy: {
          mode: 'group',
          groupBy: [{ columnId: 'company', direction: 'asc' }],
        },
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.kind).toBe('group'),
    )
    controller.expandNode('group:orbit')
    await waitFor(() =>
      expect(controller.getVisibleRows().map((row) => row.rowId)).toContain(
        '1',
      ),
    )

    const visibleRows = controller.getVisibleRows()

    controller.applyPatch({
      type: 'children-invalidate',
      parentNodeId: 'group:orbit',
    })

    expect(controller.getVisibleRows()).toBe(visibleRows)

    childReload.resolve({
      target: {
        kind: 'children-window',
        parentNodeId: 'group:orbit',
        window: { start: 0, end: 1 },
      },
      nodes: [
        {
          kind: 'leaf',
          nodeId: 'leaf:1',
          parentNodeId: 'group:orbit',
          depth: 1,
          isExpanded: false,
          isExpandable: false,
          childCount: null,
          rowId: '1',
          row: { id: '1', name: 'Ada' },
        },
      ],
      totalChildren: 1,
      totalRowCount: 1,
      hasNextPage: false,
    })

    await waitFor(() =>
      expect(controller.getState().request.inFlightCount).toBe(0),
    )
  })

  it('round-trips query and column serialization', () => {
    const query: GridQuery = {
      slice: {
        kind: 'offset',
        offset: 60,
        limit: 30,
      },
      sort: [
        { columnId: 'name', direction: 'asc' },
        { columnId: 'score', direction: 'desc' },
      ],
      filters: [
        { columnId: 'status', operator: 'eq', value: 'active' },
        { columnId: 'score', operator: 'gte', value: 100 },
      ],
      globalFilter: {
        value: 'ada',
        operator: 'search',
      },
    }

    expect(parseQuery(serializeQuery(query))).toEqual(query)
    expect(
      parseColumnsState(
        serializeColumnsState({
          visibility: { email: false },
          order: ['name', 'status', 'email'],
        }),
      ),
    ).toEqual({
      visibility: { email: false },
      order: ['name', 'status', 'email'],
    })
  })
})
