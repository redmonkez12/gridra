# Gridra

A headless, server-first grid engine for React.

`gridra` exists for teams that do not want a client-side table pretending to be a database. It gives you a small, stable engine for query state, selection, hierarchy, caching, editing, and live updates, while letting your backend stay the source of truth and your UI stay yours.

## Positioning

### What It Is

`gridra` is a headless, server-first grid engine for React.

It is built for products where the backend owns filtering, sorting, pagination, grouping, and tree expansion, and where the UI needs to stay application-specific.

### Who It Is For

Teams working with:

- large datasets
- server-driven filtering and sorting
- realtime updates
- hierarchical data

### What It Is Not

`gridra` is not:

- an Excel clone
- a batteries-included design system grid
- optimized for tiny in-memory tables

## Why This Exists

Most React grids optimize for one of two extremes:

- batteries-included table components that own your markup, styling, and interaction model
- client-first table libraries that assume the full dataset is already in memory

This project takes a different position:

- server-first by default, so sorting, filtering, pagination, grouping, and tree expansion can stay backend-driven
- headless by design, so you keep control over markup, styling, accessibility, and product-specific UX
- narrow public API, so the surface area stays understandable and supportable

If you are building internal tools, admin products, operator consoles, or realtime back-office views with large datasets, that tradeoff is usually better than a prettier but more opinionated grid.

## Feature Highlights

- Server-side sorting, filtering, pagination, and row-window loading
- Flat rows, grouped results, and tree data through the same controller model
- Virtualization-friendly state for large datasets
- Abortable requests with late-response protection
- Sparse caching for offset windows and hierarchical node windows
- Live row patches and invalidation hooks for realtime updates
- Controlled or uncontrolled query, selection, and column state
- Row selection including "select all matching" semantics
- Inline editing hooks for editable data sources
- URL serialization and `useGridUrlSync` for shareable grid state

## Installation

For app usage, install the React package:

```bash
npm install @gridra/react react
```

`@gridra/core` is installed as a dependency of `@gridra/react`. Install it directly only if you want the framework-agnostic primitives.

If you are working in this repository:

```bash
npm install --cache .npm-cache
```

## Quickstart

The smallest working setup is a data source, a column list, and your own renderer:

```tsx
import { useDataGrid, useGridRows } from '@gridra/react'

type User = {
  id: string
  name: string
  company: string
}

const columns = [
  { id: 'name', header: 'Name', accessor: 'name', sortable: true },
  { id: 'company', header: 'Company', accessor: 'company' },
] as const

const dataSource = {
  async load(query, context) {
    const params = new URLSearchParams({
      offset: String(query.slice.kind === 'offset' ? query.slice.offset : 0),
      limit: String(query.slice.limit),
    })

    const response = await fetch(`/api/users?${params}`, {
      signal: context.signal,
    })
    const data = await response.json()

    return {
      rows: data.rows,
      pageInfo: {
        kind: 'offset',
        totalRowCount: data.total,
        hasNextPage: data.hasNextPage,
      },
    }
  },
}

export function UsersGrid() {
  const grid = useDataGrid<User>({
    columns,
    dataSource,
    getRowId: (row: User) => row.id,
  })
  const rows = useGridRows(grid)

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Company</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) =>
          entry.row && entry.rowId !== null ? (
            <tr key={entry.rowId}>
              <td>{entry.row.name}</td>
              <td>{entry.row.company}</td>
            </tr>
          ) : (
            <tr key={`loading-${entry.index}`}>
              <td colSpan={2}>Loading...</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  )
}
```

`useGridRows()` can include placeholder entries while a requested window is still loading, so renderers should handle `entry.row === null`.

## Server-First Example

The grid is designed around backend-owned query execution. Your server receives query state, returns just the requested slice, and can optionally support hierarchy, editing, and live updates.

```tsx
import { createCachedDataSource } from '@gridra/core'
import { useDataGrid, useGridUrlSync } from '@gridra/react'

type Order = {
  id: string
}

const dataSource = createCachedDataSource(
  {
    async load(query, context) {
      const response = await fetch('/api/orders/search', {
        method: 'POST',
        signal: context.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
      })

      return response.json()
    },
  },
  undefined,
  {
    getRowId: (row: Order) => row.id,
    staleTimeMs: 1500,
  },
)

function OrdersGrid() {
  const grid = useDataGrid<Order>({
    columns,
    dataSource,
    getRowId: (row: Order) => row.id,
    virtualization: {
      enabled: true,
      rowHeight: 42,
      overscan: 10,
    },
  })

  useGridUrlSync(grid)

  return <YourOwnGridUI grid={grid} />
}
```

