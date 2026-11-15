import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { detectFormat, importDiagram } from '../src/core/import.ts'

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

describe('excalidraw and plantuml import', () => {
  it('maps containers, labels and arrows from an excalidraw scene', () => {
    const digest = importDiagram('sketch.excalidraw', EXCALIDRAW)
    expect(digest.format).toBe('excalidraw')
    expect(digest.title).toBe('Sketch')
    expect(digest.nodes.find(node => node.id === 'r1')?.label).toBe('Box')
    expect(digest.edges).toEqual([{ from: 'r1', to: 'r2' }])
  })

  it('detects plantuml and returns a read-the-source note', () => {
    const digest = importDiagram('seq.puml', '@startuml\nAlice -> Bob: hi\n@enduml')
    expect(digest.format).toBe('plantuml')
    expect(digest.notes.join(' ')).toMatch(/PlantUML/)
  })
})

describe('detectFormat', () => {
  it('uses extensions and content', () => {
    expect(detectFormat('x.drawio', '')).toBe('drawio')
    expect(detectFormat('x.mmd', 'flowchart LR')).toBe('mermaid')
    expect(detectFormat('x.excalidraw', '{}')).toBe('excalidraw')
    expect(detectFormat('x.txt', '@startuml\n@enduml')).toBe('plantuml')
    expect(detectFormat('x.txt', '<mxGraphModel/>')).toBe('drawio')
  })
})
