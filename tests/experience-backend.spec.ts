import { test, expect } from '@playwright/test';

test('unavailable service never produces a mock prediction and reconnect recovers',async({page})=>{
 await page.route('**/api/v1/experience/models',route=>route.fulfill({status:503,json:{detail:'识别服务暂时离线'}}));
 await page.goto('/#/experience');
 await expect(page.getByText('识别服务暂时离线',{exact:true})).toBeVisible();
 await page.getByText('文件',{exact:true}).click();
 await page.getByRole('button',{name:'使用示例插画',exact:true}).click();
 await expect(page.getByRole('button',{name:'开始识别',exact:true})).toBeDisabled();
 await expect(page.locator('.experience-top-result')).toHaveCount(0);
 await page.unroute('**/api/v1/experience/models');
 await page.getByRole('button',{name:'重新连接',exact:true}).click();
 await expect(page.getByText('真实模型已就绪',{exact:true})).toBeVisible();
 await page.route('**/api/v1/experience/models/fruit-veg-36/predict',route=>route.fulfill({status:503,json:{detail:'模型暂不可用'}}));
 await page.getByRole('button',{name:'开始识别',exact:true}).click();
 await expect(page.getByText('模型暂不可用',{exact:true})).toBeVisible();
 await expect(page.locator('.experience-record')).toHaveCount(0);
 await expect(page.locator('.experience-top-result')).toHaveCount(0);
 await page.unroute('**/api/v1/experience/models/fruit-veg-36/predict');
 await page.getByRole('button',{name:'开始识别',exact:true}).click();
 await expect(page.getByText('真实模型结果',{exact:true})).toBeVisible();
 await expect(page.locator('.experience-score-list .score-row')).toHaveCount(5);
});

test('legacy demo record remains explicitly labeled after real model is connected',async({page})=>{
 await page.goto('/#/experience');
 await expect(page.getByText('真实模型已就绪',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{
   const record={id:'legacy-demo',createdAt:'2026-10-01T00:00:00Z',modelId:'fruit-ui-demo-v1',isMock:true,note:'旧版观察',
     image:{id:'old-image',name:'旧演示图片',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=',size:1,fingerprint:'old',createdAt:'2026-10-01T00:00:00Z'},
     scores:[{label:'苹果',score:.62},{label:'香蕉',score:.24},{label:'橙子',score:.14}]};
   await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('vision-lab-experience-v1',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('records','readwrite');tx.objectStore('records').put([record],'recent');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
 });
 await page.reload();
 await expect(page.locator('.experience-record')).toHaveCount(1);
 await page.locator('.experience-record-open').click();
 await expect(page.getByText('历史演示',{exact:true})).toBeVisible();
 await expect(page.getByText('旧版固定演示值，不代表真实识别。',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'我的观察与猜想'})).toHaveValue('旧版观察');
 await page.getByRole('button',{name:'使用示例插画',exact:true}).click();
 await page.getByRole('button',{name:'开始识别',exact:true}).click();
 await expect(page.locator('.experience-record')).toHaveCount(2);
 await expect(page.getByText('真实模型结果',{exact:true})).toBeVisible();
 await expect(page.locator('.experience-record').last()).toContainText('历史演示');
});

test('late prediction is discarded after input source changes',async({page})=>{
 await page.goto('/#/experience');
 await expect(page.getByText('真实模型已就绪',{exact:true})).toBeVisible();
 await page.getByText('文件',{exact:true}).click();
 await page.getByRole('button',{name:'使用示例插画',exact:true}).click();
 let release:()=>void=()=>{};
 const held=new Promise<void>(resolve=>{release=resolve;});
 let received:()=>void=()=>{};
 const started=new Promise<void>(resolve=>{received=resolve;});
 await page.route('**/api/v1/experience/models/fruit-veg-36/predict',async route=>{
   const response=await route.fetch();received();await held;
   await route.fulfill({response}).catch(()=>{});
 });
 await page.getByRole('button',{name:'开始识别',exact:true}).click();
 await started;
 await page.getByText('摄像头',{exact:true}).click();
 release();
 await expect(page.getByRole('heading',{name:'等待摄像头画面'})).toBeVisible();
 await expect(page.locator('.experience-top-result')).toHaveCount(0);
 await expect(page.locator('.experience-record')).toHaveCount(0);
});
