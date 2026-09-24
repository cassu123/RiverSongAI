/**
 * toolActivity — the tool calls River actually made, as a short feed.
 *
 * The server's agent loop (core/agent_loop.py) sends, per call:
 *   { type: 'tool_use',    tool, input }        when it starts
 *   { type: 'tool_result', tool, result, ok }   when it returns
 * One call at a time, so a result belongs to the latest unfinished call of
 * the same tool.
 *
 * `ok` is false when the tool raised, timed out, or caught its own error and
 * said so (core/tool_outcome.py: ToolFailure) — "I tried to check the
 * weather ... but encountered an issue" is a failure, whatever its wording.
 * A server from before `ok` existed is read the old way: a result starting
 * with "Error" is a failure.
 */

/** "control_device" -> "Control device" */
export function toolLabel(name) {
  const words = String(name || 'tool').replace(/[_.]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * @param {Array} events  toolEvents from useConversation, oldest first
 * @param {number} limit  how many of the most recent calls to return
 * @returns {Array<{ key: string, label: string, status: 'running'|'done'|'failed' }>}
 */
export function summarizeToolEvents(events = [], limit = 4) {
  const calls = []
  events.forEach((evt, i) => {
    if (evt?.type === 'tool_use') {
      calls.push({ key: `call-${i}`, tool: evt.tool, label: toolLabel(evt.tool), status: 'running' })
    } else if (evt?.type === 'tool_result') {
      for (let j = calls.length - 1; j >= 0; j--) {
        if (calls[j].tool === evt.tool && calls[j].status === 'running') {
          const failed = typeof evt.ok === 'boolean'
            ? !evt.ok
            : /^\s*error\b/i.test(String(evt.result ?? ''))
          calls[j].status = failed ? 'failed' : 'done'
          break
        }
      }
    }
  })
  return calls.slice(-limit).map(({ key, label, status }) => ({ key, label, status }))
}
