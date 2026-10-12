import {test,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
test.use({reducedMotion:'reduce',launchOptions:{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}});

test('real training, reload persistence, image prediction and stale-model guard',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/training');
 await expect(page.getByTestId('class-card')).toHaveCount(2);
 for(let c=0;c<2;c++){
  await page.getByTestId('class-card').nth(c).getByTestId('sample-upload').locator('input[type=file]').setInputFiles(Array.from({length:5},(_,i)=>`tests/fixtures/training/${c}-${i}.png`));
  await expect(page.getByTestId('class-card').nth(c).locator('.sample-tile')).toHaveCount(5);
 }
 await page.getByRole('spinbutton',{name:'训练轮数',exact:true}).fill('10');
 await page.getByRole('heading',{name:'训练模型',exact:true}).click();
 await page.getByRole('button',{name:'开始训练',exact:true}).click();
 await expect(page.getByText('真实训练',{exact:true}).last()).toBeVisible();
 await expect(page.getByRole('button',{name:'完成，去测试',exact:true})).toBeVisible({timeout:60000});
 await mkdir('qa/training-ui',{recursive:true});
 await page.screenshot({path:'qa/training-ui/monitor.png',fullPage:true});
 await page.getByRole('button',{name:'完成，去测试',exact:true}).click();
 await page.reload();
 await expect(page.getByTestId('class-card').first().locator('.sample-tile')).toHaveCount(5);
 await page.getByText('文件',{exact:true}).click();
 await page.getByTestId('test-upload').locator('input[type=file]').setInputFiles('tests/fixtures/training/0-test.png');
 await page.getByRole('button',{name:'开始识别',exact:true}).click();
 await expect(page.locator('.score-number')).toHaveCount(2);
 const values=await page.locator('.score-number').allTextContents();
 expect(parseFloat(values[0])).toBeGreaterThan(parseFloat(values[1]));
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出实验记录',exact:true}).click();
 const result=JSON.parse(await readFile((await(await download).path())!,'utf8'));
 expect(result.isMock).toBe(false);expect(result.project.runs[0].metrics).toHaveLength(10);
 expect(result.project.runs[0].trainSampleIds).toHaveLength(8);
 expect(result.project.runs[0].validationSampleIds).toHaveLength(2);
 await expect(page.locator('.ant-message-notice')).toHaveCount(0,{timeout:10000});
 await page.mouse.move(10,10);
 await page.screenshot({path:'qa/training-ui/workspace.png',fullPage:true});
 await page.locator('.validation-source').getByText('摄像头',{exact:true}).click();
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
 await expect(page.locator('.camera-live-row small')).not.toHaveText('已处理 0 帧');
 await expect(page.locator('.score-number')).toHaveCount(2);
 await page.getByRole('switch',{name:'实时识别',exact:true}).click();
 const count=await page.locator('.camera-live-row small').textContent();
 await page.waitForTimeout(800);
 expect(await page.locator('.camera-live-row small').textContent()).toBe(count);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'qa/training-ui/mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.validation-source').getByText('文件',{exact:true}).click();
 const name=page.getByRole('textbox',{name:'类别 1 名称',exact:true});await name.fill('新的类别名称');await name.press('Enter');
 await expect(page.getByText('样本已更新，请重新完成训练。')).toBeVisible();
 await expect(page.getByRole('button',{name:'开始识别',exact:true})).toBeDisabled();
 expect(errors).toEqual([]);
});

test('training service unconfigured shows a real error without falling back to demo',async({page})=>{
 await page.route('**/api/v1/projects',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'请先配置 MySQL 独立开发库。'})}));
 await page.goto('/#/training');
 await expect(page.getByText('请先配置 MySQL 独立开发库。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重新连接',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'开始演示训练',exact:true})).toHaveCount(0);
});
