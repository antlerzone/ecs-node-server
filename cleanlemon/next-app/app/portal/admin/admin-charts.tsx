'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'

type RevenueRow = { month: string; basic: number; grow: number; enterprise: number }

export function RevenueBarChart({ data }: { data: RevenueRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="basic" fill="#A4C8D8" />
        <Bar dataKey="grow" fill="#FBD437" />
        <Bar dataKey="enterprise" fill="#1B2A41" />
      </BarChart>
    </ResponsiveContainer>
  )
}

type PlanRow = { name: string; value: number }

export function PlanPieChart({ data, colors }: { data: PlanRow[]; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={(entry) => `${entry.name}: ${entry.value}%`}
          outerRadius={100}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${entry.name}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  )
}
