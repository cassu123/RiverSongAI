/**
 * toolActivity — the tool calls River actually made, as a short feed.
 *
 * The server's agent loop (core/agent_loop.py) sends, per call:
 *   { type: 'tool_use',    tool, input }   when it starts
 *   { type: 'tool_result', tool, result }  when it returns
 * One call at a time, so a result belongs to the latest unfinished call of
 * the same tool.
 *
 * The server works out whether a call succeeded but does not send that; the
 * only signal is the text. The loop writes timeouts and exceptions as
 * "Error: …" / "Error executing …", so a result starting with "Error" is
 * reported as failed. A tool that fails politely without that prefix will
 * show as done.
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
          calls[j].status = /^\s*error\b/i.test(String(evt.result ?? '')) ? 'failed' : 'done'
          break
        }
      }
    }
  })
  return calls.slice(-limit).map(({ key, label, status }) => ({ key, label, status }))
}
