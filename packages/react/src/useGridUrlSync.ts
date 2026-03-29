import { parseGridUrlState, serializeGridUrlState } from '@gridra/core'
import { useEffect } from 'react'
import { useGridColumns, useGridQuery } from './useDataGrid'
import type { DataGridInstance, UseGridUrlSyncOptions } from './types'

export function useGridUrlSync<TData>(
  grid: DataGridInstance<TData>,
  options: UseGridUrlSyncOptions = {},
): void {
  const query = useGridQuery(grid)
  const columns = useGridColumns(grid)
  const mode = options.mode ?? 'replace'
  const syncQuery = options.sync?.includes('query') ?? true
  const syncColumns = options.sync?.includes('columns') ?? true

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const applyUrlState = () => {
      const nextState = parseGridUrlState(window.location.search, {
        query: grid.getQuery(),
        columns: grid.getColumnsState(),
      })

      if (syncQuery) {
        grid.setQuery(nextState.query, {
          reason: 'url-sync',
          source: 'url',
        })
      }

      if (syncColumns) {
        grid.setColumnsState(nextState.columns, {
          source: 'url',
        })
      }
    }

    applyUrlState()
    window.addEventListener('popstate', applyUrlState)
    return () => {
      window.removeEventListener('popstate', applyUrlState)
    }
  }, [grid, syncColumns, syncQuery])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const nextSearch = serializeGridUrlState({
      query,
      columns: syncColumns
        ? {
            visibility: columns.visibility,
            order: columns.order,
          }
        : { visibility: {}, order: [] },
    })
    const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash}`
    if (mode === 'push') {
      window.history.pushState(null, '', nextUrl)
      return
    }

    window.history.replaceState(null, '', nextUrl)
  }, [columns.order, columns.visibility, mode, query, syncColumns])
}
