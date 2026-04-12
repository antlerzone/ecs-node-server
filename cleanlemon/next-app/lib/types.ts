// User Roles for the SaaS Platform
export type UserRole = 'operator' | 'employee' | 'driver' | 'dobi' | 'client' | 'saas-admin' | 'api-user' | null

// Pricing Plans
export type PricingPlan = 'basic' | 'grow' | 'enterprise'

export interface PlanFeatures {
  plan: PricingPlan
  price: number
  /** Approx. total per quarter (UI); Stripe prices may differ slightly. */
  quarterlyPrice: number
  yearlyPrice: number
  features: string[]
  addons?: string[]
}

/** Starter tier — full list shown on cards (Growth/Enterprise repeat this + extras). */
export const STARTER_PLAN_FEATURES: string[] = [
  'One operator account · one login email',
  'Cleaning Operation Management',
  'Create & Manage Tasks',
  'Start/End Clean Tracking',
  'Start/End Work Tracking',
  'Supervisor Dashboard',
  'Client & Property Management',
  'Task & Schedule Management',
  'Staff attendance & punch card',
  'Invoice & Payment Tracking',
  'Calendar-adjusted pricing',
  'AI-assisted job scheduling',
  'Agreement settings',
  'Invoice automation',
  'Payslip automation',
  'Marketing page',
  'Property settings',
  'Photo completion verification',
  'Client reporting',
  'Advanced Scheduling',
  'Team Performance Analytics',
]

/** Growth tier adds (shown on Growth & Enterprise cards). */
export const GROWTH_PLAN_EXTRA_FEATURES: string[] = ['Accounting integration (Bukku & Xero)']

/** Enterprise tier adds (shown on Enterprise cards only). */
export const ENTERPRISE_PLAN_EXTRA_FEATURES: string[] = [
  'KPI Settings',
  'Dobi management',
  'Driver management',
  'Customization (branding, fields & workflows)',
  'Priority Support',
  'Custom Reports',
]

/** Segments for subscription/pricing cards — full feature text inside each card. */
export function getSubscriptionPlanFeatureSegments(plan: PricingPlan): { title: string; items: string[] }[] {
  if (plan === 'basic') {
    return [{ title: "What's included", items: [...STARTER_PLAN_FEATURES] }]
  }
  if (plan === 'grow') {
    return [
      { title: 'Starter', items: [...STARTER_PLAN_FEATURES] },
      { title: 'Growth', items: [...GROWTH_PLAN_EXTRA_FEATURES] },
    ]
  }
  return [
    { title: 'Starter', items: [...STARTER_PLAN_FEATURES] },
    { title: 'Growth', items: [...GROWTH_PLAN_EXTRA_FEATURES] },
    { title: 'Enterprise', items: [...ENTERPRISE_PLAN_EXTRA_FEATURES] },
  ]
}

export const PRICING_PLANS: PlanFeatures[] = [
  {
    plan: 'basic',
    price: 699,
    quarterlyPrice: Math.round(699 * 3 * 0.95),
    yearlyPrice: Math.round(699 * 12 * 0.8),
    features: [...STARTER_PLAN_FEATURES],
  },
  {
    plan: 'grow',
    price: 1299,
    quarterlyPrice: Math.round(1299 * 3 * 0.95),
    yearlyPrice: Math.round(1299 * 12 * 0.8),
    features: [...STARTER_PLAN_FEATURES, ...GROWTH_PLAN_EXTRA_FEATURES],
  },
  {
    plan: 'enterprise',
    price: 1599,
    quarterlyPrice: Math.round(1599 * 3 * 0.95),
    yearlyPrice: Math.round(1599 * 12 * 0.8),
    features: [...STARTER_PLAN_FEATURES, ...GROWTH_PLAN_EXTRA_FEATURES, ...ENTERPRISE_PLAN_EXTRA_FEATURES],
  },
]

/** Fallback when `cln_addon` API is unreachable (matches seeded catalog). */
export const CLN_ADDON_CATALOG_FALLBACK: Array<{
  id: string
  addonCode: string
  title: string
  description: string
  amountMyr: number
  currency: string
  intervalCode: 'year'
  sortOrder: number
}> = [
  {
    id: 'cln-addon-bulk-transfer',
    addonCode: 'bulk-transfer',
    title: 'Bulk transfer',
    description: 'Bank bulk salary transfer and related workflows.',
    amountMyr: 2400,
    currency: 'myr',
    intervalCode: 'year',
    sortOrder: 10,
  },
  {
    id: 'cln-addon-api-integration',
    addonCode: 'api-integration',
    title: 'API Integration',
    description: 'Programmatic access for integrations and automation.',
    amountMyr: 2400,
    currency: 'myr',
    intervalCode: 'year',
    sortOrder: 20,
  },
]

