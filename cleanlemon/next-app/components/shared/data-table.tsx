"use client"

import { useState, useMemo, useEffect, type ReactNode } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Search,
  ChevronUp,
  ChevronDown,
  ListFilter,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Edit,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

export interface Column<T> {
  key: keyof T | string
  label: string
  sortable?: boolean
  filterable?: boolean
  filterOptions?: { label: string; value: string }[]
  /** When set, overrides default `String(row[key]) === value` filter matching. */
  filterMatch?: (row: T, filterValue: string) => boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

export interface Action<T> {
  label: string
  onClick: (row: T) => void
  icon?: React.ReactNode
  variant?: 'default' | 'destructive'
  visible?: (row: T) => boolean
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  actions?: Action<T>[]
  /** Outline edit button before the ⋮ menu (matches operator property table UX). */
  onEditClick?: (row: T) => void
  searchKeys?: (keyof T)[]
  pageSize?: number
  emptyMessage?: string
  /**
   * Fill parent flex column and scroll the table body only (reduces full-page scroll on dense portal pages).
   * Parent should be a flex column with min-h-0 / flex-1.
   */
  fillContainer?: boolean
  /** Optional row checkboxes (controlled by parent). */
  rowSelection?: {
    selectedIds: ReadonlySet<string>
    onSelectionChange: (next: Set<string>) => void
    /** If provided, rows where this returns false show a disabled checkbox. */
    isRowSelectable?: (row: T) => boolean
  }
  /** Avoid horizontal scrollbar; use with truncated cell content. */
  noHorizontalScroll?: boolean
  /** Keep filter dropdowns on one row (overflow-x scroll on narrow screens). */
  nowrapFilters?: boolean
  /** Search + Filter button; expanded panel matches client/damage (bg-muted/30, wrap selects). */
  collapsibleFilters?: boolean
  /** Extra controls (e.g. archive scope) rendered inside the expanded filter panel before column filters. */
  collapsibleFilterExtra?: ReactNode
  /** When true, Filter button shows active dot (e.g. non-default archive scope). */
  collapsibleFiltersExtraActive?: boolean
  /** Renders below the table (and below pagination when shown). */
  pageSizeSelect?: {
    value: number
    onChange: (n: number) => void
    options: number[]
    id?: string
  }
  /**
   * Below `md`, render each row as a stacked card (label + value) instead of a table — avoids horizontal scroll.
   */
  stackedOnNarrow?: boolean
  /** Placed after the search field in the same row (e.g. Filter button). */
  toolbarEnd?: ReactNode
  /** Renders below the search row, before column filters / table (e.g. expanded filter panel). */
  toolbarBelowSearch?: ReactNode
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  actions,
  onEditClick,
  searchKeys = [],
  pageSize = 10,
  emptyMessage = 'No data found',
  fillContainer = false,
  rowSelection,
  noHorizontalScroll = false,
  nowrapFilters = false,
  collapsibleFilters = false,
  collapsibleFilterExtra,
  collapsibleFiltersExtraActive = false,
  pageSizeSelect,
  stackedOnNarrow = false,
  toolbarEnd,
  toolbarBelowSearch,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setCurrentPage(1)
  }, [pageSize])

  // Filter and search
  const filteredData = useMemo(() => {
    let result = [...data]

    // Apply search
    if (search && searchKeys.length > 0) {
      const searchLower = search.toLowerCase()
      result = result.filter((row) =>
        searchKeys.some((key) => {
          const value = row[key]
          return String(value).toLowerCase().includes(searchLower)
        })
      )
    }

    // Apply filters
    columns.forEach((col) => {
      if (!col.filterable || !col.filterOptions?.length) return
      const key = String(col.key)
      const value = filters[key]
      if (!value || value === 'all') return
      if (col.filterMatch) {
        result = result.filter((row) => col.filterMatch!(row, value))
      } else {
        result = result.filter((row) => {
          const rowValue = (row as Record<string, unknown>)[key]
          return String(rowValue) === value
        })
      }
    })

    // Apply sorting
    if (sortKey) {
      result.sort((a, b) => {
        const aValue = (a as Record<string, unknown>)[sortKey]
        const bValue = (b as Record<string, unknown>)[sortKey]
        
        if (aValue === bValue) return 0
        
        const comparison = aValue! < bValue! ? -1 : 1
        return sortDirection === 'asc' ? comparison : -comparison
      })
    }

    return result
  }, [data, search, searchKeys, filters, sortKey, sortDirection, columns])

  useEffect(() => {
    const tp = Math.ceil(filteredData.length / pageSize)
    if (tp < 1) return
    setCurrentPage((p) => (p > tp ? tp : p))
  }, [filteredData.length, pageSize])

  // Pagination (when no rows, totalPages is 1 for safe math; empty-state footer is hidden)
  const totalPages =
    filteredData.length === 0 ? 1 : Math.max(1, Math.ceil(filteredData.length / pageSize))
  const paginatedData = filteredData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const handleFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setCurrentPage(1)
  }

  const filterableColumns = columns.filter((col) => col.filterable && col.filterOptions)

  const hasActiveColumnFilters = useMemo(
    () =>
      Object.entries(filters).some(([, v]) => v && v !== 'all') ||
      Boolean(collapsibleFiltersExtraActive),
    [filters, collapsibleFiltersExtraActive]
  )

  /** Inline filters (no collapsible panel) — same dropdowns as expanded card, without duplicate filter icons. */
  const filterSelects = (
    <div
      className={cn(
        'min-w-0 w-full gap-2',
        nowrapFilters
          ? 'flex flex-nowrap overflow-x-auto pb-0.5'
          : filterableColumns.length === 1
            ? 'grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center'
            : 'grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center'
      )}
    >
      {filterableColumns.map((col) => (
        <Select
          key={String(col.key)}
          value={filters[String(col.key)] || 'all'}
          onValueChange={(value) => handleFilter(String(col.key), value)}
        >
          <SelectTrigger
            className={cn(
              'h-9 border-input',
              nowrapFilters
                ? 'min-w-[140px] shrink-0 sm:min-w-[160px] sm:w-[180px]'
                : 'min-w-0 w-full max-w-none sm:min-w-[140px] sm:max-w-[min(100vw-2rem,240px)] sm:w-[180px]'
            )}
          >
            <SelectValue placeholder={col.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {col.label}</SelectItem>
            {col.filterOptions?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  )

  const pageSelectableRows = useMemo(
    () =>
      rowSelection
        ? paginatedData.filter((row) => !rowSelection.isRowSelectable || rowSelection.isRowSelectable(row))
        : [],
    [paginatedData, rowSelection]
  )
  const pageSelectableIds = useMemo(() => pageSelectableRows.map((r) => r.id), [pageSelectableRows])
  const allPageSelectableSelected =
    pageSelectableIds.length > 0 && pageSelectableIds.every((id) => rowSelection?.selectedIds.has(id))
  const somePageSelectableSelected = pageSelectableIds.some((id) => rowSelection?.selectedIds.has(id))

  const togglePageSelectable = () => {
    if (!rowSelection) return
    const next = new Set(rowSelection.selectedIds)
    if (allPageSelectableSelected) {
      pageSelectableIds.forEach((id) => next.delete(id))
    } else {
      pageSelectableIds.forEach((id) => next.add(id))
    }
    rowSelection.onSelectionChange(next)
  }

  const colSpan =
    columns.length + (rowSelection ? 1 : 0) + (actions && actions.length > 0 ? 1 : 0)

  const renderRowActions = (row: T) => {
    if (!actions || actions.length === 0) {
      return onEditClick ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg"
          title="Edit"
          onClick={() => onEditClick(row)}
        >
          <Edit className="h-4 w-4" />
        </Button>
      ) : null
    }
    const visibleActions = actions.filter((action) => !action.visible || action.visible(row))
    if (visibleActions.length === 0 && !onEditClick) return null
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {onEditClick ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg"
            title="Edit"
            onClick={() => onEditClick(row)}
          >
            <Edit className="h-4 w-4" />
          </Button>
        ) : null}
        {visibleActions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {visibleActions.map((action, idx) => (
                <DropdownMenuItem
                  key={idx}
                  onClick={() => action.onClick(row)}
                  className={action.variant === 'destructive' ? 'text-destructive' : ''}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    )
  }

  const rootClass = fillContainer
    ? 'flex min-h-0 flex-1 flex-col gap-3'
    : 'space-y-4'

  return (
    <div className={rootClass}>
      {/* Search + Filter — matches client/damage: toggle button; expanded = bg-muted/30 + wrap selects */}
      <div className="flex shrink-0 flex-col gap-3">
        {collapsibleFilters && (filterableColumns.length > 0 || collapsibleFilterExtra) ? (
          <div className="flex flex-col gap-3">
            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              {searchKeys.length > 0 ? (
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="h-10 border-input pl-9"
                  />
                </div>
              ) : null}
              <Button
                type="button"
                variant={filtersOpen ? 'secondary' : 'outline'}
                className={cn('h-10 shrink-0', searchKeys.length === 0 && 'w-full sm:w-auto')}
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
              >
                <ListFilter className="h-4 w-4 mr-2" />
                Filter
                {hasActiveColumnFilters ? (
                  <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
                ) : null}
              </Button>
            </div>
            {filtersOpen ? (
              <div className="w-full min-w-0 rounded-lg border bg-muted/30 p-4">
                <div className="grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
                  {collapsibleFilterExtra ? (
                    <div className="min-w-0 [&_button]:h-10 [&_button]:w-full">{collapsibleFilterExtra}</div>
                  ) : null}
                  {filterableColumns.map((col) => (
                    <Select
                      key={String(col.key)}
                      value={filters[String(col.key)] || 'all'}
                      onValueChange={(value) => handleFilter(String(col.key), value)}
                    >
                      <SelectTrigger className="h-10 w-full min-w-0 border-input">
                        <SelectValue placeholder={col.label} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All {col.label}</SelectItem>
                        {col.filterOptions?.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {searchKeys.length > 0 ? (
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setCurrentPage(1)
                    }}
                    className={cn('border-input pl-9', toolbarEnd != null && 'h-10')}
                  />
                </div>
              ) : null}
              {toolbarEnd}
            </div>
            {toolbarBelowSearch}
            {filterableColumns.length > 0 ? filterSelects : null}
          </>
        )}
      </div>

      {/* Stacked cards — narrow screens only */}
      {stackedOnNarrow ? (
        <div className="md:hidden space-y-3">
          {paginatedData.length === 0 ? (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            paginatedData.map((row) => (
              <div
                key={row.id}
                className="space-y-3 rounded-lg border bg-card p-4 shadow-sm"
              >
                {rowSelection ? (
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <Checkbox
                      checked={rowSelection.selectedIds.has(row.id)}
                      disabled={
                        rowSelection.isRowSelectable ? !rowSelection.isRowSelectable(row) : false
                      }
                      onCheckedChange={(c) => {
                        const selectable =
                          !rowSelection.isRowSelectable || rowSelection.isRowSelectable(row)
                        if (!selectable) return
                        const next = new Set(rowSelection.selectedIds)
                        if (c === true) next.add(row.id)
                        else next.delete(row.id)
                        rowSelection.onSelectionChange(next)
                      }}
                      aria-label="Select row"
                    />
                    <span className="text-xs text-muted-foreground">Select</span>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {columns.map((col) => {
                    const raw = (row as Record<string, unknown>)[String(col.key)]
                    const content = col.render
                      ? col.render(raw as T[keyof T], row)
                      : String(raw ?? '-')
                    return (
                      <div key={`${row.id}-${String(col.key)}`} className="min-w-0 space-y-1">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {col.label}
                        </p>
                        <div className="min-w-0 break-words text-sm">{content}</div>
                      </div>
                    )
                  })}
                </div>
                {(actions && actions.length > 0) || onEditClick ? (
                  <div className="flex justify-end border-t border-border pt-3">{renderRowActions(row)}</div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* Table */}
      <div
        className={cn(
          fillContainer
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border'
            : 'overflow-hidden rounded-lg border',
          stackedOnNarrow && 'hidden md:block'
        )}
      >
        <div
          className={
            fillContainer
              ? noHorizontalScroll
                ? 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden'
                : 'min-h-0 flex-1 overflow-auto'
              : 'contents'
          }
        >
        <Table
          className={noHorizontalScroll ? 'table-fixed' : undefined}
          containerClassName={noHorizontalScroll ? 'overflow-x-hidden min-w-0' : undefined}
        >
          <TableHeader>
            <TableRow className="bg-muted/50">
              {rowSelection ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      pageSelectableIds.length === 0
                        ? false
                        : allPageSelectableSelected
                          ? true
                          : somePageSelectableSelected
                            ? 'indeterminate'
                            : false
                    }
                    onCheckedChange={() => togglePageSelectable()}
                    disabled={pageSelectableIds.length === 0}
                    aria-label="Select all on this page"
                  />
                </TableHead>
              ) : null}
              {columns.map((col) => (
                <TableHead
                  key={String(col.key)}
                  className={cn(
                    col.sortable ? 'cursor-pointer select-none' : '',
                    noHorizontalScroll && 'whitespace-normal min-w-0'
                  )}
                  onClick={() => col.sortable && handleSort(String(col.key))}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === String(col.key) && (
                      sortDirection === 'asc' ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )
                    )}
                  </div>
                </TableHead>
              ))}
              {actions && actions.length > 0 && (
                <TableHead className={onEditClick ? 'w-[120px] text-right' : 'w-[60px] text-right'}>Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row) => (
                <TableRow key={row.id}>
                  {rowSelection ? (
                    <TableCell className="w-10">
                      {(() => {
                        const selectable =
                          !rowSelection.isRowSelectable || rowSelection.isRowSelectable(row)
                        return (
                          <Checkbox
                            checked={rowSelection.selectedIds.has(row.id)}
                            disabled={!selectable}
                            onCheckedChange={(c) => {
                              if (!selectable) return
                              const next = new Set(rowSelection.selectedIds)
                              if (c === true) next.add(row.id)
                              else next.delete(row.id)
                              rowSelection.onSelectionChange(next)
                            }}
                            aria-label="Select row"
                          />
                        )
                      })()}
                    </TableCell>
                  ) : null}
                  {columns.map((col) => (
                    <TableCell
                      key={`${row.id}-${String(col.key)}`}
                      className={noHorizontalScroll ? 'whitespace-normal break-words min-w-0' : undefined}
                    >
                      {col.render
                        ? col.render((row as Record<string, unknown>)[String(col.key)] as T[keyof T], row)
                        : String((row as Record<string, unknown>)[String(col.key)] ?? '-')}
                    </TableCell>
                  ))}
                  {actions && actions.length > 0 && (
                    <TableCell className="text-right">{renderRowActions(row)}</TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Pagination + page size — always at bottom when there are rows */}
      {filteredData.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-muted-foreground order-2 lg:order-1">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} results
            </p>
            <div className="order-1 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:order-2">
              <div className="flex items-center justify-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || totalPages <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[7rem] text-center text-sm tabular-nums">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages <= 1}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {pageSizeSelect ? (
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                  <Label
                    htmlFor={pageSizeSelect.id || 'data-table-page-size'}
                    className="text-sm text-muted-foreground whitespace-nowrap"
                  >
                    Show
                  </Label>
                  <Select
                    value={String(pageSizeSelect.value)}
                    onValueChange={(v) => {
                      const n = Number(v) || pageSizeSelect.options[0] || 10
                      pageSizeSelect.onChange(n)
                    }}
                  >
                    <SelectTrigger id={pageSizeSelect.id || 'data-table-page-size'} className="h-9 w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pageSizeSelect.options.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">per page</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
