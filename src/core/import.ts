/**
 * Source import: extract a bounded structural digest from diagrams the user
 * already has, so the agent can redraw them in the diagram-design style.
 *
 * Supported: draw.io (`.drawio`, plain or compressed mxfile), Mermaid
 * (`.mmd`/`.mermaid`, flowchart and sequence), Excalidraw (`.excalidraw` JSON),
 * PlantUML (`.puml`/`.plantuml`, sequence and class subsets). This tool never
 * renders a source.
 */
import { inflateRawSync } from 'node:zlib'

/** One diagram node in the digest. */
export interface ImportNode {
  /** Stable id from the source when it has one. */
  id: string
  /** Visible label. */
  label: string
  /** Optional source kind (rectangle, ellipse, actor, ...). */
  kind?: string
}

/** One diagram edge in the digest. */
export interface ImportEdge {
  /** Source node id/name. */
  from: string
  /** Target node id/name. */
  to: string
  /** Optional edge label. */
  label?: string
  /** True when the source draws the relationship dashed or dotted. */
  dashed?: boolean
}

/** Coarse dialect of a PlantUML source. */
export type PlantUmlKind = 'class' | 'sequence' | 'plantuml'

/** Normalized structure handed to the model for a redraw. */
export interface ImportDigest {
  /** Detected source format. */
  format: 'drawio' | 'mermaid' | 'excalidraw' | 'plantuml'
  /** Diagram title/section when the source has one. */
  title?: string
  /** Source dialect sub-kind when the format has one (PlantUML sequence/class). */
  kind?: PlantUmlKind
  /** Nodes, capped. */
  nodes: ImportNode[]
  /** Edges, capped. */
  edges: ImportEdge[]
  /** Group/container names when the dialect has them. */
  groups?: string[]
  /** Free-form notes: what was collapsed, unsupported dialect features, ... */
  notes: string[]
  /** True when node/edge caps truncated the digest. */
  truncated: boolean
}

/** Result of the PlantUML subset parser. */
export interface PlantUmlDigest {
  nodes: ImportNode[]
  edges: ImportEdge[]
  kind: PlantUmlKind
  title?: string
  /** Present only when nothing parseable was found. */
  note?: string
  /** Present only when the caps truncated the result. */
  truncated?: boolean
}

/** Digest caps keep a redraw prompt small. */
export const MAX_NODES = 300
export const MAX_EDGES = 300

/** Decode the five XML entities. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, '&')
}

/** Strip tags, decode entities and collapse whitespace in a label. */
function cleanLabel(value: string): string {
  const text = unescapeXml(value)
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text.slice(0, 200)
}

/** Decode one compressed draw.io `<diagram>` payload. */
function decodeDrawioPayload(payload: string): string {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('<')) {
    try {
      const inflated = inflateRawSync(Buffer.from(trimmed, 'base64')).toString('utf8')
      return decodeURIComponent(inflated)
    } catch {
      throw new Error('the compressed draw.io payload could not be decoded')
    }
  }
  return trimmed
}

/** Extract the XML the cells live in from an mxfile/mxGraphModel document. */
function drawioModelXml(source: string): { xml: string; title?: string } {
  const diagram = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/iu.exec(source)
  if (diagram === null) return { xml: source }
  const title = cleanLabel(attrOf(diagram[1] ?? '', 'name') ?? '')
  return { xml: decodeDrawioPayload(diagram[2] ?? ''), ...(title === '' ? {} : { title }) }
}

/** Read one XML attribute from an attribute fragment. */
function attrOf(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu').exec(attrs)
  return match === null ? undefined : match[1] ?? match[2] ?? ''
}

