import TOCInline from 'pliny/ui/TOCInline'
import Pre from 'pliny/ui/Pre'
import BlogNewsletterForm from 'pliny/ui/BlogNewsletterForm'
import type { MDXComponents } from 'mdx/types'
import Image from './Image'
import CustomLink from './Link'
import TableWrapper from './TableWrapper'
import Mermaid from './Mermaid'

function MermaidPre(props: React.ComponentPropsWithoutRef<'pre'>) {
  const { children, ...rest } = props
  // Check if the child is a <code> element with language-mermaid class
  if (
    children &&
    typeof children === 'object' &&
    'props' in children &&
    typeof children.props?.className === 'string' &&
    children.props.className.includes('language-mermaid')
  ) {
    // Extract the text content from the code block
    const chart =
      typeof children.props.children === 'string'
        ? children.props.children.trim()
        : String(children.props.children).trim()
    return <Mermaid chart={chart} />
  }
  return <Pre {...rest}>{children}</Pre>
}

export const components: MDXComponents = {
  Image,
  TOCInline,
  a: CustomLink,
  pre: MermaidPre,
  table: TableWrapper,
  BlogNewsletterForm,
}
