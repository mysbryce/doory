import { expect, test } from '@playwright/test'

test('hosted API hides CLI and verifies a graphic with real raster and motion images before apply', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/create?w=800&h=600&unit=px')
  await expect(page.locator('[data-artboard] .doory-canvas').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('ed-pages-add').click()
  await page.getByTestId('ed-add-entry-ai').click()
  await page.getByRole('button', { name: 'Connection settings' }).click()
  await page.getByLabel('Provider', { exact: true }).selectOption('openai')
  await page.getByLabel('API key', { exact: true }).fill('fake-key-no-billing')
  await page.getByLabel('Model', { exact: true }).fill('doory-test-vision')
  await page.getByLabel('Design prompt').fill('Design an animated summer poster with a page transition')
  await page.getByRole('button', { name: 'Generate design', exact: true }).click()
  await expect(page.getByText('Verified canvas, spacing, typography, animation and transition filmstrips.')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByAltText('Proposed canvas')).toBeVisible()
  const catalog = await (await page.request.get('/api/v1/ai/providers/')).json()
  expect(catalog.providers.some((provider: { protocol: string }) => provider.protocol === 'cli')).toBe(false)
  await page.screenshot({ path: 'test-results/ai-proposal-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Apply to canvas', exact: true }).click()
  await expect(page.getByTestId('sidebar-ai').getByText('Applied to canvas. Undo available.')).toBeVisible()
  await page.screenshot({ path: 'test-results/ai-applied-desktop.png', fullPage: true })
  await page.keyboard.press('Control+z')
  await page.getByRole('toolbar', { name: 'Add to your design' }).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Layers', exact: true }).click()
  await expect(page.getByTestId('sidebar-layers')).not.toContainText('Headline')
  expect(errors).toEqual([])
})

test('AI connection form fits the mobile bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/create?w=800&h=600&unit=px')
  await expect(page.locator('[data-artboard] .doory-canvas').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('ed-add-entry-ai').click()
  await expect(page.getByTestId('sheet-ai')).toBeVisible()
  await page.getByRole('button', { name: 'Connection settings' }).click()
  await expect(page.getByLabel('Provider', { exact: true })).toBeVisible()
  const box = await page.getByTestId('sheet-ai').boundingBox()
  expect(box?.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/ai-mobile.png', fullPage: true })
})
