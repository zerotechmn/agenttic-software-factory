import type { Role } from '../domain/types'

// The one place that says who each role is in the FORGE realm: name, colour, art and where they live.
// UI components read AGENTS from here (not from the demo scenario), so another factory can swap this file.

export type Rarity = 'common' | 'rare' | 'epic'
export type DistrictId =
  | 'forge' | 'product_steppe' | 'research_grove' | 'architecture_citadel' | 'design_lake'
  | 'developer_valley' | 'review_keep' | 'integrator_vault' | 'qa_lab' | 'deploy_dock'

export interface AgentProfile {
  role: Role
  name: string
  title: string
  color: string
  model: string // shown on the card; descriptive only
  rarity: Rarity // haiku = common, sonnet = rare, opus = epic
  art?: string // file stem under public/forge/{char,card,home}/; the orchestrator has no character
  district: DistrictId
  anchor: [number, number] // where the character stands on the map, % of map width/height
}

export interface District {
  id: DistrictId
  label: string
  background?: string // public/forge/bg/<id>.webp
  anchor: [number, number] // hotspot centre on the map, %
}

const asset = (p: string) => `${import.meta.env.BASE_URL}forge/${p}.webp`
export const charArt = (a: AgentProfile) => (a.art ? asset(`char/${a.art}`) : undefined)
export const cardArt = (a: AgentProfile) => (a.art ? asset(`card/${a.art}`) : undefined)
export const homeArt = (a: AgentProfile) => (a.art ? asset(`home/${a.art}`) : undefined)
export const bgArt = (d: District) => (d.background ? asset(`bg/${d.background}`) : undefined)
export const bubbleArt = (kind: string) => asset(`bubble/${kind}`)
export const parcelArt = (frame: string) => asset(`parcel/${frame}`)
export const MAP_ART = { full: asset('map'), half: asset('map-836') }

// Anchors were read off master_map.png by eye; check them with ?debug=anchors and adjust here.
export const DISTRICTS: Record<DistrictId, District> = {
  forge: { id: 'forge', label: 'FORGE', anchor: [50, 44] },
  product_steppe: { id: 'product_steppe', label: 'Product Steppe', background: 'product_steppe', anchor: [10, 26] },
  research_grove: { id: 'research_grove', label: 'Research Grove', background: 'research_grove', anchor: [34, 14] },
  architecture_citadel: { id: 'architecture_citadel', label: 'Architecture Citadel', background: 'architecture_citadel', anchor: [58, 17] },
  design_lake: { id: 'design_lake', label: 'Design Lake', background: 'design_lake', anchor: [86, 27] },
  developer_valley: { id: 'developer_valley', label: 'Developer Valley', background: 'developer_valley', anchor: [26, 48] },
  review_keep: { id: 'review_keep', label: 'Review Keep', background: 'review_keep', anchor: [48, 68] },
  integrator_vault: { id: 'integrator_vault', label: 'Integrator Vault', background: 'integrator_vault', anchor: [73, 52] },
  qa_lab: { id: 'qa_lab', label: 'QA Lab', background: 'qa_lab', anchor: [18, 75] },
  deploy_dock: { id: 'deploy_dock', label: 'Deploy Dock', background: 'deploy_dock', anchor: [89, 76] },
}

export const AGENTS: Record<Role, AgentProfile> = {
  orchestrator: { role: 'orchestrator', name: 'FORGE', title: 'Orchestrator', color: '#7c5cff', model: 'controller', rarity: 'epic', district: 'forge', anchor: [50, 44] },
  pm: { role: 'pm', name: 'Erka', title: 'Product manager', color: '#8b3fd9', model: 'sonnet', rarity: 'rare', art: 'erka', district: 'product_steppe', anchor: [12, 30] },
  researcher: { role: 'researcher', name: 'Danjila', title: 'Researcher', color: '#2f9e44', model: 'sonnet', rarity: 'rare', art: 'danjila', district: 'research_grove', anchor: [36, 19] },
  architect: { role: 'architect', name: 'Sunny Boy', title: 'Architect', color: '#e0a800', model: 'opus', rarity: 'epic', art: 'sunny_boy', district: 'architecture_citadel', anchor: [56, 25] },
  designer: { role: 'designer', name: 'Selenge', title: 'UI/UX designer', color: '#b9a7c9', model: 'opus', rarity: 'epic', art: 'selenge', district: 'design_lake', anchor: [84, 31] },
  dev1: { role: 'dev1', name: 'Tuvshu', title: 'Backend developer', color: '#2f6fe0', model: 'sonnet → opus', rarity: 'rare', art: 'tuvshu', district: 'developer_valley', anchor: [17, 53] },
  dev2: { role: 'dev2', name: 'Anar', title: 'Frontend developer', color: '#e03131', model: 'sonnet → opus', rarity: 'rare', art: 'anar', district: 'developer_valley', anchor: [27, 52] },
  dev3: { role: 'dev3', name: 'Mada', title: 'Backend developer', color: '#f08c00', model: 'sonnet → opus', rarity: 'rare', art: 'mada', district: 'developer_valley', anchor: [37, 53] },
  reviewer: { role: 'reviewer', name: 'Tuvshu#1', title: 'Reviewer (per task)', color: '#4c6ef5', model: 'haiku', rarity: 'common', art: 'tuvshu_1', district: 'review_keep', anchor: [44, 73] },
  final_reviewer: { role: 'final_reviewer', name: 'Enkee', title: 'Final reviewer', color: '#b08900', model: 'sonnet', rarity: 'rare', art: 'enkee', district: 'review_keep', anchor: [52, 72] },
  integrator: { role: 'integrator', name: 'Ginkhma', title: 'Integrator', color: '#e64980', model: 'sonnet', rarity: 'rare', art: 'ginkhma', district: 'integrator_vault', anchor: [72, 57] },
  qa: { role: 'qa', name: 'Duuree', title: 'QA', color: '#1c3faa', model: 'sonnet', rarity: 'rare', art: 'duuree', district: 'qa_lab', anchor: [20, 79] },
  devops: { role: 'devops', name: 'Ops', title: 'DevOps', color: '#69db7c', model: 'haiku', rarity: 'common', art: 'ops', district: 'deploy_dock', anchor: [86, 80] },
}

export const agentsIn = (d: DistrictId) => Object.values(AGENTS).filter(a => a.district === d)