That pattern is the core differentiator:

- the backend stays authoritative
- the grid understands large, partial, and changing datasets
- rendering remains fully application-owned

## How It Differs From Existing Grids

- Unlike batteries-included grids, this project does not ship a public renderer, theme, or design system.
- Unlike client-first table libraries, query execution is modeled as remote by default.
- Unlike broad grid platforms, the supported OSS surface is intentionally small: package root exports only.
- Unlike demo-heavy component repos, the reference table in this workspace is private and exists only to validate the public engine.

## Architecture Overview

The project is split into two public layers:

- `@gridra/core`: framework-agnostic query modeling, controller orchestration, caching, selection, hierarchy, editing state, and URL serialization
- `@gridra/react`: React hooks and types for wiring the core engine into application UI

Everything else is deliberately secondary:

- `@gridra/table-reference` is a private workspace package used by the demo and internal tests
- `examples/demo` is a flagship account-risk demo that shows large virtualized datasets, backend-owned query execution, select-all-matching bulk actions, live updates, and optional grouped or tree views

The stable boundary is simple:

- import only from package roots
- rely only on symbols exported from `@gridra/core` and `@gridra/react`
- treat deep imports and the reference renderer as implementation details

## Package Overview

- `@gridra/react`: the package most application teams should start with
- `@gridra/core`: use directly if you need the lower-level controller, cache, serialization, or non-React integration points
- `@gridra/table-reference`: not public, not supported, not part of the product surface

## Supported Today

- Offset-based server pagination and windowed loading
- Column sorting and column or global filtering
- Flat, grouped, and tree query modes
- Selection state and selection requests
- Column visibility and column ordering state
- Virtualization-oriented row snapshots
- URL sync for query and column state
- Live patches, invalidation, and cached reload flows
- Editable data sources with row and cell draft state

## Intentionally Out Of Scope

- A bundled production table component
- Built-in styling, theming, or design tokens
- Client-side full-dataset processing as the primary model
- A kitchen-sink spreadsheet feature set
- Deep-import compatibility guarantees
- Support promises for the private reference renderer

## Roadmap

Current focus is on hardening the public server-first surface before expanding it:

- tighten package-level documentation and examples
- validate more backend patterns against the existing controller model
- keep the public API narrow while the data model stabilizes
- expand demos and tests around grouped, tree, editable, and live datasets

## Contribution Guide

Contributions should preserve the main constraint of the project: a small, stable, server-first public API.

Before opening changes:

```bash
npm install --cache .npm-cache
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run api:check
npm run size:check
```

When contributing:

- prefer changes through public package entrypoints rather than deep internal coupling
- do not treat `@gridra/table-reference` as public API
- keep examples aligned with the supported package surface
- favor product clarity over internal implementation detail in docs

## Versioning Policy

This repository uses SemVer deliberately, including before `1.0.0`.

- `0.1.0` is the first public OSS release
- additive, backwards-compatible feature work increments the minor version, for example `0.2.0`
- intentional API cleanup or other breaking public API changes also require an explicit version bump and changelog entry while the project remains in `0.x`
- `1.0.0` is reserved for the point where the public API is intentionally stable

While the project is in `0.x`, treat every public API change as release-significant rather than informal or ad hoc.

## Release Process

Public API stability is enforced before release:

- `npm run ci` runs lint, formatting checks, typecheck, tests, a full workspace build, API report validation, and tarball size guards
- `npm run api:update` refreshes the checked-in API reports after an intentional public API change
- `npm run changeset` records versionable package changes for `@gridra/core` and `@gridra/react`
- pull requests that change releasable packages are expected to include a changeset, and CI checks for one against `origin/main`
- direct `npm publish` from either public package triggers `prepublishOnly`, which runs the full release verification suite from the workspace root

GitHub Actions mirrors the same flow:

- `.github/workflows/ci.yml` validates every pull request and pushes to `main`
- `.github/workflows/release.yml` uses Changesets on `main` to open or update the version PR, then publish to npm after the versioned release commit lands
- publishing uses the repository `NPM_TOKEN` secret through `actions/setup-node`, so no manual local `npm publish` step is required

## Demo

The repository includes a runnable flagship demo: an account-risk queue with a large virtualized dataset, server-side filtering and sorting, select-all-matching semantics, live patches, and optional grouped or tree views:

```bash
npm install --cache .npm-cache
npm run dev
```
