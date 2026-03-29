import { waitFor } from '@testing-library/react'
import {
  createCachedDataSource,
  createDefaultQuery,
  createGridController,
  MemoryGridQueryCache,
} from './index'
import type {
  GridEditableDataSource,
  GridHierarchicalLiveDataSource,
  GridLiveDataSource,
} from './index'

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

describe('@gridra/core v3 behaviors', () => {
  it('applies safe live row upserts in place for loaded rows', async () => {
    let loadCount = 0

    const dataSource: GridLiveDataSource<{ id: string; name: string }> = {
      async load() {
        loadCount += 1
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    controller.applyPatch({
      type: 'row-upsert',
      row: { id: '1', name: 'Grace' },
      changedFields: ['name'],
    })

    expect(controller.getVisibleRows()[0]?.row?.name).toBe('Grace')
    expect(loadCount).toBe(1)
  })

  it('invalidates and refetches when a live patch touches sort fields', async () => {
    const loads: string[] = []
    let currentName = 'Ada'

    const dataSource: GridLiveDataSource<{ id: string; name: string }> = {
      async load() {
        loads.push(currentName)
        return {
          rows: [{ id: '1', name: currentName }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        sort: [{ columnId: 'name', direction: 'asc' }],
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    currentName = 'Zed'
    controller.applyPatch({
      type: 'row-upsert',
      row: { id: '1', name: 'Zed' },
      changedFields: ['name'],
      position: { index: 0 },
    })

    await waitFor(() => expect(loads).toHaveLength(2))
    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Zed'),
    )
  })

  it('preserves local drafts and marks conflicts when live data updates the same cell', async () => {
    const dataSource: GridEditableDataSource<{ id: string; name: string }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
      async save(request) {
        return {
          row: request.draftRow,
          acknowledgedMutationId: request.clientMutationId,
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      editing: {
        applyCellValue: (row, columnId, value) => ({
          ...row,
          [columnId]: value,
        }),
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    controller.startCellEdit('1', 'name')
    controller.updateCellDraft('1', 'name', 'Local')
    controller.applyPatch({
      type: 'row-upsert',
      row: { id: '1', name: 'Remote' },
      changedFields: ['name'],
    })

    expect(controller.getRowDraft('1')?.phase).toBe('conflict')
    expect(controller.getVisibleRows()[0]?.row?.name).toBe('Local')
    expect(controller.getVisibleRows()[0]?.canonicalRow?.name).toBe('Remote')
  })

  it('serves stale cached rows immediately and refreshes them in the background', async () => {
    let loadCount = 0
    const cache = new MemoryGridQueryCache<{ id: string; name: string }>()
    const baseDataSource = {
      async load() {
        loadCount += 1
        return {
          rows: [{ id: '1', name: `Server ${loadCount}` }],
          pageInfo: {
            kind: 'offset' as const,
            totalRowCount: 1,
            hasNextPage: false,
          },
        }
      },
    }

    const cachedDataSource = createCachedDataSource(baseDataSource, cache, {
      getRowId: (row) => row.id,
      staleTimeMs: 0,
    })

    const firstController = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
    })

    await waitFor(() =>
      expect(firstController.getVisibleRows()[0]?.row?.name).toBe('Server 1'),
    )
    firstController.destroy()

    const secondController = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
    })

    await flushPromises()
    expect(secondController.getVisibleRows()[0]?.row?.name).toBe('Server 1')
    await waitFor(() =>
      expect(secondController.getVisibleRows()[0]?.row?.name).toBe('Server 2'),
    )
    expect(loadCount).toBe(2)
  })

  it('clears drafts when a live delete removes the edited row', async () => {
    const dataSource: GridEditableDataSource<{ id: string; name: string }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
      async save(request) {
        return {
          row: request.draftRow,
          acknowledgedMutationId: request.clientMutationId,
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      editing: {
        applyCellValue: (row, columnId, value) => ({
          ...row,
          [columnId]: value,
        }),
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    controller.startCellEdit('1', 'name')
    controller.updateCellDraft('1', 'name', 'Local')
    controller.applyPatch({
      type: 'row-delete',
      rowId: '1',
      position: { index: 0 },
    })

    expect(controller.getRowDraft('1')).toBeNull()
    expect(controller.getState().editing.activeCell).toBeNull()
  })

  it('ignores concurrent commits while a row save is already in flight', async () => {
    const saveResult = createDeferred<{
      row: { id: string; name: string }
      acknowledgedMutationId: string
    }>()
    const saveRequests: string[] = []

    const dataSource: GridEditableDataSource<{ id: string; name: string }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
      save(request) {
        saveRequests.push(request.clientMutationId)
        return saveResult.promise
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      editing: {
        applyCellValue: (row, columnId, value) => ({
          ...row,
          [columnId]: value,
        }),
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    controller.startCellEdit('1', 'name')
    controller.updateCellDraft('1', 'name', 'Local')

    const firstCommit = controller.commitCellEdit('1', 'name')
    const secondCommit = controller.commitCellEdit('1', 'name')

    expect(saveRequests).toHaveLength(1)

    saveResult.resolve({
      row: { id: '1', name: 'Local' },
      acknowledgedMutationId: saveRequests[0],
    })

    await firstCommit
    await secondCommit
  })

  it('keeps a conflicting draft after save success when the server row still differs', async () => {
    const saveResult = createDeferred<{
      row: { id: string; name: string }
      acknowledgedMutationId?: string
    }>()

    const dataSource: GridEditableDataSource<{ id: string; name: string }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
      save() {
        return saveResult.promise
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      editing: {
        applyCellValue: (row, columnId, value) => ({
          ...row,
          [columnId]: value,
        }),
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    controller.startCellEdit('1', 'name')
    controller.updateCellDraft('1', 'name', 'Local')
    const commitPromise = controller.commitCellEdit('1', 'name')

    controller.applyPatch({
      type: 'row-upsert',
      row: { id: '1', name: 'Remote' },
      changedFields: ['name'],
    })

    saveResult.resolve({
      row: { id: '1', name: 'Remote' },
    })

    await commitPromise

    expect(controller.getRowDraft('1')?.phase).toBe('conflict')
    expect(controller.getVisibleRows()[0]?.row?.name).toBe('Local')
    expect(controller.getVisibleRows()[0]?.canonicalRow?.name).toBe('Remote')
  })

  it('updates every cached window that already contains the patched row', async () => {
    const cache = new MemoryGridQueryCache<{ id: string; name: string }>()
    const rows = Array.from({ length: 20 }, (_, index) => ({
      id: String(index + 1),
      name: `Row ${index + 1}`,
    }))
    const listeners = new Set<
      (patch: {
        type: 'row-upsert'
        row: { id: string; name: string }
        changedFields: string[]
      }) => void
    >()

    const baseDataSource: GridLiveDataSource<{ id: string; name: string }> = {
      async load(query) {
        if (query.slice.kind !== 'offset') {
          throw new Error('Expected offset pagination in test')
        }

        return {
          rows: rows.slice(
            query.slice.offset,
            query.slice.offset + query.slice.limit,
          ),
          pageInfo: {
            kind: 'offset',
            totalRowCount: rows.length,
            hasNextPage: query.slice.offset + query.slice.limit < rows.length,
          },
        }
      },
      subscribe(_query, sink) {
        listeners.add(sink)
        return () => {
          listeners.delete(sink)
        }
      },
    }

    const cachedDataSource = createCachedDataSource(baseDataSource, cache, {
      getRowId: (row) => row.id,
      staleTimeMs: 60_000,
    })

    const pageOne = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
    })
    await waitFor(() =>
      expect(pageOne.getVisibleRows()[0]?.row?.name).toBe('Row 1'),
    )
    pageOne.destroy()

    const pageTwo = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        slice: {
          kind: 'offset',
          offset: 10,
          limit: 10,
        },
      },
    })
    await waitFor(() =>
      expect(pageTwo.getVisibleRows()[0]?.row?.name).toBe('Row 11'),
    )
    pageTwo.destroy()

    const liveController = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
    })
    await waitFor(() =>
      expect(liveController.getVisibleRows()[0]?.row?.name).toBe('Row 1'),
    )

    rows[14] = { id: '15', name: 'Row 15 patched' }
    for (const listener of listeners) {
      listener({
        type: 'row-upsert',
        row: rows[14],
        changedFields: ['name'],
      })
    }

    const cachedPageTwo = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        slice: {
          kind: 'offset',
          offset: 10,
          limit: 10,
        },
      },
    })

    await flushPromises()
    expect(cachedPageTwo.getVisibleRows()[4]?.row?.name).toBe('Row 15 patched')
  })

  it('preserves hierarchical live subscriptions through the cache wrapper', async () => {
    const listeners = new Set<
      (patch: {
        type: 'children-invalidate'
        parentNodeId: string | null
      }) => void
    >()
    let currentName = 'Ada'

    const baseDataSource: GridHierarchicalLiveDataSource<{
      id: string
      name: string
    }> = {
      async load() {
        return {
          rows: [],
          pageInfo: { kind: 'offset', totalRowCount: 0, hasNextPage: false },
        }
      },
      async loadNodes(request) {
        return {
          target: request.target,
          nodes: [
            {
              kind: 'tree',
              nodeId: 'tree:1',
              parentNodeId: null,
              depth: 0,
              isExpanded: false,
              isExpandable: false,
              childCount: 0,
              rowId: '1',
              row: { id: '1', name: currentName },
            },
          ],
          totalChildren: 1,
          totalRowCount: 1,
          hasNextPage: false,
        }
      },
      subscribeNodes(_query, _expansion, sink) {
        listeners.add(sink)
        return () => {
          listeners.delete(sink)
        }
      },
    }

    const cachedDataSource = createCachedDataSource(baseDataSource, undefined, {
      getRowId: (row) => row.id,
      staleTimeMs: 60_000,
    })

    const controller = createGridController({
      dataSource: cachedDataSource,
      getRowId: (row) => row.id,
      initialQuery: {
        ...createDefaultQuery(10),
        hierarchy: { mode: 'tree' },
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    currentName = 'Grace'
    for (const listener of listeners) {
      listener({
        type: 'children-invalidate',
        parentNodeId: null,
      })
    }

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Grace'),
    )
  })

  it('drops drafts when the view key changes', async () => {
    const dataSource: GridEditableDataSource<{ id: string; name: string }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
      async save(request) {
        return {
          row: request.draftRow,
          acknowledgedMutationId: request.clientMutationId,
        }
      },
    }

    const controller = createGridController({
      dataSource,
      getRowId: (row) => row.id,
      initialQuery: createDefaultQuery(10),
      editing: {
        applyCellValue: (row, columnId, value) => ({
          ...row,
          [columnId]: value,
        }),
      },
    })

    await waitFor(() =>
      expect(controller.getVisibleRows()[0]?.row?.name).toBe('Ada'),
    )

    controller.startCellEdit('1', 'name')
    controller.updateCellDraft('1', 'name', 'Local')
    controller.setQuery(
      {
        ...createDefaultQuery(10),
        sort: [{ columnId: 'name', direction: 'asc' }],
      },
      'query-change',
    )

    expect(controller.getRowDraft('1')).toBeNull()
    expect(controller.getState().editing.pending).toEqual({})
  })
})
