import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDefaultQuery } from '@gridra/core'
import { DataGrid } from './index'
import type { GridDataSource, GridQuery } from '@gridra/core'

describe('@gridra/table-reference', () => {
  it('issues a sorted query when a sortable header is clicked', async () => {
    const queries: GridQuery[] = []

    const dataSource: GridDataSource<{ id: string; name: string }> = {
      async load(query) {
        queries.push(query)
        return {
          rows: [{ id: '1', name: 'Ada' }],
          pageInfo: { kind: 'offset', totalRowCount: 1, hasNextPage: false },
        }
      },
    }

    render(
      <DataGrid
        columns={[
          { id: 'name', header: 'Name', accessor: 'name', sortable: true },
        ]}
        dataSource={dataSource}
        defaultQuery={createDefaultQuery(10)}
        getRowId={(row) => row.id}
      />,
    )

    await screen.findByText('Ada')
    fireEvent.click(screen.getByRole('button', { name: /name/i }))

    await waitFor(() =>
      expect(queries.at(-1)?.sort).toEqual([
        { columnId: 'name', direction: 'asc' },
      ]),
    )
  })

  it('renders only visible columns', async () => {
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

    render(
      <DataGrid
        columns={[
          { id: 'name', header: 'Name', accessor: 'name' },
          {
            id: 'email',
            header: 'Email',
            accessor: 'email',
            defaultVisible: false,
          },
        ]}
        dataSource={dataSource}
        defaultColumns={{ visibility: { email: false }, order: [] }}
        defaultQuery={createDefaultQuery(10)}
        getRowId={(row) => row.id}
      />,
    )

    await screen.findByText('Ada')
    expect(
      screen.getByRole('columnheader', { name: 'Name' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Email' }),
    ).not.toBeInTheDocument()
  })
})
