'use client'

import { memo } from 'react'
import { ChevronDown, ChevronRight, MessageSquare, Copy } from 'lucide-react'
import DispositionSelect from '@/components/employee/DispositionSelect'

export type AdminLeadRow = {
  id: string
  title: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string
  assignedTo: { name: string } | null
  assignedAdvisor: { name: string } | null
  disposition: string
  verifiedSale: boolean
  paymentReceived: boolean
}

type Props = {
  lead: AdminLeadRow
  expanded: boolean
  selected: boolean
  onToggleExpand: () => void
  onToggleSelect: () => void
  onCopyPhone: (phone: string) => void
  dispositionOptions: readonly string[]
  onDispositionChange: (disposition: string) => void
  hasIntakeData?: boolean
  onVerifiedChange: (checked: boolean) => void
  onPaidChange: (checked: boolean) => void
}

function AdminLeadTableRow({
  lead,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onCopyPhone,
  dispositionOptions,
  onDispositionChange,
  hasIntakeData = false,
  onVerifiedChange,
  onPaidChange,
}: Props) {
  return (
    <tr
      className={`hover:bg-neutral-800/30 transition-colors ${expanded ? 'bg-neutral-800/20' : ''}`}
    >
      <td className="p-4 text-center">
        <button type="button" onClick={onToggleExpand} aria-expanded={expanded}>
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
      </td>
      <td className="p-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="rounded border-neutral-700 bg-neutral-800"
        />
      </td>
      <td className="p-4 text-neutral-400 text-xs">{lead.title || '-'}</td>
      <td className="p-4 font-bold text-white">{lead.firstName}</td>
      <td className="p-4 text-neutral-300">{lead.lastName || '-'}</td>
      <td className="p-4 text-neutral-300 normal-case">{lead.email || '-'}</td>
      <td className="p-4 font-mono text-xs">
        <div className="flex items-center gap-2">
          {lead.phone}
          <button type="button" onClick={() => onCopyPhone(lead.phone)}>
            <Copy className="w-3 h-3 text-neutral-600 hover:text-white" />
          </button>
        </div>
      </td>
      <td className="p-4 text-center text-xs font-bold text-neutral-500">
        {lead.assignedTo?.name || '-'}
      </td>
      <td className="p-4 text-center text-xs font-bold text-amber-500/70">
        {lead.assignedAdvisor?.name || '-'}
      </td>
      <td className="p-4 align-top min-w-[9rem]">
        <DispositionSelect
          value={lead.disposition}
          options={dispositionOptions}
          onSelect={onDispositionChange}
        />
      </td>
      <td className="p-4 text-center">
        <button type="button" onClick={onToggleExpand} title="Open lead details & intake form">
          <MessageSquare
            className={`w-4 h-4 ${hasIntakeData ? 'text-blue-400' : 'text-neutral-600 hover:text-blue-400'}`}
          />
        </button>
      </td>
      <td className="p-4 text-center">
        <input
          type="checkbox"
          checked={lead.verifiedSale}
          onChange={(e) => onVerifiedChange(e.target.checked)}
          className="rounded bg-neutral-800 text-blue-500"
        />
      </td>
      <td className="p-4 text-center">
        <input
          type="checkbox"
          checked={lead.paymentReceived}
          onChange={(e) => onPaidChange(e.target.checked)}
          className="rounded bg-neutral-800 text-purple-500"
        />
      </td>
    </tr>
  )
}

export default memo(AdminLeadTableRow)
