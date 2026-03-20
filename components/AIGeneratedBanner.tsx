const AIGeneratedBanner = () => {
  return (
    <div
      role="note"
      className="my-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
    >
      <span className="mr-1.5 inline-block text-gray-400 dark:text-gray-500" aria-hidden="true">
        &#9432;
      </span>
      This post was AI-generated from development pipeline artifacts and reviewed by me before
      publishing.
    </div>
  )
}

export default AIGeneratedBanner
