import Link from '@/components/Link'
import Image from '@/components/Image'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'
import { formatDate } from 'pliny/utils/formatDate'
import NewsletterForm from 'pliny/ui/NewsletterForm'
import LegacyIntro from '@/components/LegacyIntro'

const MAX_DISPLAY = 5
const { home } = siteMetadata

export default function Home({ posts }) {
  return (
    <>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        <div className="space-y-2 pb-8 pt-6 md:space-y-5">
          <h1 className="text-3xl font-extrabold leading-9 tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl sm:leading-10 md:text-6xl md:leading-14">
            Posts
          </h1>
          {/* <p className="text-lg leading-7 text-gray-500 dark:text-gray-400">
            {siteMetadata.description}
          </p> */}
        </div>
        {home ? (
          <div className="flex items-center gap-4 pb-8">
            {home.avatar && (
              <Image
                src={home.avatar}
                alt={home.name}
                width={64}
                height={64}
                className="h-16 w-16 rounded-full"
              />
            )}
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{home.name}</h2>
              {home.role && <p className="text-sm text-gray-500 dark:text-gray-400">{home.role}</p>}
              <div className="flex gap-3 pt-1">
                {home.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              {home.sourceRepo && (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  {home.aiTag ? (
                    <>
                      <Link
                        href={`/tags/${home.aiTag}`}
                        className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                      >
                        AI
                      </Link>{' '}
                      posts
                    </>
                  ) : (
                    'Posts'
                  )}{' '}
                  written by{' '}
                  <Link
                    href={home.sourceRepo}
                    className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                  >
                    Ghostpen
                  </Link>
                  {home.howItWorks && (
                    <>
                      {' � '}
                      <Link
                        href={home.howItWorks}
                        className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                      >
                        How it works
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        ) : (
          <LegacyIntro />
        )}
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {!posts.length && 'No posts found.'}
          {/* {posts.slice(0, MAX_DISPLAY).map((post) => { */}
          {posts.map((post) => {
            const { slug, date, title, summary, tags } = post
            return (
              <li key={slug} className="py-12">
                <article>
                  <div className="space-y-2 xl:grid xl:grid-cols-4 xl:items-baseline xl:space-y-0">
                    <dl>
                      <dt className="sr-only">Published on</dt>
                      <dd className="text-base font-medium leading-6 text-gray-500 dark:text-gray-400">
                        <time dateTime={date}>{formatDate(date, siteMetadata.locale)}</time>
                      </dd>
                    </dl>
                    <div className="space-y-5 xl:col-span-3">
                      <div className="space-y-6">
                        <div>
                          <h2 className="text-2xl font-bold leading-8 tracking-tight">
                            <Link
                              href={`/blog/${slug}`}
                              className="text-gray-900 dark:text-gray-100"
                            >
                              {title}
                            </Link>
                          </h2>
                          <div className="flex flex-wrap">
                            {tags.map((tag) => (
                              <Tag key={tag} text={tag} />
                            ))}
                          </div>
                        </div>
                        <div className="prose max-w-none text-gray-500 dark:text-gray-400">
                          {summary}
                        </div>
                      </div>
                      <div className="text-base font-medium leading-6">
                        <Link
                          href={`/blog/${slug}`}
                          className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                          aria-label={`Read more: "${title}"`}
                        >
                          Read more &rarr;
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      </div>
      {/* {posts.length > MAX_DISPLAY && (
        <div className="flex justify-end text-base font-medium leading-6">
          <Link
            href="/blog"
            className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            aria-label="All posts"
          >
            All Posts &rarr;
          </Link>
        </div>
      )} */}
      {/* {siteMetadata.newsletter?.provider && (
        <div className="flex items-center justify-center pt-4">
          <NewsletterForm />
        </div>
      )} */}
    </>
  )
}
