import { normalizeQuery } from '@gridra/core'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { GridDataSource, GridQuery, GridStatus } from '@gridra/core'
import type { UseDataSourceResult } from './types'

export function useDataSource<TData>(
  dataSource: GridDataSource<TData>,
  query: GridQuery,
): UseDataSourceResult<TData> {
  const [rows, setRows] = useState<TData[]>([])
  const [pageInfo, setPageInfo] =
    useState<UseDataSourceResult<TData>['pageInfo']>(null)
  const [status, setStatus] = useState<GridStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  const requestIdRef = useRef(0)

  const runLoad = useEffectEvent(() => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    const abortController = new AbortController()

    setStatus(rows.length > 0 ? 'ready' : 'loading')
    setError(null)

    void dataSource
      .load(normalizeQuery(query), {
        requestId,
        reason: 'query-change',
        signal: abortController.signal,
      })
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return
        }

        setRows(result.rows)
        setPageInfo(result.pageInfo)
        setStatus('ready')
      })
      .catch((nextError: unknown) => {
        if (
          abortController.signal.aborted ||
          requestId !== requestIdRef.current
        ) {
          return
        }

        setError(nextError)
        setStatus('error')
      })

    return () => {
      abortController.abort()
    }
  })

  useEffect(() => runLoad(), [query, runLoad])

  return {
    rows,
    pageInfo,
    status,
    error,
    refresh: runLoad,
  }
}