/** Parse a draw.io file into a digest. */
export function parseDrawio(source: string): ImportDigest {
  const { xml, title } = drawioModelXml(source)
  const nodes: ImportNode[] = []
  const edges: ImportEdge[] = []
  const groups: string[] = []
  const notes: string[] = []
  // Labels declared by UserObject wrappers, keyed by the wrapped cell id.
  const labels = new Map<string, string>()
  const userObject = /<UserObject\b([^>]*)>/gu
  for (const match of source.matchAll(userObject)) {
    const id = attrOf(match[1] ?? '', 'id')
    if (id !== undefined) labels.set(id, cleanLabel(attrOf(match[1] ?? '', 'label') ?? ''))
  }
  const cellPattern = /<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/gu
  const known = new Map<string, string>()
  for (const match of xml.matchAll(cellPattern)) {
    const attrs = match[1] ?? ''
    const id = attrOf(attrs, 'id') ?? ''
    if (id === '' || id === '0' || id === '1') continue
    const rawValue = attrOf(attrs, 'value') ?? ''
    const label = (labels.get(id) ?? '') !== '' ? labels.get(id)! : cleanLabel(rawValue)
    const style = attrOf(attrs, 'style') ?? ''
    const isEdge = attrOf(attrs, 'edge') === '1'
    const isVertex = attrOf(attrs, 'vertex') === '1'
    if (isEdge) {
      const from = attrOf(attrs, 'source') ?? ''
      const to = attrOf(attrs, 'target') ?? ''
      edges.push({ from, to, ...(label === '' ? {} : { label }) })
    } else if (isVertex) {
      const kind = style.includes('ellipse') ? 'ellipse' : style.includes('rhombus') ? 'decision' : style.includes('swimlane') ? 'swimlane' : 'box'
      nodes.push({ id, label: label === '' ? id : label, kind })
      known.set(id, label === '' ? id : label)
      if (kind === 'swimlane') groups.push(label === '' ? id : label)
    }
  }
  if (nodes.length === 0) notes.push('no vertex cells found: the draw.io file may use a shape type this parser does not map')
  const truncated = nodes.length > MAX_NODES || edges.length > MAX_EDGES
  return {
    format: 'drawio',
    ...(title === undefined ? {} : { title }),
    nodes: nodes.slice(0, MAX_NODES),
    edges: edges.slice(0, MAX_EDGES),
    ...(groups.length === 0 ? {} : { groups: groups.slice(0, 20) }),
    notes,
    truncated,
  }
}

/** Parse a Mermaid flowchart/graph source into a digest. */
function parseMermaidFlowchart(lines: string[]): ImportDigest {
  const nodes = new Map<string, ImportNode>()
  const edges: ImportEdge[] = []
  const notes: string[] = []
  const nodePattern = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\[([^\]]*)\]\]|\[([^\]]*)\]|\(\(([^)]*)\)\)|\(([^)]*)\)|\{([^}]*)\}|>([^\]]*)\])/gu
  const edgePattern = /([A-Za-z_][A-Za-z0-9_]*)(?:\s*(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|>[^\]]*\]))?\s*(-->|---|-.->|==>)\s*(?:\|([^|]*)\|\s*)?([A-Za-z_][A-Za-z0-9_]*)/gu
  for (const line of lines) {
    for (const match of line.matchAll(nodePattern)) {
      const id = match[1]!
      if (nodes.has(id)) continue
      const label = cleanLabel(match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? '')
      nodes.set(id, { id, label: label === '' ? id : label })
    }
    for (const match of line.matchAll(edgePattern)) {
      edges.push({ from: match[1]!, to: match[4]!, ...(match[3] === undefined || cleanLabel(match[3]) === '' ? {} : { label: cleanLabel(match[3]) }) })
    }
  }
  if (nodes.size === 0) notes.push('no flowchart nodes were recognised')
  const truncated = nodes.size > MAX_NODES || edges.length > MAX_EDGES
  return { format: 'mermaid', nodes: [...nodes.values()].slice(0, MAX_NODES), edges: edges.slice(0, MAX_EDGES), notes, truncated }
}

/** Parse a Mermaid sequence diagram into a digest (participants as nodes, messages as edges). */
function parseMermaidSequence(lines: string[]): ImportDigest {
  const nodes = new Map<string, ImportNode>()
  const edges: ImportEdge[] = []
  const notes: string[] = []
  for (const line of lines) {
    const participant = /^\s*(?:participant|actor)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+(.+))?$/u.exec(line)
    if (participant !== null) {
      const id = participant[1]!
      const label = cleanLabel(participant[2] ?? id)
      nodes.set(id, { id, label })
      continue
    }
    const message = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*--?>>?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/u.exec(line)
    if (message !== null) {
      const label = cleanLabel(message[3]!)
      edges.push({ from: message[1]!, to: message[2]!, ...(label === '' ? {} : { label }) })
      if (!nodes.has(message[1]!)) nodes.set(message[1]!, { id: message[1]!, label: message[1]! })
      if (!nodes.has(message[2]!)) nodes.set(message[2]!, { id: message[2]!, label: message[2]! })
    }
  }
  if (nodes.size === 0) notes.push('no sequence participants were recognised')
  return { format: 'mermaid', nodes: [...nodes.values()].slice(0, MAX_NODES), edges: edges.slice(0, MAX_EDGES), notes, truncated: nodes.size > MAX_NODES || edges.length > MAX_EDGES }
}

