import {
  createEmptyRowStore,
  mergeWindows,
  normalizeWindow,
  subtractWindows,
} from './windowing'
import type {
  GridContainerState,
  GridLoadTarget,
  GridNode,
  GridNodeId,
  GridNodeStore,
  GridPlaceholderNode,
  GridRowId,
  GridRowRevision,
  GridVisibleNode,
  GridVisibleRow,
  GridWindow,
} from './types'

export const ROOT_CONTAINER_KEY = '__root__'

export function getContainerKey(ownerNodeId: GridNodeId | null): string {
  return ownerNodeId ?? ROOT_CONTAINER_KEY
}

function createEmptyContainer(
  ownerNodeId: GridNodeId | null,
): GridContainerState {
  return {
    ownerNodeId,
    nodesByIndex: new Map<number, GridNodeId>(),
    loadedWindows: [],
    staleWindows: [],
    childCount: null,
    hasNextPage: null,
  }
}

function removeCoveredWindows(
  windows: readonly GridWindow[],
  covered: readonly GridWindow[],
): GridWindow[] {
  return windows.flatMap((window) => subtractWindows(window, covered))
}

function inferChildCount(container: GridContainerState): number | null {
  if (container.childCount !== null) {
    return container.childCount
  }

  let maxIndex = -1
  for (const index of container.nodesByIndex.keys()) {
    maxIndex = Math.max(maxIndex, index)
  }

  return maxIndex === -1 ? null : maxIndex + 1
}

function createPlaceholderNode(
  ownerNodeId: GridNodeId | null,
  depth: number,
  childIndex: number | null,
  placeholder: GridPlaceholderNode['placeholder'],
): GridPlaceholderNode {
  return {
    kind: 'placeholder',
    nodeId: `placeholder:${ownerNodeId ?? ROOT_CONTAINER_KEY}:${childIndex ?? 'pending'}`,
    parentNodeId: ownerNodeId,
    depth,
    isExpanded: false,
    isExpandable: false,
    childCount: null,
    ownerNodeId,
    childIndex,
    placeholder,
  }
}

function resolveNode<TData>(
  store: GridNodeStore<TData>,
  expandedNodeIds: ReadonlySet<GridNodeId>,
  node: GridNode<TData>,
): GridNode<TData> {
  if (node.kind === 'placeholder') {
    return node
  }

  const container = store.containers.get(getContainerKey(node.nodeId))
  const childCount = container?.childCount ?? node.childCount
  const isExpandable =
    node.isExpandable ||
    (childCount !== null && childCount > 0) ||
    container !== undefined

  return {
    ...node,
    childCount,
    isExpandable,
    isExpanded: isExpandable && expandedNodeIds.has(node.nodeId),
  }
}

function deleteNodeSubtree<TData>(
  nodesById: Map<GridNodeId, GridNode<TData>>,
  nodeIdByRowId: Map<GridRowId, GridNodeId>,
  locationByNodeId: Map<
    GridNodeId,
    {
      ownerNodeId: GridNodeId | null
      index: number
    }
  >,
  revisionsByRowId: Map<GridRowId, GridRowRevision>,
  containers: Map<string, GridContainerState>,
  nodeId: GridNodeId,
) {
  const node = nodesById.get(nodeId)
  if (!node) {
    return
  }

  const childContainerKey = getContainerKey(nodeId)
  const childContainer = containers.get(childContainerKey)
  if (childContainer) {
    for (const childNodeId of childContainer.nodesByIndex.values()) {
      deleteNodeSubtree(
        nodesById,
        nodeIdByRowId,
        locationByNodeId,
        revisionsByRowId,
        containers,
        childNodeId,
      )
    }
    containers.delete(childContainerKey)
  }

  nodesById.delete(nodeId)
  locationByNodeId.delete(nodeId)

  if (node.kind === 'leaf' || node.kind === 'tree') {
    if (nodeIdByRowId.get(node.rowId) === nodeId) {
      nodeIdByRowId.delete(node.rowId)
    }
    revisionsByRowId.delete(node.rowId)
  }
}

