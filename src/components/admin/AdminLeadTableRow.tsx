'use client'

import { memo } from 'react'
import { ChevronDown, ChevronRight, MessageSquare, Copy } from 'lucide-react'

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
      <td className="p-4">
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
            lead.disposition === 'New'
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-neutral-500/10 text-neutral-500 border-neutral-500/20'
          }`}
        >
          {lead.disposition}
        </span>
      </td>
      <td className="p-4 text-center">
        <button type="button" onClick={onToggleExpand}>
          <MessageSquare className="w-4 h-4 text-neutral-600 hover:text-blue-400" />
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