/** Parse a Mermaid source file into a digest. */
export function parseMermaid(source: string): ImportDigest {
  const lines = source.split(/\r?\n/u)
  const header = lines.find(line => line.trim() !== '' && !line.trim().startsWith('%%')) ?? ''
  const directive = header.trim()
  if (/^(?:sequenceDiagram)\b/u.test(directive)) return parseMermaidSequence(lines)
  if (/^(?:flowchart|graph)\b/u.test(directive)) {
    const digest = parseMermaidFlowchart(lines)
    return { ...digest, notes: [...digest.notes, 'flowchart dialect: branches/subgraphs beyond node and edge shapes are not extracted'] }
  }
  return {
    format: 'mermaid',
    nodes: [],
    edges: [],
    notes: [`unsupported Mermaid diagram type "${directive.slice(0, 40)}": only flowchart and sequence are extracted; read the source and use the matching type reference`],
    truncated: false,
  }
}

/** Parse an Excalidraw scene JSON into a digest. */
export function parseExcalidraw(source: string): ImportDigest {
  let scene: { elements?: unknown[]; appState?: { name?: unknown } }
  try {
    scene = JSON.parse(source) as typeof scene
  } catch {
    throw new Error('the .excalidraw file is not valid JSON (note: PNG/SVG exports are not accepted)')
  }
  const elements = Array.isArray(scene.elements) ? scene.elements : []
  const byId = new Map<string, { type: string; label?: string }>()
  const labels = new Map<string, string>()
  for (const element of elements) {
    if (element === null || typeof element !== 'object') continue
    const record = element as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const type = typeof record.type === 'string' ? record.type : ''
    if (id === '') continue
    if (type === 'text' && typeof record.text === 'string') {
      const container = typeof record.containerId === 'string' ? record.containerId : id
      labels.set(container, cleanLabel(record.text))
    }
    byId.set(id, { type })
  }
  const nodes: ImportNode[] = []
  const edges: ImportEdge[] = []
  const groups = new Set<string>()
  for (const element of elements) {
    if (element === null || typeof element !== 'object') continue
    const record = element as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    if (id === '') continue
    const type = typeof record.type === 'string' ? record.type : ''
    if (Array.isArray(record.groupIds)) for (const group of record.groupIds) if (typeof group === 'string') groups.add(group)
    if (type === 'arrow' || type === 'line') {
      const start = (record.startBinding as { elementId?: unknown } | null | undefined)?.elementId
      const end = (record.endBinding as { elementId?: unknown } | null | undefined)?.elementId
      edges.push({ from: typeof start === 'string' ? start : '?', to: typeof end === 'string' ? end : '?' })
      continue
    }
    if (type === 'rectangle' || type === 'ellipse' || type === 'diamond' || type === 'text') {
      // A text element bound to a container is that container's label.
      const container = (record.containerId as string | null | undefined) ?? undefined
      const own = labels.get(id) ?? ''
      const label = container !== undefined ? labels.get(container) ?? '' : own
      nodes.push({ id, label: label === '' ? (type === 'text' ? own || id : id) : label, kind: type })
    }
  }
  const digestNodes = nodes.filter(node => node.kind !== 'text')
  return {
    format: 'excalidraw',
    ...(typeof scene.appState?.name === 'string' ? { title: cleanLabel(scene.appState.name) } : {}),
    nodes: digestNodes.slice(0, MAX_NODES),
    edges: edges.slice(0, MAX_EDGES),
    ...(groups.size === 0 ? {} : { groups: [...groups].slice(0, 20) }),
    notes: ['Excalidraw frames/embeds are not extracted; element ids are preserved for reference'],
    truncated: digestNodes.length > MAX_NODES || edges.length > MAX_EDGES,
  }
}

