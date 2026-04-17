"use client"

import { useState, useMemo, useEffect } from 'react'
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
import { Search, ChevronUp, ChevronDown, Filter, MoreHorizontal, ChevronLeft, ChevronRight, Edit } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: keyof T | string
  label: string
  sortable?: boolean
  filterable?: boolean
  filterOptions?: { label: string; value: string }[]
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
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<Record<string, string>>({})
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
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') {
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
  }, [data, search, searchKeys, filters, sortKey, sortDirection])

  // Pagination
  const totalPages = Math.ceil(filteredData.length / pageSize)
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

  const rootClass = fillContainer
    ? 'flex min-h-0 flex-1 flex-col gap-3'
    : 'space-y-4'

  return (
    <div className={rootClass}>
      {/* Search and Filters */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
        {searchKeys.length > 0 && (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9"
            />
          </div>
        )}
        
        {filterableColumns.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {filterableColumns.map((col) => (
              <Select
                key={String(col.key)}
                value={filters[String(col.key)] || 'all'}
                onValueChange={(value) => handleFilter(String(col.key), value)}
              >
                <SelectTrigger className="w-[140px]">
                  <Filter className="h-4 w-4 mr-2" />
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
        )}
      </div>

      {/* Table */}
      <div
        className={
          fillContainer
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border'
            : 'overflow-hidden rounded-lg border'
        }
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
                    <TableCell className="text-right">
                      {(() => {
                        const visibleActions = actions.filter((action) => !action.visible || action.visible(row))
                        if (visibleActions.length === 0 && !onEditClick) return null
                        return (
                          <div className="flex items-center justify-end gap-1">
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
                      })()}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, filteredData.length)} of{' '}
            {filteredData.length} results
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
