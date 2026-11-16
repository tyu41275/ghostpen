import Link from '@/components/Link'

/** A drafted post's "Written by" line in legacy mode (no GHOSTPEN_CONTENT_DIR), as it read before; goes with it. */
export default function LegacyPostLinks({ slug }: { slug: string }) {
  return (
    <>
      Written by{' '}
      <Link
        href="https://github.com/tyu41275/ghostpen"
        className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
      >
        Ghostpen
      </Link>
      {slug !== '2026-03-18-how-i-built-a-blog-that-writes-itself' && (
        <>
          {' � '}
          <Link
            href="/blog/2026-03-18-how-i-built-a-blog-that-writes-itself"
            className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
          >
            How it works
          </Link>
        </>
      )}
    </>
  )
}