/** Sequence lifeline keywords. */
const PLANTUML_PARTICIPANTS = 'participant|actor|boundary|control|entity|database|collections|queue'

/** Class-diagram classifier keywords. */
const PLANTUML_CLASSIFIERS = 'abstract\\s+class|class|interface|enum'

/** One quoted or bare PlantUML name (spaces only inside quotes). */
const PLANTUML_NAME = '(?:"[^"]+"|[^\\s:{}<>"]+)'

/** Class-diagram arrows, longest forms first so the regex never stops early. */
const PLANTUML_CLASS_ARROWS = [
  '<\\|--', '<\\|\\.\\.', '--\\|>', '\\.\\.\\|>', '\\*--', '--\\*',
  'o--', '--o', '<--', '-->', '<\\.\\.', '\\.\\.>', '--', '\\.\\.',
]

/** Sequence message arrows, longest forms first. */
const PLANTUML_MESSAGE_ARROWS = ['<<--', '-->>', '<<-', '<--', '->>', '-->', '<-', '->']

/** One participant-ish declaration line. */
const PLANTUML_PARTICIPANT_DECLARATION = new RegExp(`^(?:${PLANTUML_PARTICIPANTS})\\s+(.+)$`, 'iu')

/** One class-diagram declaration line. */
const PLANTUML_CLASS_DECLARATION = new RegExp(`^(?:${PLANTUML_CLASSIFIERS})\\s+(.+)$`, 'iu')

/** One class-diagram relation, with optional quoted cardinalities. */
const PLANTUML_CLASS_RELATION = new RegExp(
  `^(${PLANTUML_NAME})\\s*(?:"[^"]*"\\s*)?(${PLANTUML_CLASS_ARROWS.join('|')})\\s*(?:"[^"]*"\\s*)?(${PLANTUML_NAME})(?:\\s*:\\s*(.*))?$`,
  'u',
)

/** One sequence message line. */
const PLANTUML_MESSAGE = new RegExp(
  `^(${PLANTUML_NAME})\\s*(${PLANTUML_MESSAGE_ARROWS.join('|')})\\s*(${PLANTUML_NAME})(?:\\s*:\\s*(.*))?$`,
  'u',
)

/** Split PlantUML source into content lines, dropping comments and directives. */
function plantUmlLines(source: string): string[] {
  const lines: string[] = []
  let inBlockComment = false
  for (const raw of source.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.trim()
    if (inBlockComment) {
      if (line.includes("'/")) inBlockComment = false
      continue
    }
    if (line.startsWith("/'")) {
      if (!line.includes("'/", 2)) inBlockComment = true
      continue
    }
    if (line === '' || line.startsWith("'")) continue
    if (/^(?:@startuml\b|@enduml\b|skinparam\b|!theme\b)/iu.test(line)) continue
    lines.push(line)
  }
  return lines
}

