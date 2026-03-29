import { act, render, waitFor } from '@testing-library/react'
import { createDefaultQuery } from '@gridra/core'
import {
  useDataGrid,
  useGridCellDraft,
  useGridSelection,
  useGridColumns,
  useGridQuery,
  useGridStatus,
  useGridVirtualRows,
} from './index'
import type { GridDataSource, GridSelectionRequest } from '@gridra/core'
import { useState } from 'react'

describe('@gridra/react', () => {
  it('keeps query subscribers stable when only request state changes', async () => {
    let queryRenders = 0
    let statusRenders = 0

    const dataSource: GridDataSource<{ id: string; name: string }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
    }

    function QueryProbe(props: {
      grid: ReturnType<typeof useDataGrid<{ id: string; name: string }>>
    }) {
      useGridQuery(props.grid)
      queryRenders += 1
      return null
    }

    function StatusProbe(props: {
      grid: ReturnType<typeof useDataGrid<{ id: string; name: string }>>
    }) {
      useGridStatus(props.grid)
      statusRenders += 1
      return null
    }

    function Harness() {
      const grid = useDataGrid({
        columns: [{ id: 'name', header: 'Name', accessor: 'name' }],
        dataSource,
        getRowId: (row: { id: string }) => row.id,
        defaultQuery: createDefaultQuery(10),
      })

      return (
        <>
          <QueryProbe grid={grid} />
          <StatusProbe grid={grid} />
        </>
      )
    }

    render(<Harness />)

    await waitFor(() => expect(statusRenders).toBeGreaterThan(1))
    expect(queryRenders).toBe(1)
  })

  it('keeps virtual row subscribers stable while refresh only changes request state', async () => {
    let virtualRowRenders = 0
    let refreshLoadResolver: (() => void) | null = null
    let gridInstance: ReturnType<
      typeof useDataGrid<{ id: string; name: string }>
    > | null = null
    let loadCount = 0

    const dataSource: GridDataSource<{ id: string; name: string }> = {
      async load() {
        loadCount += 1
        if (loadCount === 1) {
          return {
            rows: [{ id: '1', name: 'Ada' }],
            pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
          }
        }

        await new Promise<void>((resolve) => {
          refreshLoadResolver = resolve
        })

        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
    }

    function VirtualRowsProbe(props: {
      grid: ReturnType<typeof useDataGrid<{ id: string; name: string }>>
    }) {
      useGridVirtualRows(props.grid)
      virtualRowRenders += 1
      return null
    }

    function Harness() {
      const grid = useDataGrid({
        columns: [{ id: 'name', header: 'Name', accessor: 'name' }],
        dataSource,
        getRowId: (row: { id: string }) => row.id,
        defaultQuery: createDefaultQuery(10),
      })

      gridInstance = grid
      return <VirtualRowsProbe grid={grid} />
    }

    render(<Harness />)

    await waitFor(() => expect(loadCount).toBe(1))
    await waitFor(() => expect(gridInstance?.getState().data.rowCount).toBe(1))

    const rendersAfterInitialLoad = virtualRowRenders

    act(() => {
      gridInstance?.refresh()
    })

    await waitFor(() => expect(loadCount).toBe(2))
    expect(virtualRowRenders).toBe(rendersAfterInitialLoad)

    act(() => {
      refreshLoadResolver?.()
    })

    await waitFor(() =>
      expect(gridInstance?.getState().request.inFlightCount).toBe(0),
    )
  })

  it('resolves visible columns from mutable column state', async () => {
    let visibleIds: string[] = []

    const dataSource: GridDataSource<{
      id: string
      name: string
      email: string
    }> = {
      async load() {
        return {
          rows: [{ id: '1', name: 'Ada', email: 'ada@example.com' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
    }

    function Probe() {
      const grid = useDataGrid({
        columns: [
          { id: 'name', header: 'Name', accessor: 'name' },
          {
            id: 'email',
            header: 'Email',
            accessor: 'email',
            defaultVisible: false,
          },
        ],
        dataSource,
        getRowId: (row: { id: string }) => row.id,
        defaultColumns: {
          visibility: { email: false },
          order: ['email', 'name'],
        },
        defaultQuery: createDefaultQuery(10),
      })
      const columns = useGridColumns(grid)
      visibleIds = columns.visibleColumns.map((column) => column.id)
      return null
    }

    render(<Probe />)

    await waitFor(() => expect(visibleIds).toEqual(['name']))
  })

  it('clears explicit ids when switching to all-matching selection', async () => {
    let selectedCount: number | null = null
    let request: GridSelectionRequest | null = null

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

    function Probe() {
      const grid = useDataGrid({
        columns: [{ id: 'id', header: 'ID', accessor: 'id' }],
        dataSource,
        getRowId: (row: { id: string }) => row.id,
        defaultQuery: {
          ...createDefaultQuery(10),
          filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
        },
      })
      const selection = useGridSelection(grid)

      selectedCount = selection.summary.selectedCount
      request = selection.request

      return (
        <button
          type="button"
          onClick={() => {
            grid.selectRows(['row-1'])
            grid.selectAllMatching()
          }}
        >
          Select all
        </button>
      )
    }

    const { getByRole } = render(<Probe />)

    await waitFor(() => expect(selectedCount).toBe(0))

    act(() => {
      getByRole('button', { name: 'Select all' }).click()
    })

    await waitFor(() =>
      expect(request).toEqual({
        kind: 'all-matching',
        query: {
          filters: [{ columnId: 'status', operator: 'eq', value: 'active' }],
          globalFilter: null,
        },
        includedIds: [],
        excludedIds: [],
      }),
    )
    expect(selectedCount).toBe(100)
  })

  it('preserves cell drafts across component remounts', async () => {
    let draftValue: unknown = null

    const dataSource: GridDataSource<{ id: string; name: string }> = {
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

    function DraftProbe(props: {
      grid: ReturnType<typeof useDataGrid<{ id: string; name: string }>>
    }) {
      const draft = useGridCellDraft(props.grid, '1', 'name')
      draftValue = draft?.value ?? null
      return null
    }

    function Harness() {
      const [showProbe, setShowProbe] = useState(true)
      const grid = useDataGrid({
        columns: [{ id: 'name', header: 'Name', accessor: 'name', edit: {} }],
        dataSource,
        getRowId: (row: { id: string }) => row.id,
        defaultQuery: createDefaultQuery(10),
      })

      return (
        <>
          {showProbe ? <DraftProbe grid={grid} /> : null}
          <button
            type="button"
            onClick={() => {
              grid.startCellEdit('1', 'name')
              grid.updateCellDraft('1', 'name', 'Edited')
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setShowProbe((current) => !current)}
          >
            Toggle
          </button>
        </>
      )
    }

    const { getByRole } = render(<Harness />)

    await waitFor(() => expect(draftValue).toBe(null))

    act(() => {
      getByRole('button', { name: 'Edit' }).click()
    })

    await waitFor(() => expect(draftValue).toBe('Edited'))

    act(() => {
      getByRole('button', { name: 'Toggle' }).click()
    })

    act(() => {
      getByRole('button', { name: 'Toggle' }).click()
    })

    await waitFor(() => expect(draftValue).toBe('Edited'))
  })
})
