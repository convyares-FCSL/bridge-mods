import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'bridge',
  component: 'Pane',
  requestId: 'bridge',
  props: { title: 'Bridge', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// the three layouts are chosen from the pane width in columns
for (const [name, cols] of [['narrow', 60], ['medium', 120], ['wide', 200]] as const) {
  test(`the ${name} layout draws on the desktop surface`, async ($) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: cols }, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /BRIDGE/ }))?.text).toBe('BRIDGE')
    expect(await ui.find({ type: 'Text', text: /FOCUS/ })).toBeTruthy()
    await ui.unmount()
  })
}

test('the wide layout shows the timeline and the log', async ($) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 200 }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /TIMELINE/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^LOG$/ })).toBeTruthy()
  await ui.unmount()
})
