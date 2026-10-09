import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.use({ actionTimeout:10000, reducedMotion: 'reduce', launchOptions: {
 executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
}});
test.beforeEach(async ({page}) => {
 await page.addInitScript(() => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  (window as any).__streams = [];
  navigator.mediaDevices.getUserMedia = async constraints => {
   const stream = await original(constraints); (window as any).__streams.push(stream); return stream;
  };
 });
});
const alive = (page:any) => page.evaluate(() => (window as any).__streams.flatMap((s:MediaStream)=>s.getTracks()).filter((t:MediaStreamTrack)=>t.readyState==='live').length);

test('experience camera streams, pauses, freezes a record and releases on source/navigation changes', async ({page}) => {
 await page.goto('/#/experience');
 await expect(page.getByText('等待摄像头画面',{exact:true})).toBeVisible();
 expect(await alive(page)).toBe(0);
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(page.locator('.camera-preview')).toHaveClass(/is-active/);
 await expect(page.locator('.experience-top-result')).toBeVisible();
 await expect(page.locator('.experience-score-list .score-row')).toHaveCount(5);
 await expect(page.getByText('真实模型结果',{exact:true})).toBeVisible();
 await expect.poll(()=>alive(page)).toBe(1);
 await page.getByRole('switch',{name:'实时识别',exact:true}).click();
 const count = await page.locator('.camera-live-row small').textContent();
 await page.waitForTimeout(850);
 expect(await page.locator('.camera-live-row small').textContent()).toBe(count);
 await page.getByRole('switch',{name:'实时识别',exact:true}).click();
 await expect(page.locator('.camera-live-row small')).not.toHaveText(count!);
 await mkdir('qa',{recursive:true});
 await page.screenshot({path:'qa/live-experience.png',fullPage:true});
 await page.getByRole('button',{name:'定格并记录',exact:true}).click();
 await expect(page.locator('.experience-record')).toHaveCount(1);
 await expect.poll(()=>alive(page)).toBe(0);
 await expect(page.getByRole('radio',{name:'文件',exact:true})).toBeChecked();
 await page.getByRole('textbox',{name:'我的观察与猜想',exact:true}).fill('记录摄像头的画面');
 await page.getByRole('button',{name:'保存观察',exact:true}).click();
 await expect(page.locator('.experience-record')).toContainText('记录摄像头的画面');
 await page.getByText('摄像头',{exact:true}).click();
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(1);
 await page.getByText('文件',{exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(0);
 await page.getByText('摄像头',{exact:true}).click();
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(1);
 await page.getByRole('button',{name:'返回应用选择',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(0);
});

test('camera samples persist, capture locations release devices, validation needs current training', async ({page}) => {
 await page.goto('/#/training');
 const cards=page.getByTestId('class-card');
 await expect(cards).toHaveCount(2);
 await expect(page.getByRole('button',{name:'导出模型',exact:true})).toBeDisabled();
 await expect(page.getByRole('switch',{name:'实时演示',exact:true})).toBeDisabled();
 await cards.nth(0).getByRole('button',{name:'摄像头',exact:true}).click();
 await cards.nth(0).getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(cards.nth(0).getByRole('button',{name:'拍摄一张',exact:true})).toBeEnabled();
 await cards.nth(0).getByRole('button',{name:'拍摄一张',exact:true}).click();
 await expect(cards.nth(0).locator('.sample-tile')).toHaveCount(1);
 await cards.nth(0).getByRole('button',{name:'连续采集',exact:true}).click();
 await expect.poll(()=>cards.nth(0).locator('.sample-tile').count()).toBeGreaterThan(1);
 await cards.nth(0).getByRole('button',{name:'停止采集',exact:true}).click();
 await cards.nth(1).getByRole('button',{name:'摄像头',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(0);
 await cards.nth(1).getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(cards.nth(1).getByRole('button',{name:'拍摄一张',exact:true})).toBeEnabled();
 await cards.nth(1).getByRole('button',{name:'拍摄一张',exact:true}).click();
 await expect(cards.nth(1).locator('.sample-tile')).toHaveCount(1);
 await page.screenshot({path:'qa/camera-samples.png',fullPage:true});
 await page.getByRole('spinbutton',{name:'训练轮数',exact:true}).fill('2');
 await page.getByRole('spinbutton',{name:'训练轮数',exact:true}).press('Tab');
 await page.getByRole('button',{name:'开始演示训练',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(0);
 await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 await expect(page.getByText('上次演示已完成',{exact:true})).toBeVisible();
 await page.locator('.prediction-card').getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(page.locator('.score-number')).toHaveCount(2);
 await page.screenshot({path:'qa/camera-validation.png',fullPage:true});
 await page.getByRole('button',{name:'新增类别',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(0);
 await expect(page.locator('.score-number')).toHaveCount(0);
 await expect(page.getByRole('switch',{name:'实时演示',exact:true})).toBeDisabled();
 await page.reload();
 await expect(cards.nth(0).locator('.sample-tile').first()).toBeVisible();
});

test('permission errors allow file fallback, late permission resolution releases stream', async ({page}) => {
 await page.goto('/#/experience');
 await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => {throw new DOMException('denied','NotAllowedError');}; });
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(page.getByText(/摄像头权限未开启/)).toBeVisible();
 await page.getByText('文件',{exact:true}).click();
 await page.getByRole('button',{name:'使用示例插画',exact:true}).click();
 await page.getByRole('button',{name:'开始识别',exact:true}).click();
 await expect(page.locator('.experience-record')).toHaveCount(1);
 await page.reload();
 await page.evaluate(() => {
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
   const stream = await original(constraints);
   return new Promise<MediaStream>(resolve => { (window as any).__allowCamera = () => resolve(stream); });
  };
 });
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).__allowCamera)).toBe('function');
 await page.getByRole('button',{name:'返回应用选择',exact:true}).click();
 await page.evaluate(() => (window as any).__allowCamera());
 await expect.poll(()=>alive(page)).toBe(0);
});

test('mobile camera layout fits and disconnected device can restart', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#/experience');
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(page.locator('.experience-top-result')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'qa/live-experience-mobile.png',fullPage:true});
 await page.evaluate(() => (window as any).__streams[0].getVideoTracks()[0].dispatchEvent(new Event('ended')));
 await expect(page.getByText(/摄像头连接已断开/)).toBeVisible();
 await expect.poll(()=>alive(page)).toBe(0);
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect.poll(()=>alive(page)).toBe(1);
 await page.getByRole('button',{name:'返回应用选择',exact:true}).click();
 await page.getByRole('button',{name:'打开图像分类实验',exact:true}).click();
 const card=page.getByTestId('class-card').first();
 await card.getByRole('button',{name:'摄像头',exact:true}).click();
 await card.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(card.getByRole('button',{name:'拍摄一张',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'qa/camera-samples-mobile.png',fullPage:true});
});
