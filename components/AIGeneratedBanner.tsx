import Link from './Link'

const AIGeneratedBanner = () => {
  return (
    <div
      role="note"
      className="my-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
    >
      <span className="mr-1.5 inline-block text-gray-400 dark:text-gray-500" aria-hidden="true">
        &#9432;
      </span>
      This post was AI-generated from{' '}
      <Link
        href="/blog/2026-03-15-what-is-ecoorchestra"
        className="underline decoration-gray-400 underline-offset-2 hover:text-gray-800 dark:decoration-gray-500 dark:hover:text-gray-300"
      >
        development pipeline artifacts
      </Link>{' '}
      and reviewed by me before publishing.
    </div>
  )
}

export default AIGeneratedBanner
