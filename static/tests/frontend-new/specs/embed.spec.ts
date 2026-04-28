import {expect, test} from '@playwright/test';
import {getPadBody, goToNewPad} from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test.describe('ep_embedmedia', () => {
  test('inserts an iframe into the pad', async ({page}) => {
    await page.locator('.buttonicon-embed-media').click();
    const iframeMarkup = `
        <iframe width="560" height="315"
        src="https://www.youtube.com/embed/AqTMAkNc6nA"
        frameborder="0"
        allowfullscreen></iframe>`;
    await page.locator('#embedMediaSrc').fill(iframeMarkup);
    await page.locator('#doEmbedMedia').click();

    const padBody = await getPadBody(page);
    await expect(padBody.locator('.media').first()).toBeVisible({timeout: 15_000});
    await expect(padBody.locator('iframe').first()).toHaveCount(1);
    await expect(padBody.locator('img')).toHaveCount(0);
  });
});
