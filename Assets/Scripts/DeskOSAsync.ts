/**
 * DeskOS — shared async plumbing.
 *
 * Small enough to inline, important enough not to: every network path in this
 * Lens goes through the same race, so a hung transport can never take the whole
 * thing down again.
 */

/**
 * Resolve `null` on timeout, but let genuine failures reject.
 *
 * The asymmetry is the point. A timeout carries no information — there is
 * nothing to report but the wait. A rejection carries the message that says
 * *why*, and that message is usually the entire diagnosis, so it is passed
 * through untouched rather than flattened into a null.
 *
 * Racing at all matters because a fetch over a blocked transport can hang
 * instead of rejecting, and an un-raced `await` on that stalls the JS context
 * until the runtime kills the Lens.
 */
export function withTimeout<T>(work: Promise<T>, seconds: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, seconds * 1000)

    work.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Resolve after `seconds`.
 *
 * setTimeout in this runtime takes MILLISECONDS, which is the trap this helper
 * exists to stop people falling into a second time.
 */
export function wait(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), seconds * 1000)
  })
}
