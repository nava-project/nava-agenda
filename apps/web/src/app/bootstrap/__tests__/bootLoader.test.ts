/**
 * Tests de releaseBootLoader (DEC-188, entrega 5a): el arranque del panel se
 * retira al resolver la primera navegación, y el modo pintado por
 * `index.html` solo se queda si la navegación acabó dentro del panel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { releaseBootLoader } from '../bootLoader'

const Empty = { render: () => null }

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/panel', component: Empty },
      { path: '/acceso', component: Empty },
    ],
  })
}

function paintBoot(root: HTMLElement) {
  root.dataset.boot = 'panel'
  root.dataset.appTheme = 'ink'
  root.dataset.motion = 'reduced'
  const loader = document.createElement('div')
  loader.id = 'boot-loader'
  document.body.append(loader)
}

describe('releaseBootLoader', () => {
  const root = document.documentElement

  beforeEach(() => paintBoot(root))

  afterEach(() => {
    document.getElementById('boot-loader')?.remove()
    delete root.dataset.boot
    delete root.dataset.appTheme
    delete root.dataset.motion
  })

  it('removes the loader and keeps the mode when the first navigation lands in the panel', async () => {
    const router = makeRouter()
    void router.push('/panel')
    await releaseBootLoader(router, root)

    expect(document.getElementById('boot-loader')).toBeNull()
    expect(root.dataset.boot).toBeUndefined()
    expect(root.dataset.appTheme).toBe('ink')
    expect(root.dataset.motion).toBe('reduced')
  })

  it('also removes the panel mode when the session sends the visitor to the login', async () => {
    const router = makeRouter()
    void router.push('/acceso')
    await releaseBootLoader(router, root)

    expect(document.getElementById('boot-loader')).toBeNull()
    expect(root.dataset.appTheme).toBeUndefined()
    expect(root.dataset.motion).toBeUndefined()
  })

  it('leaves the document alone outside a panel boot', async () => {
    delete root.dataset.boot
    const router = makeRouter()
    void router.push('/acceso')
    await releaseBootLoader(router, root)

    expect(root.dataset.appTheme).toBe('ink')
    expect(document.getElementById('boot-loader')).toBeNull()
  })
})