/** Remove trailing PlantUML decoration (`#color`, `<<stereotype>>`, `order N`). */
function stripPlantUmlDecoration(value: string): string {
  let text = value.trim()
  for (;;) {
    const before = text
    text = text
      .replace(/\s*<<[^<>]*>>\s*$/u, '')
      .replace(/\s+#{1,2}[^\s]*\s*$/u, '')
      .replace(/\s+order\s+\d+\s*$/iu, '')
      .trim()
    if (text === before) return text
  }
}

/** Drop an inline classifier body (`{ ... }`) and keep the declaration head. */
function withoutPlantUmlBody(value: string): string {
  const brace = value.indexOf('{')
  return (brace === -1 ? value : value.slice(0, brace)).trim()
}

/** Read a declaration as `Name`, `"Label" as Alias`, or `Alias as "Label"`. */
function plantUmlName(value: string): { id: string; label: string } | undefined {
  const text = value.trim()
  const quotedLabel = /^"([^"]*)"\s+as\s+([^\s{}"]+)$/u.exec(text)
  if (quotedLabel !== null) {
    const id = quotedLabel[2]!
    const label = cleanLabel(quotedLabel[1]!)
    return { id, label: label === '' ? id : label }
  }
  const quotedAlias = /^([^\s{}"]+)\s+as\s+"([^"]*)"$/u.exec(text)
  if (quotedAlias !== null) {
    const id = quotedAlias[1]!
    const label = cleanLabel(quotedAlias[2]!)
    return { id, label: label === '' ? id : label }
  }
  const bareAlias = /^([^\s{}"]+)\s+as\s+([^\s{}"]+)$/u.exec(text)
  if (bareAlias !== null) {
    return { id: bareAlias[2]!, label: cleanLabel(bareAlias[1]!) || bareAlias[2]! }
  }
  const quoted = /^"([^"]*)"$/u.exec(text)
  if (quoted !== null) {
    const id = (quoted[1] ?? '').trim()
    if (id === '') return undefined
    const label = cleanLabel(id)
    return { id, label: label === '' ? id : label }
  }
  const bare = /^([^\s{}"]+)$/u.exec(text)
  if (bare !== null) {
    const id = bare[1]!
    return { id, label: cleanLabel(id) || id }
  }
  return undefined
}

/** Strip the quotes from one relation endpoint. */
function plantUmlEndpoint(value: string): string {
  const text = value.trim()
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).trim() : text
}

/** Map a class-diagram arrow to its semantic direction (child → parent, whole → part, ...). */
function plantUmlClassEnds(left: string, right: string, arrow: string): { from: string; to: string } {
  if (arrow.startsWith('<|') || arrow.startsWith('<..')) return { from: right, to: left }
  if (arrow.endsWith('|>')) return { from: left, to: right }
  if (arrow.startsWith('*') || arrow.startsWith('o')) return { from: left, to: right }
  if (arrow.endsWith('*') || arrow.endsWith('o')) return { from: right, to: left }
  if (arrow.startsWith('<')) return { from: right, to: left }
  return { from: left, to: right }
}

/** Parse the supported PlantUML subset: sequence participants/messages and class declarations/relations. */
export function parsePlantUml(source: string): PlantUmlDigest {
  const lines = plantUmlLines(source)
  const nodes = new Map<string, ImportNode>()
  let title: string | undefined
  let hasParticipant = false
  let hasClassDeclaration = false

  // Pass 1: declarations. Reading them first keeps relation targets and labels
  // deterministic even when one is declared after the first message.
  for (const line of lines) {
    const titleLine = /^title\s+(.+)$/iu.exec(line)
    if (titleLine !== null) {
      const value = cleanLabel(titleLine[1]!)
      if (value !== '' && title === undefined) title = value
      continue
    }
    const participant = PLANTUML_PARTICIPANT_DECLARATION.exec(line)
    if (participant !== null) {
      const name = plantUmlName(stripPlantUmlDecoration(withoutPlantUmlBody(participant[1]!)))
      if (name !== undefined) {
        hasParticipant = true
        if (!nodes.has(name.id)) nodes.set(name.id, { id: name.id, label: name.label })
      }
      continue
    }
    const classifier = PLANTUML_CLASS_DECLARATION.exec(line)
    if (classifier !== null) {
      const name = plantUmlName(stripPlantUmlDecoration(withoutPlantUmlBody(classifier[1]!)))
      if (name !== undefined) {
        hasClassDeclaration = true
        classIds.add(name.id)
        if (!nodes.has(name.id)) nodes.set(name.id, { id: name.id, label: name.label })
      }
    }
  }

  // Pass 2: messages and relations (declarations were consumed above).
  const edges: ImportEdge[] = []
  let hasLabelledMessage = false
  const ensureNode = (id: string): void => {
    if (id !== '' && !nodes.has(id)) nodes.set(id, { id, label: id })
  }
  for (const line of lines) {
    if (/^title\b/iu.test(line) || PLANTUML_PARTICIPANT_DECLARATION.test(line) || PLANTUML_CLASS_DECLARATION.test(line)) continue
    const relation = PLANTUML_CLASS_RELATION.exec(line)
    if (relation !== null) {
      const arrow = relation[2]!
      const classSpecific = arrow === '--' || /[|*o]|\.\./u.test(arrow)
      if (classSpecific || hasClassDeclaration) {
        const left = plantUmlEndpoint(relation[1]!)
        const right = plantUmlEndpoint(relation[3]!)
        const ends = plantUmlClassEnds(left, right, arrow)
        const label = cleanLabel(relation[4] ?? '')
        edges.push({
          ...ends,
          ...(label === '' ? {} : { label }),
          ...(arrow.includes('..') ? { dashed: true } : {}),
        })
        ensureNode(ends.from)
        ensureNode(ends.to)
        continue
      }
    }
    const message = PLANTUML_MESSAGE.exec(line)
    if (message === null) continue
    const arrow = message[2]!
    const left = plantUmlEndpoint(message[1]!)
    const right = plantUmlEndpoint(message[3]!)
    // A left-pointing arrowhead (`B <- A`) means A sends to B.
    const reversed = arrow.startsWith('<')
    const from = reversed ? right : left
    const to = reversed ? left : right
    const label = cleanLabel(message[4] ?? '')
    if (label !== '') hasLabelledMessage = true
    edges.push({
      from,
      to,
      ...(label === '' ? {} : { label }),
      ...(arrow.includes('--') ? { dashed: true } : {}),
    })
    ensureNode(from)
    ensureNode(to)
  }

  const truncated = nodes.size > MAX_NODES || edges.length > MAX_EDGES
  const empty = nodes.size === 0 && edges.length === 0
  return {
    nodes: [...nodes.values()].slice(0, MAX_NODES),
    edges: edges.slice(0, MAX_EDGES),
    kind: hasClassDeclaration ? 'class' : hasParticipant || hasLabelledMessage ? 'sequence' : 'plantuml',
    ...(title === undefined ? {} : { title }),
    ...(empty ? { note: 'PlantUML：未识别到可解析的 participant/class/关系行' } : {}),
    ...(truncated ? { truncated: true } : {}),
  }
}

/** Detect a source format from its file name and content. */
export function detectFormat(fileName: string, content: string): ImportDigest['format'] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.drawio') || lower.endsWith('.drawio.xml') || /<mxfile\b|<mxGraphModel\b/iu.test(content)) return 'drawio'
  if (lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.json')) return 'excalidraw'
  if (lower.endsWith('.puml') || lower.endsWith('.plantuml') || lower.endsWith('.pu') || /^\s*@startuml\b/imu.test(content)) return 'plantuml'
  return 'mermaid'
}

/** Extract a bounded digest from any supported source file. */
export function importDiagram(fileName: string, content: string): ImportDigest {
  const format = detectFormat(fileName, content)
  if (format === 'drawio') return parseDrawio(content)
  if (format === 'excalidraw') return parseExcalidraw(content)
  if (format === 'plantuml') {
    const parsed = parsePlantUml(content)
    return {
      format: 'plantuml',
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      kind: parsed.kind,
      nodes: parsed.nodes,
      edges: parsed.edges,
      notes: parsed.note === undefined ? [] : [parsed.note],
      truncated: parsed.truncated === true,
    }
  }
  return parseMermaid(content)
}

/** Render a digest as compact text for the model. */
export function renderDigest(digest: ImportDigest): string {
  const kind = digest.kind === undefined ? '' : ` (${digest.kind})`
  const lines = [`${digest.format}${kind}${digest.title === undefined ? '' : ` "${digest.title}"`}: ${digest.nodes.length} node(s), ${digest.edges.length} edge(s)${digest.truncated ? ' (truncated)' : ''}`]
  for (const node of digest.nodes.slice(0, 80)) lines.push(`- node ${node.id} "${node.label}"${node.kind === undefined ? '' : ` [${node.kind}]`}`)
  if (digest.nodes.length > 80) lines.push(`- … ${digest.nodes.length - 80} more node(s)`)
  for (const edge of digest.edges.slice(0, 80)) lines.push(`- edge ${edge.from} -> ${edge.to}${edge.dashed === true ? ' (dashed)' : ''}${edge.label === undefined ? '' : ` "${edge.label}"`}`)
  if (digest.edges.length > 80) lines.push(`- … ${digest.edges.length - 80} more edge(s)`)
  if (digest.groups !== undefined && digest.groups.length > 0) lines.push(`- groups: ${digest.groups.join(', ')}`)
  for (const note of digest.notes) lines.push(`- note: ${note}`)
  return lines.join('\n')
}
