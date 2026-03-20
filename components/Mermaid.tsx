'use client'

import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useTheme } from 'next-themes'

interface MermaidProps {
  chart: string
}

const Mermaid = ({ chart }: MermaidProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState(false)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (!ref.current) return

    const renderChart = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        })
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`
        const { svg: renderedSvg } = await mermaid.render(id, chart)
        setSvg(renderedSvg)
        setError(false)
      } catch {
        setError(true)
      }
    }

    renderChart()
  }, [chart, resolvedTheme])

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-md bg-gray-100 p-4 dark:bg-gray-800">
        <code>{chart}</code>
      </pre>
    )
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-md bg-gray-50 p-8 dark:bg-gray-800">
        <span className="text-sm text-gray-500 dark:text-gray-400">Loading diagram...</span>
      </div>
    )
  }

  return <div ref={ref} className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

export default Mermaid
