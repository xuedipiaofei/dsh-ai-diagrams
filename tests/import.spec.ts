import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { MAX_EDGES, MAX_NODES, detectFormat, importDiagram } from '../src/core/import.ts'

const DRAWIO = `<mxfile><diagram name="Flow"><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="2" value="Start" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="3" value="End" vertex="1" parent="1"><mxGeometry x="10" y="100" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="4" edge="1" source="2" target="3" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`

const FLOWCHART = `flowchart LR
  A[User] --> B{Login}
  B -->|yes| C[Home]
`

const SEQUENCE = `sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: login
  S-->>U: token
`

const EXCALIDRAW = JSON.stringify({
  type: 'excalidraw',
  appState: { name: 'Sketch' },
  elements: [
    { id: 'r1', type: 'rectangle' },
    { id: 't1', type: 'text', text: 'Box', containerId: 'r1' },
    { id: 'r2', type: 'rectangle' },
    { id: 'a1', type: 'arrow', startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' } },
  ],
})

describe('drawio import', () => {
  it('extracts vertices and edges from a plain mxfile', () => {
    const digest = importDiagram('flow.drawio', DRAWIO)
    expect(digest.format).toBe('drawio')
    expect(digest.title).toBe('Flow')
    expect(digest.nodes.map(node => node.label)).toEqual(expect.arrayContaining(['Start', 'End']))
    expect(digest.edges).toEqual([{ from: '2', to: '3' }])
  })

  it('decodes a compressed diagram payload', () => {
    const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="A" vertex="1" parent="1"/><mxCell id="3" value="B" vertex="1" parent="1"/><mxCell id="4" edge="1" source="2" target="3" parent="1"/></root></mxGraphModel>'
    const payload = deflateRawSync(Buffer.from(encodeURIComponent(model), 'utf8')).toString('base64')
    const compressed = `<mxfile><diagram name="C">${payload}</diagram></mxfile>`
    const digest = importDiagram('compressed.drawio', compressed)
    expect(digest.nodes).toHaveLength(2)
    expect(digest.edges).toHaveLength(1)
  })
})

describe('mermaid import', () => {
  it('extracts flowchart nodes and labelled edges', () => {
    const digest = importDiagram('flow.mmd', FLOWCHART)
    expect(digest.format).toBe('mermaid')
    expect(digest.nodes.map(node => node.label)).toEqual(expect.arrayContaining(['User', 'Login', 'Home']))
    expect(digest.edges.some(edge => edge.label === 'yes')).toBe(true)
  })

  it('extracts sequence participants and messages', () => {
    const digest = importDiagram('seq.mmd', SEQUENCE)
    expect(digest.nodes.map(node => node.id).sort()).toEqual(['S', 'U'])
    expect(digest.edges).toEqual([
      { from: 'U', to: 'S', label: 'login' },
      { from: 'S', to: 'U', label: 'token' },
    ])
  })

  it('explains unsupported mermaid dialects', () => {
    const digest = importDiagram('mind.mmd', 'mindmap\n  root((x))\n')
    expect(digest.nodes).toHaveLength(0)
    expect(digest.notes.join(' ')).toMatch(/unsupported Mermaid diagram type/)
  })
})

describe('excalidraw import', () => {
  it('maps containers, labels and arrows from an excalidraw scene', () => {
    const digest = importDiagram('sketch.excalidraw', EXCALIDRAW)
    expect(digest.format).toBe('excalidraw')
    expect(digest.title).toBe('Sketch')
    expect(digest.nodes.find(node => node.id === 'r1')?.label).toBe('Box')
    expect(digest.edges).toEqual([{ from: 'r1', to: 'r2' }])
  })
})

describe('plantuml import', () => {
  it('extracts sequence participants, labels and return arrows', () => {
    const source = `@startuml
title Token refresh
' a comment
skinparam backgroundColor #EEEEEE
!theme plain

participant "Web App" as W
actor "Buyer" as U
database "Orders DB" as D

W -> U : open checkout
W --> D : store order
D --> W : order id
U <- W : receipt
U <<- W : ack
@enduml`
    const digest = importDiagram('refresh.puml', source)
    expect(digest.format).toBe('plantuml')
    expect(digest.kind).toBe('sequence')
    expect(digest.title).toBe('Token refresh')
    expect(digest.notes).toEqual([])
    expect(digest.nodes).toEqual(expect.arrayContaining([
      { id: 'W', label: 'Web App' },
      { id: 'U', label: 'Buyer' },
      { id: 'D', label: 'Orders DB' },
    ]))
    expect(digest.edges).toEqual([
      { from: 'W', to: 'U', label: 'open checkout' },
      { from: 'W', to: 'D', label: 'store order', dashed: true },
      { from: 'D', to: 'W', label: 'order id', dashed: true },
      { from: 'W', to: 'U', label: 'receipt' },
      { from: 'W', to: 'U', label: 'ack' },
    ])
  })

  it('reverses a left-pointing message arrow', () => {
    const digest = importDiagram('reverse.puml', '@startuml\nparticipant A\nparticipant B\nB <- A : go\n@enduml')
    expect(digest.edges).toEqual([{ from: 'A', to: 'B', label: 'go' }])
  })

  it('extracts class declarations, inheritance and dependency relations', () => {
    const source = `@startuml
title Order model
abstract class Payment
class Order
interface Repository
enum Status
Payment <|-- CardPayment
Order ..> Payment : uses
Order --* LineItem
@enduml`
    const digest = importDiagram('model.puml', source)
    expect(digest.kind).toBe('class')
    expect(digest.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['Payment', 'Order', 'Repository', 'Status']))
    expect(digest.edges).toEqual(expect.arrayContaining([
      { from: 'CardPayment', to: 'Payment' },
      { from: 'Order', to: 'Payment', label: 'uses', dashed: true },
    ]))
    // The diamond side owns a composition.
    expect(digest.edges).toContainEqual({ from: 'LineItem', to: 'Order' })
  })

  it('reports an empty or unsupported file without inventing structure', () => {
    const digest = importDiagram('empty.puml', '@startuml\ntitle Blank\nalt maybe\n@enduml')
    expect(digest.format).toBe('plantuml')
    expect(digest.nodes).toHaveLength(0)
    expect(digest.edges).toHaveLength(0)
    expect(digest.notes.join(' ')).toContain('未识别到可解析的')
  })

  it('enforces the node and edge caps', () => {
    const participants = Array.from({ length: MAX_NODES + 5 }, (_, index) => `participant P${index}`)
    const messages = Array.from({ length: MAX_EDGES + 5 }, () => 'P0 -> P1 : ping')
    const digest = importDiagram('big.puml', ['@startuml', ...participants, ...messages, '@enduml'].join('\n'))
    expect(digest.nodes).toHaveLength(MAX_NODES)
    expect(digest.edges).toHaveLength(MAX_EDGES)
    expect(digest.truncated).toBe(true)
  })
})

describe('detectFormat', () => {
  it('uses extensions and content', () => {
    expect(detectFormat('x.drawio', '')).toBe('drawio')
    expect(detectFormat('x.mmd', 'flowchart LR')).toBe('mermaid')
    expect(detectFormat('x.excalidraw', '{}')).toBe('excalidraw')
    expect(detectFormat('x.puml', '')).toBe('plantuml')
    expect(detectFormat('x.plantuml', '')).toBe('plantuml')
    expect(detectFormat('x.txt', '@startuml\n@enduml')).toBe('plantuml')
    expect(detectFormat('x.txt', '<mxGraphModel/>')).toBe('drawio')
  })
})
