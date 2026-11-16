import Link from '@/components/Link'
import Image from '@/components/Image'

/** The home page's intro in legacy mode (no GHOSTPEN_CONTENT_DIR), as it read before content folders; goes with it. */
export default function LegacyIntro() {
  return (
    <div className="flex items-center gap-4 pb-8">
      <Image
        src="/static/images/avatar.png"
        alt="Tim"
        width={64}
        height={64}
        className="h-16 w-16 rounded-full"
      />
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Tim</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Senior Software Engineer</p>
        <div className="flex gap-3 pt-1">
          <Link
            href="https://github.com/tyu41275"
            className="text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
          >
            GitHub
          </Link>
          <Link
            href="https://www.linkedin.com/in/yutim1275"
            className="text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
          >
            LinkedIn
          </Link>
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500">
          <Link
            href="/tags/ai"
            className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
          >
            AI
          </Link>{' '}
          posts written by{' '}
          <Link
            href="https://github.com/tyu41275/ghostpen"
            className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
          >
            Ghostpen
          </Link>
          {' � '}
          <Link
            href="/blog/2026-03-18-how-i-built-a-blog-that-writes-itself"
            className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
          >
            How it works
          </Link>
        </p>
      </div>
    </div>
  )
}