export function createEmptyNodeStore<TData>(): GridNodeStore<TData> {
  return {
    nodesById: new Map<GridNodeId, GridNode<TData>>(),
    nodeIdByRowId: new Map<GridRowId, GridNodeId>(),
    locationByNodeId: new Map<
      GridNodeId,
      {
        ownerNodeId: GridNodeId | null
        index: number
      }
    >(),
    revisionsByRowId: new Map<GridRowId, GridRowRevision>(),
    containers: new Map<string, GridContainerState>([
      [ROOT_CONTAINER_KEY, createEmptyContainer(null)],
    ]),
  }
}

export function clearNodeStore<TData>(): GridNodeStore<TData> {
  return createEmptyNodeStore<TData>()
}

export function getContainerState<TData>(
  store: GridNodeStore<TData>,
  ownerNodeId: GridNodeId | null,
): GridContainerState {
  return (
    store.containers.get(getContainerKey(ownerNodeId)) ??
    createEmptyContainer(ownerNodeId)
  )
}

export function getNodeById<TData>(
  store: GridNodeStore<TData>,
  nodeId: GridNodeId,
): GridNode<TData> | null {
  return store.nodesById.get(nodeId) ?? null
}

export function getNodeByRowId<TData>(
  store: GridNodeStore<TData>,
  rowId: GridRowId,
): GridNode<TData> | null {
  const nodeId = store.nodeIdByRowId.get(rowId)
  return nodeId ? (store.nodesById.get(nodeId) ?? null) : null
}

export function upsertNodeStoreWindow<TData>(
  store: GridNodeStore<TData>,
  target: GridLoadTarget,
  nodes: readonly GridNode<TData>[],
  options: {
    totalChildren: number | null
    hasNextPage?: boolean
  },
): GridNodeStore<TData> {
  const ownerNodeId =
    target.kind === 'children-window' ? target.parentNodeId : null
  const containerKey = getContainerKey(ownerNodeId)
  const currentContainer = getContainerState(store, ownerNodeId)
  const nextNodesById = new Map(store.nodesById)
  const nextNodeIdByRowId = new Map(store.nodeIdByRowId)
  const nextLocationByNodeId = new Map(store.locationByNodeId)
  const nextRevisionsByRowId = new Map(store.revisionsByRowId)
  const nextContainers = new Map(store.containers)
  const nextContainerNodesByIndex = new Map(currentContainer.nodesByIndex)
  const window = normalizeWindow(target.window)
  const incomingNodeIds = new Set(nodes.map((node) => node.nodeId))

  for (let index = window.start; index < window.end; index += 1) {
    const previousNodeId = nextContainerNodesByIndex.get(index)
    if (!previousNodeId) {
      continue
    }

    nextLocationByNodeId.delete(previousNodeId)
    nextContainerNodesByIndex.delete(index)

    if (!incomingNodeIds.has(previousNodeId)) {
      deleteNodeSubtree(
        nextNodesById,
        nextNodeIdByRowId,
        nextLocationByNodeId,
        nextRevisionsByRowId,
        nextContainers,
        previousNodeId,
      )
    }
  }

  nodes.forEach((node, offset) => {
    const index = window.start + offset
    const parentNodeId = ownerNodeId
    const normalizedNode: GridNode<TData> =
      node.kind === 'placeholder'
        ? {
            ...node,
            parentNodeId,
          }
        : {
            ...node,
            parentNodeId,
          }
    const previousNode = nextNodesById.get(normalizedNode.nodeId)

    if (
      previousNode &&
      (previousNode.kind === 'leaf' || previousNode.kind === 'tree') &&
      ((normalizedNode.kind !== 'leaf' && normalizedNode.kind !== 'tree') ||
        previousNode.rowId !== normalizedNode.rowId)
    ) {
      if (nextNodeIdByRowId.get(previousNode.rowId) === previousNode.nodeId) {
        nextNodeIdByRowId.delete(previousNode.rowId)
      }
      nextRevisionsByRowId.delete(previousNode.rowId)
    }

    nextNodesById.set(normalizedNode.nodeId, normalizedNode)
    nextContainerNodesByIndex.set(index, normalizedNode.nodeId)
    nextLocationByNodeId.set(normalizedNode.nodeId, {
      ownerNodeId,
      index,
    })

    if (normalizedNode.kind === 'leaf' || normalizedNode.kind === 'tree') {
      nextNodeIdByRowId.set(normalizedNode.rowId, normalizedNode.nodeId)
      if (normalizedNode.revision !== undefined) {
        nextRevisionsByRowId.set(normalizedNode.rowId, normalizedNode.revision)
      } else {
        nextRevisionsByRowId.delete(normalizedNode.rowId)
      }
    }
  })

  nextContainers.set(containerKey, {
    ownerNodeId,
    nodesByIndex: nextContainerNodesByIndex,
    loadedWindows: mergeWindows([
      ...currentContainer.loadedWindows,
      {
        start: window.start,
        end: window.start + nodes.length,
      },
    ]),
    staleWindows: removeCoveredWindows(currentContainer.staleWindows, [
      {
        start: window.start,
        end: window.start + nodes.length,
      },
    ]),
    childCount: options.totalChildren,
    hasNextPage: options.hasNextPage ?? currentContainer.hasNextPage,
  })

  return {
    nodesById: nextNodesById,
    nodeIdByRowId: nextNodeIdByRowId,
    locationByNodeId: nextLocationByNodeId,
    revisionsByRowId: nextRevisionsByRowId,
    containers: nextContainers,
  }
}

