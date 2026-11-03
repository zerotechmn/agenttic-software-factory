export type Selection = { kind: 'task' | 'agent' | 'artifact'; id: string } | null
export type Select = (s: Selection) => void
