import {
  createEmptyNodeStore,
  getNodeByRowId,
  upsertNodeStoreWindow,
} from './hierarchy'

describe('@gridra/core hierarchy store', () => {
  it('removes stale row identities and child containers when a window replaces a node', () => {
    let store = createEmptyNodeStore<{ id: string; name: string }>()

    store = upsertNodeStoreWindow(
      store,
      { kind: 'root-window', window: { start: 0, end: 1 } },
      [
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
      { totalChildren: 1, hasNextPage: false },
    )

    store = upsertNodeStoreWindow(
      store,
      {
        kind: 'children-window',
        parentNodeId: 'group:orbit',
        window: { start: 0, end: 1 },
      },
      [
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
      { totalChildren: 1, hasNextPage: false },
    )

    store = upsertNodeStoreWindow(
      store,
      { kind: 'root-window', window: { start: 0, end: 1 } },
      [
        {
          kind: 'group',
          nodeId: 'group:acme',
          parentNodeId: null,
          depth: 0,
          isExpanded: false,
          isExpandable: true,
          childCount: 0,
          groupColumnId: 'company',
          groupKey: 'Acme',
          groupPath: [{ columnId: 'company', value: 'Acme' }],
          descendantRowCount: 0,
        },
      ],
      { totalChildren: 1, hasNextPage: false },
    )

    expect(store.nodesById.has('group:orbit')).toBe(false)
    expect(store.containers.has('group:orbit')).toBe(false)
    expect(getNodeByRowId(store, '1')).toBeNull()
  })

  it('preserves loaded children when the same node id is refreshed in place', () => {
    let store = createEmptyNodeStore<{ id: string; name: string }>()

    store = upsertNodeStoreWindow(
      store,
      { kind: 'root-window', window: { start: 0, end: 1 } },
      [
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
      { totalChildren: 1, hasNextPage: false },
    )

    store = upsertNodeStoreWindow(
      store,
      {
        kind: 'children-window',
        parentNodeId: 'group:orbit',
        window: { start: 0, end: 1 },
      },
      [
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
      { totalChildren: 1, hasNextPage: false },
    )

    store = upsertNodeStoreWindow(
      store,
      { kind: 'root-window', window: { start: 0, end: 1 } },
      [
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
          descendantRowCount: 2,
        },
      ],
      { totalChildren: 1, hasNextPage: false },
    )

    expect(store.containers.has('group:orbit')).toBe(true)
    expect(getNodeByRowId(store, '1')?.nodeId).toBe('leaf:1')
  })
})