// User Types
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  role: UserRole
  provider?: 'email' | 'google' | 'facebook'
  operatorId?: string // Which operator this user belongs to
  plan?: PricingPlan
}

export interface Operator {
  id: string
  companyName: string
  email: string
  phone: string
  address: string
  plan: PricingPlan
  addons: string[]
  createdAt: Date
}

export interface Employee {
  id: string
  name: string
  email: string
  phone: string
  role: 'cleaner' | 'supervisor'
  operatorId: string
  status: 'active' | 'inactive'
  hiredAt: Date
  salary: number
}

export interface Driver {
  id: string
  name: string
  email: string
  phone: string
  vehicleNo: string
  licenseNo: string
  operatorId: string
  status: 'active' | 'inactive'
}

export interface Dobi {
  id: string
  name: string
  email: string
  phone: string
  operatorId: string
  status: 'active' | 'inactive'
  specialization: string[]
}

export interface Client {
  id: string
  name: string
  email: string
  phone: string
  company?: string
  approvedOperators: string[] // Operator IDs that can service this client
  properties: string[] // Property IDs
}

export interface Property {
  id: string
  name: string
  address: string
  type: 'office' | 'commercial' | 'apartment' | 'landed' | 'other'
  clientId: string
  operatorId: string
  lat?: number
  lng?: number
  notes?: string
  images?: string[]
}

// Task & Schedule Types
export type TaskStatus = 
  | 'pending-checkout'  // Guest hasn't checked out
  | 'ready-to-clean'    // Ready for cleaning
  | 'in-progress'       // Cleaning in progress
  | 'completed'         // Cleaning done
  | 'cancelled'

export interface Task {
  id: string
  propertyId: string
  operatorId: string
  assignedTo: string[] // Employee IDs
  driverId?: string
  dobiId?: string
  status: TaskStatus
  scheduledDate: Date
  scheduledTime: string
  checkInTime?: Date
  checkOutTime?: Date
  photos: TaskPhoto[]
  notes?: string
  clientFeedback?: Feedback
}

export interface TaskPhoto {
  id: string
  url: string
  timestamp: Date
  location?: {
    lat: number
    lng: number
    address?: string
  }
  type: 'before' | 'during' | 'after'
}

export interface Schedule {
  id: string
  propertyId: string
  operatorId: string
  recurring: boolean
  frequency?: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  dayOfWeek?: number[]
  time: string
  assignedTeam: string[]
}

// KPI Types
export interface KPI {
  id: string
  userId: string
  period: 'daily' | 'weekly' | 'monthly'
  completedTasks: number
  totalTasks: number
  onTimeRate: number
  customerRating: number
  attendance: number
}

// Feedback
export interface Feedback {
  id: string
  taskId: string
  clientId: string
  rating: number
  comment?: string
  photos?: string[]
  createdAt: Date
}

// Agreement / Offer Letter
export interface Agreement {
  id: string
  operatorId: string
  recipientId: string
  recipientType: 'employee' | 'driver' | 'dobi'
  templateId: string
  content: string
  salary: number
  startDate: Date
  status: 'draft' | 'sent' | 'signed' | 'rejected'
  signedAt?: Date
  createdAt: Date
}

export interface AgreementTemplate {
  id: string
  operatorId: string
  name: string
  type: 'employee' | 'driver' | 'dobi'
  content: string
  variables: string[] // e.g., {{name}}, {{salary}}, {{startDate}}
}

// Salary
export interface SalaryRecord {
  id: string
  userId: string
  operatorId: string
  period: string // e.g., "2024-01"
  baseSalary: number
  bonus: number
  deductions: number
  totalTasks: number
  status: 'pending' | 'paid'
  paidAt?: Date
}

// Invoice
export interface Invoice {
  id: string
  clientId: string
  operatorId: string
  taskIds: string[]
  amount: number
  status: 'draft' | 'sent' | 'paid' | 'overdue'
  dueDate: Date
  paidAt?: Date
  createdAt: Date
}

// AI Rules for scheduling
export interface AIRule {
  id: string
  operatorId: string
  name: string
  description: string
  conditions: string
  actions: string
  priority: number
  isActive: boolean
}

// Notification
export interface Notification {
  id: string
  userId: string
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error'
  read: boolean
  createdAt: Date
  link?: string
}