export function updateStoredNode<TData>(
  store: GridNodeStore<TData>,
  nodeId: GridNodeId,
  node: GridNode<TData>,
): GridNodeStore<TData> {
  if (!store.nodesById.has(nodeId)) {
    return store
  }

  const nextNodesById = new Map(store.nodesById)
  const nextNodeIdByRowId = new Map(store.nodeIdByRowId)
  const nextRevisionsByRowId = new Map(store.revisionsByRowId)
  nextNodesById.set(nodeId, node)

  if (node.kind === 'leaf' || node.kind === 'tree') {
    nextNodeIdByRowId.set(node.rowId, node.nodeId)
    if (node.revision !== undefined) {
      nextRevisionsByRowId.set(node.rowId, node.revision)
    } else {
      nextRevisionsByRowId.delete(node.rowId)
    }
  }

  return {
    ...store,
    nodesById: nextNodesById,
    nodeIdByRowId: nextNodeIdByRowId,
    revisionsByRowId: nextRevisionsByRowId,
  }
}

export function removeStoredNode<TData>(
  store: GridNodeStore<TData>,
  nodeId: GridNodeId,
): GridNodeStore<TData> {
  const location = store.locationByNodeId.get(nodeId)
  const node = store.nodesById.get(nodeId)
  if (!location || !node) {
    return store
  }

  const nextNodesById = new Map(store.nodesById)
  const nextNodeIdByRowId = new Map(store.nodeIdByRowId)
  const nextLocationByNodeId = new Map(store.locationByNodeId)
  const nextRevisionsByRowId = new Map(store.revisionsByRowId)
  const nextContainers = new Map(store.containers)
  const containerKey = getContainerKey(location.ownerNodeId)
  const currentContainer = getContainerState(store, location.ownerNodeId)
  const nextContainerNodesByIndex = new Map(currentContainer.nodesByIndex)

  nextContainerNodesByIndex.delete(location.index)
  deleteNodeSubtree(
    nextNodesById,
    nextNodeIdByRowId,
    nextLocationByNodeId,
    nextRevisionsByRowId,
    nextContainers,
    nodeId,
  )

  nextContainers.set(containerKey, {
    ...currentContainer,
    nodesByIndex: nextContainerNodesByIndex,
  })

  return {
    nodesById: nextNodesById,
    nodeIdByRowId: nextNodeIdByRowId,
    locationByNodeId: nextLocationByNodeId,
    revisionsByRowId: nextRevisionsByRowId,
    containers: nextContainers,
  }
}

export function markContainerWindowStale<TData>(
  store: GridNodeStore<TData>,
  ownerNodeId: GridNodeId | null,
  windows: readonly GridWindow[],
): GridNodeStore<TData> {
  const containerKey = getContainerKey(ownerNodeId)
  const container = getContainerState(store, ownerNodeId)
  const nextContainers = new Map(store.containers)

  nextContainers.set(containerKey, {
    ...container,
    staleWindows: mergeWindows([...container.staleWindows, ...windows]),
  })

  return {
    ...store,
    containers: nextContainers,
  }
}

