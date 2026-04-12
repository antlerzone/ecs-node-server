"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  Shirt,
  Package,
  Clock,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
} from 'lucide-react'

interface LaundryBatch {
  id: string
  batchNo: string
  property: string
  items: number
  status: 'pending' | 'washing' | 'drying' | 'folding' | 'ready' | 'delivered'
  receivedAt: string
  dueAt: string
}

const mockBatches: LaundryBatch[] = [
  { id: '1', batchNo: 'BATCH-001', property: 'Sunway Velocity', items: 45, status: 'washing', receivedAt: '08:00', dueAt: '14:00' },
  { id: '2', batchNo: 'BATCH-002', property: 'Eco Grandeur', items: 32, status: 'pending', receivedAt: '09:30', dueAt: '15:30' },
  { id: '3', batchNo: 'BATCH-003', property: 'Tropicana Gardens', items: 28, status: 'drying', receivedAt: '07:00', dueAt: '13:00' },
  { id: '4', batchNo: 'BATCH-004', property: 'M Vertica', items: 50, status: 'folding', receivedAt: '06:30', dueAt: '12:30' },
]

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-gray-100 text-gray-700', icon: Clock },
  washing: { label: 'Washing', color: 'bg-blue-100 text-blue-700', icon: RotateCcw },
  drying: { label: 'Drying', color: 'bg-orange-100 text-orange-700', icon: Shirt },
  folding: { label: 'Folding', color: 'bg-purple-100 text-purple-700', icon: Package },
  ready: { label: 'Ready', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  delivered: { label: 'Delivered', color: 'bg-gray-100 text-gray-500', icon: CheckCircle2 },
}

const statusOrder: LaundryBatch['status'][] = ['pending', 'washing', 'drying', 'folding', 'ready', 'delivered']

export default function DobiDashboardPage() {
  const [batches, setBatches] = useState<LaundryBatch[]>(mockBatches)

  const handleNextStatus = (batchId: string) => {
    setBatches(prev => prev.map(batch => {
      if (batch.id === batchId) {
        const currentIndex = statusOrder.indexOf(batch.status)
        if (currentIndex < statusOrder.length - 1) {
          const newStatus = statusOrder[currentIndex + 1]
          toast.success(`${batch.batchNo} moved to ${statusConfig[newStatus].label}`)
          return { ...batch, status: newStatus }
        }
      }
      return batch
    }))
  }

  const totalItems = batches.reduce((sum, b) => sum + b.items, 0)
  const completedItems = batches.filter(b => b.status === 'delivered').reduce((sum, b) => sum + b.items, 0)
  const inProgressBatches = batches.filter(b => !['pending', 'delivered'].includes(b.status)).length

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Good Morning!</h1>
        <p className="text-muted-foreground">Today&apos;s laundry overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Batches</p>
                <p className="text-xl font-bold">{batches.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Shirt className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Items</p>
                <p className="text-xl font-bold">{totalItems}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100">
                <RotateCcw className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-xl font-bold">{inProgressBatches}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">KPI Score</p>
                <p className="text-xl font-bold">94%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Batches */}
      <Card>
        <CardHeader>
          <CardTitle>Active Batches</CardTitle>
          <CardDescription>Track and update laundry progress</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {batches.filter(b => b.status !== 'delivered').map((batch) => {
            const StatusIcon = statusConfig[batch.status].icon
            const progress = (statusOrder.indexOf(batch.status) / (statusOrder.length - 1)) * 100

            return (
              <div key={batch.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={statusConfig[batch.status].color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusConfig[batch.status].label}
                      </Badge>
                      <span className="text-sm font-medium">{batch.batchNo}</span>
                    </div>
                    <h3 className="font-semibold">{batch.property}</h3>
                    <p className="text-sm text-muted-foreground">{batch.items} items</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-muted-foreground">Due: {batch.dueAt}</p>
                  </div>
                </div>

                {/* Progress */}
                <div className="space-y-2 mb-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                {/* Status Steps */}
                <div className="flex items-center justify-between mb-3">
                  {statusOrder.slice(0, -1).map((status, idx) => {
                    const isCompleted = statusOrder.indexOf(batch.status) > idx
                    const isCurrent = batch.status === status
                    return (
                      <div key={status} className="flex flex-col items-center">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                          isCompleted ? 'bg-green-500 text-white' :
                          isCurrent ? 'bg-primary text-primary-foreground' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                        </div>
                        <span className="text-xs mt-1 hidden sm:block">{statusConfig[status].label}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Action */}
                {batch.status !== 'ready' && (
                  <Button 
                    className="w-full" 
                    onClick={() => handleNextStatus(batch.id)}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Move to {statusConfig[statusOrder[statusOrder.indexOf(batch.status) + 1]].label}
                  </Button>
                )}
                {batch.status === 'ready' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="text-sm text-green-700">Ready for pickup/delivery</span>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Completed Today */}
      <Card>
        <CardHeader>
          <CardTitle>Completed Today</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.filter(b => b.status === 'delivered').length > 0 ? (
            <div className="space-y-2">
              {batches.filter(b => b.status === 'delivered').map(batch => (
                <div key={batch.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">{batch.batchNo}</p>
                    <p className="text-sm text-muted-foreground">{batch.property} - {batch.items} items</p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">No completed batches yet today</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
