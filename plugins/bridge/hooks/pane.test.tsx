import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'bridge',
  component: 'Pane',
  requestId: 'bridge',
  props: { title: 'Bridge', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane draws on the desktop surface', async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const mast = await ui.find({ type: 'Text', text: /BRIDGE/ })
  expect(mast?.text).toBe('BRIDGE')
  await ui.unmount()
})