export function getVisibleProjection<TData>(
  store: GridNodeStore<TData>,
  expandedNodeIds: ReadonlySet<GridNodeId>,
): {
  rows: GridVisibleRow<TData>[]
  nodes: GridVisibleNode<TData>[]
  totalVisibleCount: number
} {
  const rows: GridVisibleRow<TData>[] = []
  const nodes: GridVisibleNode<TData>[] = []

  const appendContainer = (ownerNodeId: GridNodeId | null, depth: number) => {
    const container = getContainerState(store, ownerNodeId)
    const childCount = inferChildCount(container)

    if (
      ownerNodeId !== null &&
      childCount === null &&
      container.loadedWindows.length === 0
    ) {
      const placeholder = createPlaceholderNode(
        ownerNodeId,
        depth,
        null,
        'loading',
      )
      const visibleIndex = rows.length
      rows.push({
        index: visibleIndex,
        isLoaded: false,
        row: null,
        canonicalRow: null,
        rowId: null,
        nodeId: placeholder.nodeId,
        node: placeholder,
        kind: placeholder.kind,
        depth: placeholder.depth,
        isExpandable: false,
        isExpanded: false,
      })
      nodes.push({
        visibleIndex,
        node: placeholder,
        row: null,
        canonicalRow: null,
        rowId: null,
      })
      return
    }

    const effectiveChildCount = childCount ?? 0
    for (let index = 0; index < effectiveChildCount; index += 1) {
      const nodeId = container.nodesByIndex.get(index)
      const baseNode = nodeId ? (store.nodesById.get(nodeId) ?? null) : null
      const node =
        baseNode === null
          ? createPlaceholderNode(ownerNodeId, depth, index, 'loading')
          : resolveNode(store, expandedNodeIds, baseNode)
      const rowId =
        node.kind === 'leaf' || node.kind === 'tree' ? node.rowId : null
      const row = node.kind === 'leaf' || node.kind === 'tree' ? node.row : null
      const visibleIndex = rows.length

      rows.push({
        index: visibleIndex,
        isLoaded: node.kind !== 'placeholder',
        row,
        canonicalRow: row,
        rowId,
        nodeId: node.nodeId,
        node,
        kind: node.kind,
        depth: node.depth,
        isExpandable: node.isExpandable,
        isExpanded: node.isExpanded,
        aggregates: node.aggregates,
      })
      nodes.push({
        visibleIndex,
        node,
        row,
        canonicalRow: row,
        rowId,
      })

      if (node.kind !== 'placeholder' && node.isExpandable && node.isExpanded) {
        appendContainer(node.nodeId, node.depth + 1)
      }
    }
  }

  appendContainer(null, 0)

  return {
    rows,
    nodes,
    totalVisibleCount: rows.length,
  }
}

export function getVisiblePlaceholders<TData>(
  rows: readonly GridVisibleRow<TData>[],
): Array<{
  ownerNodeId: GridNodeId | null
  index: number
}> {
  const placeholders: Array<{
    ownerNodeId: GridNodeId | null
    index: number
  }> = []

  for (const row of rows) {
    if (row.node.kind !== 'placeholder' || row.node.childIndex === null) {
      continue
    }

    placeholders.push({
      ownerNodeId: row.node.ownerNodeId,
      index: row.node.childIndex,
    })
  }

  return placeholders
}

export function toLegacyRowStore<TData>(
  rows: readonly GridVisibleRow<TData>[],
): ReturnType<typeof createEmptyRowStore<TData>> {
  const nextStore = createEmptyRowStore<TData>()
  const rowsByIndex = new Map(nextStore.rowsByIndex)
  const indexByRowId = new Map(nextStore.indexByRowId)
  const revisionsByRowId = new Map(nextStore.revisionsByRowId)

  for (const row of rows) {
    if (row.row === null || row.rowId === null) {
      continue
    }

    const revision =
      row.node.kind === 'leaf' || row.node.kind === 'tree'
        ? row.node.revision
        : undefined
    rowsByIndex.set(row.index, {
      row: row.row,
      rowId: row.rowId,
      revision,
    })
    indexByRowId.set(row.rowId, row.index)
    if (revision !== undefined) {
      revisionsByRowId.set(row.rowId, revision)
    }
  }

  return {
    rowsByIndex,
    indexByRowId,
    revisionsByRowId,
    loadedWindows:
      rows.length > 0
        ? [
            {
              start: rows[0].index,
              end: rows[rows.length - 1].index + 1,
            },
          ]
        : [],
    staleWindows: [],
  }
}
