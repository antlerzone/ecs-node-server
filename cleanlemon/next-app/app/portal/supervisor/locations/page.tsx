"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { 
  Search,
  Plus,
  MapPin,
  Building2,
  Users,
  Calendar,
  Phone,
  Mail,
  MoreVertical,
  ChevronRight,
  CheckCircle2
} from 'lucide-react'

interface Property {
  id: string
  name: string
  address: string
  units: number
  activeCleanings: number
  lastCleaning: string
  contact: {
    name: string
    phone: string
    email: string
  }
  status: 'active' | 'inactive'
}

const mockProperties: Property[] = [
  {
    id: '1',
    name: 'Sunway Velocity',
    address: 'Jalan Peel, 55100 Kuala Lumpur',
    units: 12,
    activeCleanings: 3,
    lastCleaning: '2 hours ago',
    contact: {
      name: 'John Tan',
      phone: '+60 12-345 6789',
      email: 'john@sunwayvelocity.com'
    },
    status: 'active'
  },
  {
    id: '2',
    name: 'KLCC Residences',
    address: 'Kuala Lumpur City Centre, 50088',
    units: 8,
    activeCleanings: 1,
    lastCleaning: '1 day ago',
    contact: {
      name: 'Sarah Lee',
      phone: '+60 12-456 7890',
      email: 'sarah@klccresidences.com'
    },
    status: 'active'
  },
  {
    id: '3',
    name: 'Mont Kiara',
    address: 'Mont Kiara, 50480 Kuala Lumpur',
    units: 15,
    activeCleanings: 2,
    lastCleaning: '3 hours ago',
    contact: {
      name: 'Michael Wong',
      phone: '+60 12-567 8901',
      email: 'michael@montkiara.com'
    },
    status: 'active'
  },
  {
    id: '4',
    name: 'Bangsar South',
    address: 'Bangsar South, 59200 Kuala Lumpur',
    units: 6,
    activeCleanings: 0,
    lastCleaning: '1 week ago',
    contact: {
      name: 'Amanda Lim',
      phone: '+60 12-678 9012',
      email: 'amanda@bangsarsouth.com'
    },
    status: 'inactive'
  },
  {
    id: '5',
    name: 'Pavilion Residences',
    address: '168 Jalan Bukit Bintang, 55100',
    units: 20,
    activeCleanings: 4,
    lastCleaning: '30 minutes ago',
    contact: {
      name: 'David Chen',
      phone: '+60 12-789 0123',
      email: 'david@pavilion.com'
    },
    status: 'active'
  },
]

export default function LocationsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filteredProperties = mockProperties.filter(property =>
    property.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    property.address.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalUnits = mockProperties.reduce((acc, p) => acc + p.units, 0)
  const activeProperties = mockProperties.filter(p => p.status === 'active').length

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Locations</h1>
          <p className="text-muted-foreground">
            {mockProperties.length} properties, {totalUnits} total units
          </p>
        </div>
        <Button className="bg-primary text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" />
          Add Location
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <Building2 className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{mockProperties.length}</p>
                <p className="text-xs text-muted-foreground">Properties</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{activeProperties}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                <MapPin className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{totalUnits}</p>
                <p className="text-xs text-muted-foreground">Total Units</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-yellow-700" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {mockProperties.reduce((acc, p) => acc + p.activeCleanings, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Active Jobs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search properties..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-background border-input"
        />
      </div>

      {/* Properties List */}
      <div className="space-y-4">
        {filteredProperties.map((property) => (
          <Card 
            key={property.id} 
            className="border-border overflow-hidden"
          >
            <CardContent className="p-0">
              <div 
                className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedId(expandedId === property.id ? null : property.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-accent/30 flex items-center justify-center shrink-0">
                      <Building2 className="h-6 w-6 text-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{property.name}</h3>
                        <Badge 
                          variant="outline" 
                          className={property.status === 'active' ? 'text-green-700 border-green-200 bg-green-50' : 'text-muted-foreground'}
                        >
                          {property.status === 'active' ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {property.address}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>{property.units} units</span>
                        <span className="text-primary font-medium">
                          {property.activeCleanings} active cleanings
                        </span>
                        <span>Last: {property.lastCleaning}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight 
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      expandedId === property.id ? 'rotate-90' : ''
                    }`} 
                  />
                </div>
              </div>

              {/* Expanded Contact Details */}
              {expandedId === property.id && (
                <div className="border-t border-border p-4 bg-muted/30">
                  <p className="text-sm font-medium text-foreground mb-3">Contact Information</p>
                  <div className="grid gap-3">
                    <div className="flex items-center gap-3 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{property.contact.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{property.contact.phone}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{property.contact.email}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button variant="outline" size="sm" className="flex-1">
                      View Units
                    </Button>
                    <Button size="sm" className="flex-1 bg-primary text-primary-foreground">
                      Schedule Cleaning
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
